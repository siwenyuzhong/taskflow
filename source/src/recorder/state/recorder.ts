import { create } from 'zustand'
import { transition, type RecorderEvent, type RecorderState } from '@shared/recorder-state'
import type { AudioSource, LevelFrame, RecordingMeta, TrackDraft } from '@shared/types'
import type { ScreenAccessStatus } from '@shared/ipc'

export interface DeviceInfo {
  deviceId: string
  label: string
}

export const LEVEL_BARS = 140

/** 各路默认名称：第一条为主轨，其余按序号；同设备多路时作为备份 / 安全轨。 */
export function autoTrackName(index: number): string {
  return index === 0 ? '主轨' : `轨道 ${index + 1}`
}

/** 轨道预设输入增益（备份轨常取 -6 / -12 dB，避免主轨削波时同样失真）。 */
export const TRACK_GAINS = [
  { value: 1, label: '0 dB' },
  { value: 0.5, label: '-6 dB' },
  { value: 0.25, label: '-12 dB' }
]

let trackKeySeq = 0

export function newTrackKey(): string {
  trackKeySeq += 1
  return `t${trackKeySeq}`
}

function defaultTracks(): TrackDraft[] {
  return [{ key: newTrackKey(), deviceId: null, name: autoTrackName(0), gain: 1 }]
}

interface RecorderStore {
  state: RecorderState
  elapsedMs: number
  level: LevelFrame
  /** 最近若干帧的峰值，用于滚动波形 */
  levels: number[]
  draftId: string | null
  draftName: string | null
  source: AudioSource
  deviceId: string | null
  devices: DeviceInfo[]
  /** 本次会话的各路采集（至少一条，第一条为主轨） */
  tracks: TrackDraft[]
  /** 各路最近峰值（轨道 key -> 峰值），用于每轨电平条 */
  trackPeaks: Record<string, number>
  mimeType: string
  error: string | null
  lastMeta: RecordingMeta | null
  /** 录制过程中插入的标记点（毫秒） */
  markers: number[]
  /** 是否边录边转写（持久化） */
  transcribe: boolean
  /** 字幕悬浮窗是否开启（置顶透明窗，实时显示转写） */
  subtitleOn: boolean
  /** 字幕窗是否鼠标穿透（默认穿透，不挡视频操作） */
  subtitleClickThrough: boolean
  /** macOS 屏幕 / 系统录音授权状态（缓存，供开启前同步预检） */
  screenAccess: ScreenAccessStatus

  dispatch: (event: RecorderEvent) => boolean
  addElapsed: (ms: number) => void
  setElapsed: (ms: number) => void
  setLevel: (l: LevelFrame) => void
  setDraft: (id: string | null, name?: string | null) => void
  setSource: (s: AudioSource) => void
  setDeviceId: (id: string | null) => void
  setDevices: (d: DeviceInfo[]) => void
  setMimeType: (m: string) => void
  setError: (e: string | null) => void
  setLastMeta: (m: RecordingMeta | null) => void
  addMarker: (ms: number) => void
  setTranscribe: (on: boolean) => void
  /** 开启 / 关闭字幕悬浮窗（副作用：通知主进程显示 / 隐藏窗口） */
  setSubtitleOn: (on: boolean) => void
  /** 切换字幕窗鼠标穿透（副作用：通知主进程） */
  setSubtitleClickThrough: (on: boolean) => void
  /** 更新屏幕 / 系统录音授权状态缓存 */
  setScreenAccess: (s: ScreenAccessStatus) => void
  /** 新增一路采集（沿用当前默认设备） */
  addTrack: () => void
  /** 删除一路；至少保留一条 */
  removeTrack: (key: string) => void
  setTrackDevice: (key: string, deviceId: string | null) => void
  setTrackGain: (key: string, gain: number) => void
  setTrackName: (key: string, name: string) => void
  setTrackPeak: (key: string, peak: number) => void
  reset: () => void
}

const TRANSCRIBE_KEY = 'autorec.transcribe'

function initialTranscribe(): boolean {
  try {
    return localStorage.getItem(TRANSCRIBE_KEY) === '1'
  } catch {
    return false
  }
}

export const useRecorderStore = create<RecorderStore>((set) => ({
  state: 'IDLE',
  elapsedMs: 0,
  level: { rms: 0, peak: 0 },
  levels: [],
  draftId: null,
  draftName: null,
  source: 'microphone',
  deviceId: null,
  devices: [],
  tracks: defaultTracks(),
  trackPeaks: {},
  mimeType: '',
  error: null,
  lastMeta: null,
  markers: [],
  transcribe: initialTranscribe(),
  subtitleOn: false,
  // 默认不穿透：字幕窗刚打开时用户通常想挪位置 / 关穿透后点得到按钮，
  // 需要看视频不挡手时再手动打开穿透。
  subtitleClickThrough: false,
  screenAccess: 'unknown',

  dispatch: (event) => {
    let ok = false
    set((s) => {
      const next = transition(s.state, event)
      if (next) {
        ok = true
        return { state: next }
      }
      return s
    })
    return ok
  },

  addElapsed: (ms) => set((s) => ({ elapsedMs: s.elapsedMs + ms })),
  setElapsed: (ms) => set({ elapsedMs: ms }),
  setLevel: (l) =>
    set((s) => ({
      level: l,
      levels: [...s.levels, l.peak].slice(-LEVEL_BARS)
    })),
  setDraft: (id, name = null) => set({ draftId: id, draftName: name }),
  setSource: (source) => set({ source }),
  // 设备选择即主轨设备，保持旧字段与轨道列表一致
  setDeviceId: (deviceId) =>
    set((s) => ({
      deviceId,
      tracks: s.tracks.map((t, i) => (i === 0 ? { ...t, deviceId } : t))
    })),
  setDevices: (devices) => set({ devices }),
  setMimeType: (mimeType) => set({ mimeType }),
  setError: (error) => set({ error }),
  setLastMeta: (lastMeta) => set({ lastMeta }),
  addMarker: (ms) => set((s) => ({ markers: [...s.markers, Math.round(ms)] })),
  setTranscribe: (transcribe) => {
    try {
      localStorage.setItem(TRANSCRIBE_KEY, transcribe ? '1' : '0')
    } catch {
      /* noop */
    }
    set({ transcribe })
  },
  setSubtitleOn: (subtitleOn) => {
    set({ subtitleOn })
    // 子窗操作失败时回滚开关，避免 UI 与实际不符
    window.api.windows.subtitle(subtitleOn ? 'show' : 'hide').catch(() => set({ subtitleOn: !subtitleOn }))
  },
  setSubtitleClickThrough: (subtitleClickThrough) => {
    set({ subtitleClickThrough })
    window.api.windows
      .subtitle('interactive', !subtitleClickThrough)
      .catch(() => set({ subtitleClickThrough: !subtitleClickThrough }))
  },
  setScreenAccess: (screenAccess) => set({ screenAccess }),

  addTrack: () =>
    set((s) => {
      const tracks = [
        ...s.tracks,
        { key: newTrackKey(), deviceId: s.deviceId, name: autoTrackName(s.tracks.length), gain: 1 }
      ]
      return { tracks }
    }),
  removeTrack: (key) =>
    set((s) => {
      if (s.tracks.length <= 1) return s
      const tracks = s.tracks
        .filter((t) => t.key !== key)
        // 自动名按新顺序重排，避免删掉中间一路后出现「轨道 4」排在第 2 位
        .map((t, i) =>
          t.name === autoTrackName(0) || /^轨道 \d+$/.test(t.name)
            ? { ...t, name: autoTrackName(i) }
            : t
        )
      return {
        tracks,
        trackPeaks: Object.fromEntries(Object.entries(s.trackPeaks).filter(([k]) => k !== key))
      }
    }),
  setTrackDevice: (key, deviceId) =>
    set((s) => {
      const tracks = s.tracks.map((t) => (t.key === key ? { ...t, deviceId } : t))
      const primary = tracks[0]
      return primary?.key === key ? { tracks, deviceId } : { tracks }
    }),
  setTrackGain: (key, gain) =>
    set((s) => ({ tracks: s.tracks.map((t) => (t.key === key ? { ...t, gain } : t)) })),
  setTrackName: (key, name) =>
    set((s) => ({ tracks: s.tracks.map((t) => (t.key === key ? { ...t, name } : t)) })),
  setTrackPeak: (key, peak) => set((s) => ({ trackPeaks: { ...s.trackPeaks, [key]: peak } })),

  reset: () =>
    set((s) => ({
      state: 'IDLE',
      elapsedMs: 0,
      level: { rms: 0, peak: 0 },
      levels: [],
      draftId: null,
      draftName: null,
      error: null,
      markers: [],
      trackPeaks: {},
      // 设备、增益与轨道编排都保留：多路录音连续录制时不必每次重新搭轨
      tracks: s.tracks.length > 0 ? s.tracks : defaultTracks()
    }))
}))
