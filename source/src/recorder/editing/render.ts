import { buildTrackChain } from './effects'
import { segLength, type Project, type Track } from './project'
import { repairClicks } from './repair'

export interface RenderedAudio {
  sampleRate: number
  channels: Float32Array[]
  /** 帧数 */
  length: number
  /** 本次渲染修复的爆音区间数（未开启修复时为 0） */
  repairCount?: number
}

/** 轨道在当前工程下是否发声（考虑静音 / 独奏）。 */
function isAudible(track: Track, anySolo: boolean): boolean {
  if (track.muted) return false
  if (anySolo && !track.solo) return false
  return true
}

/** 轨道在渲染时的帧数（与逐片段累加的偏移保持一致）。 */
function trackFrames(track: Track, buffers: Map<string, AudioBuffer>): number {
  return track.segments.reduce((acc, s) => {
    const buf = buffers.get(s.sourceId)
    if (!buf) return acc
    return acc + Math.round(segLength(s) * buf.sampleRate)
  }, 0)
}

function silent(sampleRate: number, channels: number, length: number): RenderedAudio {
  return {
    sampleRate,
    channels: Array.from({ length: channels }, () => new Float32Array(length)),
    length
  }
}

/**
 * 按片段从素材缓冲离线渲染出最终混音（非破坏）。
 *
 * - 各轨道在时间轴上求和混音；默认从 0 对齐，可用 `Track.offset` 整体延后
 *   （修正多设备同时采集的时钟差 / 启动延迟）；
 * - 支持片段级增益 / 淡入淡出与轨道级增益；
 * - 静音轨道不参与；存在独奏轨道时只渲染独奏轨道；
 * - 每条轨道的效果链（EQ / 压缩 / 混响）经 `OfflineAudioContext` 离线跑一遍，
 *   预览与导出使用同一结果；
 * - 素材均经同一 AudioContext 解码，采样率一致。
 */
export async function renderProject(
  project: Project,
  buffers: Map<string, AudioBuffer>
): Promise<RenderedAudio> {
  const used = project.tracks
    .flatMap((t) => t.segments)
    .map((s) => buffers.get(s.sourceId))
    .filter((b): b is AudioBuffer => !!b)

  const sampleRate = used[0]?.sampleRate ?? 48000
  const channels = Math.max(1, ...used.map((b) => b.numberOfChannels))

  const anySolo = project.tracks.some((t) => t.solo)

  // 时长取“所有轨道”（含静音）的最大值，保证静音切换时时间轴稳定。
  const baseFrames = project.tracks.reduce((acc, t) => {
    const frames = trackFrames(t, buffers) + Math.round((t.offset ?? 0) * sampleRate)
    return Math.max(acc, frames)
  }, 0)

  // 混响尾音会延续到素材结束之后，需要额外扩展渲染长度（取可发声轨道中最大衰减）。
  const reverbTail = project.tracks.reduce((acc, t) => {
    if (!isAudible(t, anySolo)) return acc
    const decay = t.effects?.reverb?.mix ? t.effects.reverb.decay : 0
    return Math.max(acc, decay ?? 0)
  }, 0)
  const totalFrames = baseFrames + Math.round(reverbTail * sampleRate)

  if (totalFrames === 0) return silent(sampleRate, channels, 0)

  const ctx = new OfflineAudioContext(channels, totalFrames, sampleRate)

  for (const track of project.tracks) {
    if (!isAudible(track, anySolo)) continue
    const gain = track.gain ?? 1
    if (gain === 0) continue

    const input = ctx.createGain()
    input.gain.value = gain
    const output = track.effects ? buildTrackChain(ctx, input, track.effects) : input
    output.connect(ctx.destination)

    // 起点对齐：该轨整体延后 offset 秒参与混音
    let offsetFrames = Math.round((track.offset ?? 0) * sampleRate)
    for (const seg of track.segments) {
      const buf = buffers.get(seg.sourceId)
      if (!buf) continue
      const startF = Math.max(0, Math.round(seg.start * buf.sampleRate))
      const endF = Math.min(buf.length, Math.round(seg.end * buf.sampleRate))
      const len = Math.max(0, endF - startF)
      if (len === 0) continue

      const t0 = offsetFrames / sampleRate
      const dur = len / sampleRate
      const segGain = seg.gain ?? 1
      const fadeIn = Math.min(seg.fadeIn ?? 0, dur)
      const fadeOut = Math.min(seg.fadeOut ?? 0, dur)

      const src = ctx.createBufferSource()
      src.buffer = buf
      const g = ctx.createGain()
      if (fadeIn > 0) {
        g.gain.setValueAtTime(0, t0)
        g.gain.linearRampToValueAtTime(segGain, t0 + fadeIn)
      } else {
        g.gain.setValueAtTime(segGain, t0)
      }
      if (fadeOut > 0) {
        g.gain.setValueAtTime(segGain, t0 + dur - fadeOut)
        g.gain.linearRampToValueAtTime(0, t0 + dur)
      }

      src.connect(g)
      g.connect(input)
      src.start(t0, seg.start, dur)
      offsetFrames += len
    }
  }

  const rendered = await ctx.startRendering()

  // 工程级爆音修复：对最终混音逐声道检测并插值修复，预览与导出一致。
  let repairCount = 0
  const channelsOut = Array.from({ length: rendered.numberOfChannels }, (_, c) => {
    const channel = rendered.getChannelData(c)
    if (!project.repair) return channel
    const result = repairClicks(channel, { windowSamples: Math.round(sampleRate * 0.02) })
    repairCount += result.count
    return result.data
  })

  return {
    sampleRate,
    channels: channelsOut,
    length: rendered.length,
    repairCount: project.repair ? repairCount : 0
  }
}
