import workletUrl from './worklets/pcm-processor.js?url'
import type { LevelFrame } from '@shared/types'

/** 一路采集的输入参数。 */
export interface LaneInput {
  /** 会话内唯一标识，主进程按此路由分片 */
  key: string
  constraints: MediaStreamConstraints
  /** 落盘音频的输入增益（线性）；电平表始终显示设备原始电平 */
  gain: number
  /**
   * 采集类型：
   * - `user`（默认）：麦克风等输入设备，走 getUserMedia；
   * - `display`：系统内录，走 getDisplayMedia + loopback，只保留音频轨。
   */
  kind?: 'user' | 'display'
}

export interface EngineEvents {
  /** 每路各自的电平（`key` 为轨道标识） */
  onLevel?: (key: string, frame: LevelFrame) => void
  /** 每路各自的录制分片 */
  onData?: (key: string, chunk: Uint8Array) => void
  /** 16kHz 单声道 PCM 分片（仅第一路，供离线转写） */
  onPcm?: (samples: Float32Array) => void
  onError?: (err: Error) => void
}

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']

export function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  for (const m of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(m)) return m
  }
  return ''
}

/**
 * 获取系统内录音频流：getDisplayMedia 取回环音频后丢弃视频轨。
 *
 * 诚实降级：拿不到音频轨（多为未授予「屏幕录制 / 系统录音」权限）时抛错，
 * 由上层提示用户，而不是静默录成静音。
 */
async function acquireSystemAudio(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('当前环境不支持系统内录')
  }
  let raw: MediaStream
  try {
    raw = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
  } catch (e) {
    // SCK 采集在缺「屏幕录制」授权 / 无法启动时抛 NotReadableError（Error starting capture 等），
    // 这类错误不带 NotAllowed 字样，单独翻译成可操作的中文指引
    const err = e as Error & { name?: string }
    if (/NotReadable|Error starting capture|Could not start audio/i.test(`${err?.name ?? ''} ${err?.message ?? ''}`)) {
      throw new Error(
        '无法启动系统内录：请授予「屏幕录制」权限（系统设置 → 隐私与安全性 → 屏幕录制，添加并勾选 Sloth），重启 Sloth 后再试'
      )
    }
    throw e
  }
  if (raw.getAudioTracks().length === 0) {
    raw.getTracks().forEach((t) => t.stop())
    throw new Error(
      '未获取到系统声音：请在「系统设置 → 隐私与安全性 → 屏幕录制」中授权本应用后重启，再试一次'
    )
  }
  // 只保留音频：停掉并移除视频轨（屏幕画面不参与录制）
  raw.getVideoTracks().forEach((t) => {
    try {
      t.stop()
    } catch {
      /* noop */
    }
    raw.removeTrack(t)
  })
  return raw
}

/** 单路采集链路：设备流 -> 电平/PCM -> 增益 -> 录制目标流。 */
interface Lane {
  key: string
  stream: MediaStream
  source: MediaStreamAudioSourceNode
  gain: GainNode
  worklet: AudioWorkletNode
  /** 静音输出，仅用于保持处理图活跃（避免回声） */
  monitor: GainNode
  dest: MediaStreamAudioDestinationNode
  recorder: MediaRecorder | null
  /** Android 分支下录的是设备流的 clone，teardown 时须一并停掉其轨道 */
  recStream: MediaStream | null
  /** 已回调但尚未投递出去的分片数（转 ArrayBuffer 是异步的） */
  pending: number
  /** 分片全部投递完毕时的通知（stop 用它在收尾前等待尾部数据） */
  onDrained: (() => void) | null
}

/**
 * 多路音频引擎：一次会话同时打开若干输入设备（或多路同一设备），
 * 所有轨道共用一个 AudioContext（同一渲染时钟），各自独立编码与落盘。
 *
 * - 电平与转写 PCM 取自设备原始信号（不受输入增益影响，便于判断削波）；
 * - 输入增益只作用于落盘音频（备份 / 安全轨压低避免削波）；
 * - 所有资源必须通过 teardown() 显式释放，否则第二次录音会出问题。
 */
export class AudioEngine {
  events: EngineEvents = {}
  private lanes: Lane[] = []
  private ctx: AudioContext | null = null
  private mimeType = ''

  get mime(): string {
    return this.mimeType
  }

  /** 第一路（主轨）的设备流，供上层挂 mute / ended 中断监听。 */
  get streamRef(): MediaStream | null {
    return this.lanes[0]?.stream ?? null
  }

  /** 各路设备流，顺序与传入一致。 */
  get streams(): MediaStream[] {
    return this.lanes.map((l) => l.stream)
  }

  /** 打开所有设备并建立处理图，等待 start()。 */
  async prepare(inputs: LaneInput[]): Promise<void> {
    this.teardown()
    if (inputs.length === 0) throw new Error('至少需要一路采集')

    // 设备并行打开；任一路失败即整体失败（不静默丢轨），且必须停掉已成功打开的流
    const opened: Array<{ input: LaneInput; stream: MediaStream }> = []
    try {
      await Promise.all(
        inputs.map(async (input) => {
          const stream =
            input.kind === 'display'
              ? await acquireSystemAudio()
              : await navigator.mediaDevices.getUserMedia(input.constraints)
          opened.push({ input, stream })
        })
      )

      const ctx = new AudioContext({ latencyHint: 'interactive' })
      this.ctx = ctx
      await ctx.audioWorklet.addModule(workletUrl)
      // 录制目标流依赖上下文处于运行状态
      if (ctx.state !== 'running') await ctx.resume()

      this.lanes = opened.map(({ input, stream }, index) => {
      const source = ctx.createMediaStreamSource(stream)
      const worklet = new AudioWorkletNode(ctx, 'pcm-processor')
      const isPrimary = index === 0
      // Android 软件渲染下电平消息 ~62Hz 每帧触发 React 重渲染会占满主线程
      // （拖慢 MediaRecorder 事件、实测录音数据乱序），节流到 ~15Hz。
      const isAndroidGraph = /Android/i.test(navigator.userAgent)
      let levelCounter = 0
      worklet.port.onmessage = (e: MessageEvent) => {
        const d = e.data as { type: string; rms: number; peak: number; samples?: Float32Array }
        if (!d) return
        if (d.type === 'level') {
          if (isAndroidGraph && levelCounter % 4 !== 0) {
            levelCounter++
            return
          }
          levelCounter++
          this.events.onLevel?.(input.key, { rms: d.rms, peak: d.peak })
        }
        // 转写只跑主轨：一个会话对应一份字幕，多轨时取第一路
        else if (d.type === 'pcm' && d.samples && isPrimary) this.events.onPcm?.(d.samples)
      }

      const gain = ctx.createGain()
      gain.gain.value = input.gain
      const monitor = ctx.createGain()
      monitor.gain.value = 0
      const dest = ctx.createMediaStreamDestination()

      // source -> worklet（电平 / 转写，输出静音）-> monitor(0) -> destination：保持图活跃且无回声
      // source -> gain -> dest：录制链路，只受输入增益影响
      // Android：不接 ctx.destination——真实输出时钟在 WebView 里会拖慢渲染并饿死
      // 采集管道（实测录音只剩一半时长）；MediaStreamDestination 自身即可驱动图渲染。
      source.connect(worklet)
      worklet.connect(monitor)
      if (/Android/i.test(navigator.userAgent)) monitor.connect(dest)
      else monitor.connect(ctx.destination)
      source.connect(gain)
      gain.connect(dest)

      return { key: input.key, stream, source, gain, worklet, monitor, dest, recorder: null, recStream: null, pending: 0, onDrained: null }
      })
    } catch (e) {
      // 取流成功后建图失败：同样要停掉已打开的设备流，避免麦克风/内录轨道泄漏
      for (const o of opened) o.stream.getTracks().forEach((t) => t.stop())
      this.teardown()
      throw e
    }
  }

  start(chunkMs = 1000): void {
    if (this.lanes.length === 0) throw new Error('engine not prepared')
    this.mimeType = pickMimeType()
    const options = this.mimeType ? { mimeType: this.mimeType } : undefined
    // Android WebView 的已知坑（实测）：
    //  1) MediaRecorder 录 WebAudio MediaStreamDestination 会重复包/降速 → 直接录设备流 clone；
    //  2) 主线程忙时 1s 分片事件被堵成突发、arrayBuffer 完成顺序错乱 → webm 内容乱序损坏，
    //     安卓改用结束时一次性交付整段（避开分片流水，崩溃恢复退化为整段丢失，M-A 已知边界）。
    const isAndroid = /Android/i.test(navigator.userAgent)
    const slice = isAndroid ? undefined : chunkMs
    for (const lane of this.lanes) {
      const recStream = isAndroid ? lane.stream.clone() : lane.dest.stream
      lane.recStream = isAndroid ? recStream : null
      const rec = new MediaRecorder(recStream, options)
      rec.ondataavailable = (ev: BlobEvent): void => {
        if (!ev.data || ev.data.size === 0) return
        // 分片转 ArrayBuffer 是异步的：必须计入在途数量，否则 stop 后尾部数据会被丢弃
        lane.pending += 1
        void ev.data
          .arrayBuffer()
          .then((buf) => this.events.onData?.(lane.key, new Uint8Array(buf)))
          .catch(() => undefined)
          .finally(() => {
            lane.pending -= 1
            lane.onDrained?.()
          })
      }
      rec.onerror = (): void => this.events.onError?.(new Error(`轨道 ${lane.key} 录制出错`))
      if (slice === undefined) rec.start()
      else rec.start(slice)
      lane.recorder = rec
    }
  }

  pause(): void {
    for (const lane of this.lanes) {
      if (lane.recorder?.state === 'recording') lane.recorder.pause()
    }
  }

  resume(): void {
    for (const lane of this.lanes) {
      if (lane.recorder?.state === 'paused') lane.recorder.resume()
    }
  }

  /** 开 / 关第一路的 16kHz PCM 回传（转写用）。 */
  setPcmGate(on: boolean): void {
    this.lanes[0]?.worklet.port.postMessage({ type: 'gate', on })
  }

  /**
   * 停止全部录制。
   * 必须等到每一路的 `onstop` 与最后一个分片投递（`onData`）都完成才返回：
   * 否则上层随即让主进程收尾，尾部数据会丢（各轨时长也会因此不一致）。
   */
  async stop(timeoutMs = 5000): Promise<void> {
    const lanes = this.lanes.filter((l) => l.recorder)
    if (lanes.length === 0) return
    await Promise.all(lanes.map((lane) => this.finishLane(lane, timeoutMs)))
    for (const lane of this.lanes) {
      lane.recorder = null
      lane.onDrained = null
    }
  }

  private finishLane(lane: Lane, timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const rec = lane.recorder
      if (!rec) return resolve()
      let settled = false
      let stopped = false
      const done = (): void => {
        if (settled) return
        if (stopped && lane.pending === 0) {
          settled = true
          lane.onDrained = null
          resolve()
        }
      }
      // 兜底：极端情况下分片回调丢失，超时后继续收尾，避免卡死停止流程
      window.setTimeout(() => {
        if (!settled) {
          settled = true
          lane.onDrained = null
          resolve()
        }
      }, timeoutMs)
      lane.onDrained = done
      rec.onstop = (): void => {
        stopped = true
        done()
      }
      if (rec.state !== 'inactive') rec.stop()
      else stopped = true
      done()
    })
  }

  teardown(): void {
    for (const lane of this.lanes) {
      try {
        if (lane.recorder && lane.recorder.state !== 'inactive') lane.recorder.stop()
      } catch {
        /* noop */
      }
      lane.onDrained = null
      try {
        lane.worklet.port.close()
      } catch {
        /* noop */
      }
      try {
        lane.worklet.disconnect()
        lane.source.disconnect()
        lane.gain.disconnect()
        lane.monitor.disconnect()
        lane.dest.disconnect()
      } catch {
        /* noop */
      }
      lane.stream.getTracks().forEach((t) => t.stop())
      lane.recStream?.getTracks().forEach((t) => t.stop())
      lane.recStream = null
    }
    this.lanes = []
    void this.ctx?.close()
    this.ctx = null
  }
}
