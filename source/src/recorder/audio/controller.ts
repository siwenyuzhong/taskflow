import { AudioEngine, pickMimeType, type LaneInput } from './engine'
import { useRecorderStore } from '@renderer/state/recorder'
import { useLibraryStore } from '@renderer/state/library'
import { useTranscriptStore } from '@renderer/state/transcript'
import type { AsrTranscript, AudioSource, TrackDraft } from '@shared/types'

const engine = new AudioEngine()

/**
 * 当前会话主轨 key（转写与主电平取它）。随音源不同而不同：
 * 麦克风/混合为首条用户轨；纯系统内录为 `sys0`。
 */
let primaryLaneKey: string | null = null

function primaryTrackKey(): string | null {
  return primaryLaneKey ?? useRecorderStore.getState().tracks[0]?.key ?? null
}

let timer: number | null = null
let lastTick = 0

function startTimer(): void {
  lastTick = performance.now()
  if (timer !== null) return
  timer = window.setInterval(() => {
    const now = performance.now()
    useRecorderStore.getState().addElapsed(now - lastTick)
    lastTick = now
  }, 100)
}

function stopTimer(): void {
  if (timer !== null) {
    window.clearInterval(timer)
    timer = null
    // 结算最后一个不完整间隔：暂停 / 停止时不再丢失 <=100ms
    const now = performance.now()
    useRecorderStore.getState().addElapsed(now - lastTick)
    lastTick = now
  }
}

engine.events = {
  onLevel: (key, frame) => {
    const store = useRecorderStore.getState()
    // 仅在真正录制中刷新电平 / 波形：暂停只暂停了 MediaRecorder，采集图仍在运行，
    // 若不拦截，暂停后电平条与滚动波形会继续跳动，造成「还在录音」的错觉。
    if (store.state !== 'RECORDING') return
    store.setTrackPeak(key, frame.peak)
    if (key === primaryTrackKey()) store.setLevel(frame)
  },
  onData: (key, chunk) => {
    const id = useRecorderStore.getState().draftId
    if (id) window.api.recorder.append(id, key, chunk)
  },
  // 16kHz PCM 分片 -> 主进程 -> utilityProcess（转写用，仅主轨；未开 gate 时不会触发）
  onPcm: (samples) => window.api.asr.feed(samples, 16000),
  onError: (e) => useRecorderStore.getState().setError(e.message)
}

/** 启动一次转写会话：模型就绪后再开启 PCM gate，避免丢首段。 */
async function startAsrSession(): Promise<void> {
  useTranscriptStore.getState().begin()
  try {
    await window.api.asr.start()
    if (useRecorderStore.getState().state === 'RECORDING') {
      engine.setPcmGate(true)
      useTranscriptStore.getState().setStatus('ready')
    }
  } catch (e) {
    engine.setPcmGate(false)
    useTranscriptStore.getState().setError((e as Error).message)
  }
}

/** 结束转写会话并取回最终结果。 */
async function finishAsrSession(): Promise<AsrTranscript | null> {
  engine.setPcmGate(false)
  if (!useTranscriptStore.getState().active) return null
  try {
    return await window.api.asr.stop()
  } catch {
    return null
  }
}

function defaultName(): string {
  return `速录 ${new Date().toLocaleString('zh-CN', { hour12: false })}`
}

function buildConstraints(
  deviceId: string | null,
  sampleRate: number,
  channels: number
): MediaStreamConstraints {
  const audio: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: channels,
    sampleRate
  }
  if (deviceId) audio.deviceId = { exact: deviceId }
  return { audio, video: false }
}

/** 一次会话里某一路采集的规划（引擎 + 主进程落盘共用）。 */
interface LaneSpec {
  key: string
  name: string
  deviceId: string | null
  gain: number
  kind: 'user' | 'display'
}

/**
 * 按音源规划采集路：
 * - microphone：用户配置的每一路麦克风；
 * - system：单独一路系统内录（回环）；
 * - mixed：第一路麦克风（主轨，供转写）+ 系统内录。
 */
function buildLaneSpecs(source: AudioSource, tracks: TrackDraft[]): LaneSpec[] {
  if (source === 'system') {
    return [{ key: 'sys0', name: '系统声音', deviceId: null, gain: 1, kind: 'display' }]
  }
  if (source === 'mixed') {
    const mic = tracks[0]
    const specs: LaneSpec[] = []
    if (mic) {
      specs.push({ key: mic.key, name: mic.name, deviceId: mic.deviceId, gain: mic.gain, kind: 'user' })
    }
    specs.push({ key: 'sys0', name: '系统声音', deviceId: null, gain: 1, kind: 'display' })
    return specs
  }
  return tracks.map((t) => ({
    key: t.key,
    name: t.name,
    deviceId: t.deviceId,
    gain: t.gain,
    kind: 'user' as const
  }))
}

export async function loadDevices(): Promise<void> {
  try {
    const list = await navigator.mediaDevices.enumerateDevices()
    const inputs = list
      .filter((d) => d.kind === 'audioinput')
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `麦克风 ${i + 1}` }))
    const store = useRecorderStore.getState()
    store.setDevices(inputs)
    if (!store.deviceId && inputs[0]) store.setDeviceId(inputs[0].deviceId)
  } catch (e) {
    useRecorderStore.getState().setError((e as Error).message)
  }
}

function handleInterrupt(message: string): void {
  const store = useRecorderStore.getState()
  if (store.state !== 'RECORDING') return
  store.dispatch('PAUSE')
  engine.pause()
  stopTimer()
  store.setError(message)
}

async function cleanupAfterFailure(): Promise<void> {
  stopTimer()
  engine.setPcmGate(false)
  try {
    await engine.stop()
  } catch {
    /* noop */
  }
  engine.teardown()
  try {
    await window.api.asr.stop()
  } catch {
    /* noop */
  }
  useTranscriptStore.getState().reset()
  const id = useRecorderStore.getState().draftId
  if (id) {
    try {
      await window.api.recorder.abort(id)
    } catch {
      /* noop */
    }
  }
  useRecorderStore.getState().setDraft(null)
  await window.api.setKeepAwake(false).catch(() => undefined)
}

export async function startRecording(): Promise<void> {
  const initial = useRecorderStore.getState()
  if (initial.state !== 'IDLE' && initial.state !== 'FINISHED' && initial.state !== 'ERROR') return
  // 上一段结束 / 出错后重新开播：必须整体复位（只走 FSM 的 RESET 会残留 elapsedMs，
  // 导致下一段的 durationMs 从上一次计时累加）
  if (initial.state === 'FINISHED' || initial.state === 'ERROR') initial.reset()
  if (!useRecorderStore.getState().dispatch('PREPARE')) return

  try {
    const { source, tracks, screenAccess } = useRecorderStore.getState()
    const needsDisplay = source === 'system' || source === 'mixed'
    const needsMic = source !== 'system'

    // 系统内录授权：用缓存状态做同步预检。这里不能 await IPC——
    // getDisplayMedia 需要「用户手势」，跨进程往返会把手势用掉导致直接失败。
    if (needsDisplay && (screenAccess === 'denied' || screenAccess === 'restricted')) {
      throw new Error(
        '系统内录未获授权：请在「系统设置 → 隐私与安全性 → 屏幕录制」中勾选 Sloth，重启后再试'
      )
    }
    // 麦克风权限：不含系统内录时可直接等待（getUserMedia 不依赖用户手势）；
    // 含系统内录时先发起、不等待，保住手势；若被拒由下面的采集错误兜底说明。
    if (needsMic && !needsDisplay) {
      const granted = await window.api.requestMicAccess()
      if (!granted) throw new Error('未获得麦克风权限')
    } else if (needsMic) {
      void window.api.requestMicAccess().catch(() => false)
    }

    const sampleRate = 48000
    const channels = 1
    const specs = buildLaneSpecs(source, tracks)
    primaryLaneKey = specs[0]?.key ?? null
    const lanes: LaneInput[] = specs.map((s) => ({
      key: s.key,
      gain: s.gain,
      kind: s.kind,
      constraints:
        s.kind === 'user'
          ? buildConstraints(s.deviceId, sampleRate, channels)
          : { audio: false, video: false }
    }))
    await engine.prepare(lanes)

    // 任一路信号中断 / 设备断开都暂停整个会话（各轨保持同一时间轴）
    engine.streams.forEach((stream, i) => {
      const name = specs[i]?.name ?? '轨道'
      stream.getAudioTracks().forEach((track) => {
        track.onmute = () => handleInterrupt(`「${name}」信号中断，已自动暂停`)
        track.onended = () => handleInterrupt(`「${name}」设备已断开，已自动暂停`)
      })
    })

    const id = crypto.randomUUID()
    const name = defaultName()
    useRecorderStore.getState().setDraft(id, name)
    await window.api.recorder.start({
      id,
      name,
      mimeType: pickMimeType(),
      source,
      sampleRate,
      channels,
      tracks: specs.map((s) => ({ key: s.key, name: s.name, deviceId: s.deviceId, gain: s.gain }))
    })

    // 计时起点与录制器启动对齐：把阻止休眠的 IPC 往返放到计时之后，
    // 否则 durationMs 会比实际音频短 0.2–0.7s（主进程繁忙时更明显）
    engine.start()
    useRecorderStore.getState().setMimeType(engine.mime)
    useRecorderStore.getState().setError(null)
    useRecorderStore.getState().dispatch('READY')
    startTimer()
    void window.api.setKeepAwake(true).catch(() => undefined)
    if (useRecorderStore.getState().transcribe) void startAsrSession()
    else useTranscriptStore.getState().reset()
    await loadDevices()
  } catch (e) {
    await cleanupAfterFailure()
    const store = useRecorderStore.getState()
    const isDisplay = store.source === 'system' || store.source === 'mixed'
    const raw = (e as Error)?.message || '采集失败'
    const looksPermission =
      /permission|denied|not.?allowed|NotAllowed|屏幕录制|无法启动系统内录|NotReadable|Error starting capture|Could not start audio/i.test(raw)
    let message = raw
    if (looksPermission && isDisplay) {
      message =
        '系统内录失败：请确认已授予「屏幕录制 / 系统录音」权限（系统设置 → 隐私与安全性 → 屏幕录制），重启应用后再试'
    } else if (looksPermission) {
      message = '未获得麦克风权限：请在「系统设置 → 隐私与安全性 → 麦克风」中授权后重试'
    }
    // 内录失败后刷新授权缓存，让页面上的「打开设置」引导条及时出现
    if (isDisplay) {
      void window.api.windows
        .systemAudioStatus()
        .then((s) => useRecorderStore.getState().setScreenAccess(s))
        .catch(() => undefined)
    }
    useRecorderStore.getState().setError(message)
    useRecorderStore.getState().dispatch('FAIL')
  }
}

export function pauseRecording(): void {
  const store = useRecorderStore.getState()
  if (!store.dispatch('PAUSE')) return
  engine.pause()
  engine.setPcmGate(false)
  stopTimer()
}

export function resumeRecording(): void {
  const store = useRecorderStore.getState()
  if (!store.dispatch('RESUME')) return
  engine.resume()
  if (useRecorderStore.getState().transcribe) engine.setPcmGate(true)
  startTimer()
  store.setError(null)
}

export async function stopRecording(): Promise<void> {
  const store = useRecorderStore.getState()
  if (!store.dispatch('STOP')) return
  stopTimer()

  const { draftId, draftName, elapsedMs, source, markers } = useRecorderStore.getState()
  try {
    // 先立即冻结各路录制（engine.stop 内部会等尾部数据投递完毕），再收尾转写：
    // 否则 asr finalize 的几百毫秒会被继续录进文件，导致 durationMs 短于实际音频。
    const stopping = engine.stop()
    const transcript = await finishAsrSession()
    await stopping
    engine.teardown()
    await window.api.setKeepAwake(false)

    let meta = null
    if (draftId) {
      meta = await window.api.recorder.stop(draftId, {
        name: draftName ?? undefined,
        durationMs: Math.round(elapsedMs),
        source,
        sampleRate: 48000,
        channels: 1,
        markers,
        transcript
      })
    }
    useRecorderStore.getState().setLastMeta(meta)
    useRecorderStore.getState().setDraft(null)
    useRecorderStore.getState().dispatch('DONE')
    try {
      await useLibraryStore.getState().refresh()
    } catch {
      /* 列表刷新失败不影响本次保存完成 */
    }
  } catch (e) {
    engine.teardown()
    // 保存失败也要恢复系统休眠；草稿文件保留在磁盘，下次启动走孤儿恢复
    void window.api.setKeepAwake(false).catch(() => undefined)
    useRecorderStore.getState().setDraft(null)
    useRecorderStore.getState().setError((e as Error).message)
    useRecorderStore.getState().dispatch('FAIL')
  }
}

/** FINISHED/ERROR -> IDLE，准备下一次录音。 */
export function resetRecorder(): void {
  useRecorderStore.getState().reset()
}
