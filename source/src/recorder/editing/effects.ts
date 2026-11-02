/**
 * 离线效果（EQ / 压缩 / 混响）——纯参数模型 + Web Audio 效果链构建。
 *
 * 效果以「轨道」为单位挂载（`Track.effects`），非破坏：只影响渲染结果，
 * 原始素材不变。渲染时通过 `OfflineAudioContext` 离线跑一遍效果链，
 * 预览与导出使用同一份渲染结果，所见即所得。
 */

/** 三段 EQ（增益单位 dB）。 */
export interface EqParams {
  lowGain: number
  midGain: number
  highGain: number
}

/** 动态压缩（阈值 dB / 压缩比 / 启动秒 / 释放秒 / 拐点 dB / 补偿增益 dB）。 */
export interface CompressorParams {
  threshold: number
  ratio: number
  attack: number
  release: number
  knee: number
  makeup: number
}

/** 混响（干湿比 0–1 / 衰减时长秒）。 */
export interface ReverbParams {
  mix: number
  decay: number
}

/** 单条轨道上的效果链；子项存在即表示启用。 */
export interface TrackEffects {
  eq?: EqParams
  compressor?: CompressorParams
  reverb?: ReverbParams
}

export const EQ_FREQUENCIES = { low: 250, mid: 1000, high: 4000 } as const

export const DEFAULT_EQ: EqParams = { lowGain: 0, midGain: 0, highGain: 0 }
export const DEFAULT_COMPRESSOR: CompressorParams = {
  threshold: -24,
  ratio: 4,
  attack: 0.01,
  release: 0.25,
  // Chromium 的 DynamicsCompressorNode 在 knee=0 时曲线更接近阈值/压缩比语义，
  // 而 knee=20 在中等阈值下会出现输出反而变大的怪癖，故默认 0。
  knee: 0,
  makeup: 0
}
export const DEFAULT_REVERB: ReverbParams = { mix: 0.25, decay: 1.6 }

/** 轨道是否挂有任何效果。 */
export function hasEffects(fx?: TrackEffects): boolean {
  return !!fx && !!(fx.eq || fx.compressor || fx.reverb)
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20)
}

/**
 * 生成一段合成脉冲响应（指数衰减噪声），作为混响的 IR。
 * 无需外部音频资源，纯本地、可离线。
 */
export function createImpulseResponse(ctx: BaseAudioContext, decaySec: number): AudioBuffer {
  const rate = ctx.sampleRate
  const len = Math.max(1, Math.floor(rate * Math.max(0.05, decaySec)))
  const ir = ctx.createBuffer(2, len, rate)
  for (let c = 0; c < 2; c++) {
    const data = ir.getChannelData(c)
    for (let i = 0; i < len; i++) {
      const t = i / len
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.5)
    }
  }
  return ir
}

/**
 * 把 `input` 依次接入 EQ → 压缩 → 混响，返回链路末端节点。
 * 未启用的效果直接跳过；混响采用干/湿并联。
 */
export function buildTrackChain(
  ctx: BaseAudioContext,
  input: AudioNode,
  fx: TrackEffects
): AudioNode {
  let node = input

  if (fx.eq) {
    const low = ctx.createBiquadFilter()
    low.type = 'lowshelf'
    low.frequency.value = EQ_FREQUENCIES.low
    low.gain.value = fx.eq.lowGain

    const mid = ctx.createBiquadFilter()
    mid.type = 'peaking'
    mid.frequency.value = EQ_FREQUENCIES.mid
    mid.Q.value = 0.9
    mid.gain.value = fx.eq.midGain

    const high = ctx.createBiquadFilter()
    high.type = 'highshelf'
    high.frequency.value = EQ_FREQUENCIES.high
    high.gain.value = fx.eq.highGain

    node.connect(low)
    low.connect(mid)
    mid.connect(high)
    node = high
  }

  if (fx.compressor) {
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = fx.compressor.threshold
    comp.knee.value = fx.compressor.knee
    comp.ratio.value = fx.compressor.ratio
    comp.attack.value = fx.compressor.attack
    comp.release.value = fx.compressor.release
    node.connect(comp)
    node = comp

    if (fx.compressor.makeup) {
      const makeup = ctx.createGain()
      makeup.gain.value = dbToGain(fx.compressor.makeup)
      node.connect(makeup)
      node = makeup
    }
  }

  if (fx.reverb && fx.reverb.mix > 0) {
    const dry = ctx.createGain()
    dry.gain.value = 1 - fx.reverb.mix
    const wet = ctx.createGain()
    wet.gain.value = fx.reverb.mix
    const convolver = ctx.createConvolver()
    convolver.buffer = createImpulseResponse(ctx, fx.reverb.decay)
    const merge = ctx.createGain()

    node.connect(dry)
    dry.connect(merge)
    node.connect(convolver)
    convolver.connect(wet)
    wet.connect(merge)
    node = merge
  }

  return node
}
