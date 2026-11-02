/** 录音音频源 */
export type AudioSource = 'microphone' | 'system' | 'mixed'

/** 运行平台 */
export type AppPlatform = 'darwin' | 'win32' | 'linux'

/** 单条录音的元数据（落盘为 meta.json） */
export interface RecordingMeta {
  id: string
  name: string
  /** 毫秒 */
  durationMs: number
  /** 字节 */
  bytes: number
  mimeType: string
  /** 相对于录音目录的音频文件名（多轨录音时为首轨 / 主轨文件），例如 audio.webm */
  audioFile: string
  /**
   * 多轨同时录音的各路音频（按采集顺序）；单轨录音不写该字段。
   * 降噪等仅作用于 `audioFile` 的功能对多轨条目受限。
   */
  tracks?: RecordingTrack[]
  source: AudioSource
  sampleRate: number
  channels: number
  createdAt: number
  updatedAt: number
  tags: string[]
  /** 标记点（毫秒） */
  markers: number[]
  /** 是否有未完成的转写 */
  hasTranscript: boolean
  /** 转写结果（可为空） */
  transcript?: AsrTranscript | null
  /** 降噪前的原始音频文件名（首次降噪时记录，用于「还原原声」） */
  originalAudioFile?: string
  /** 降噪前原始音频的 MIME 类型（还原时恢复） */
  originalMimeType?: string
  /** 是否已生成降噪版本（true 时 audioFile 指向降噪文件） */
  hasDenoised?: boolean
  /** 降噪模型标识 */
  denoiseModel?: string
}

/** 采集参数 */
export interface CaptureOptions {
  source: AudioSource
  deviceId?: string
  sampleRate: number
  channelCount: number
}

/**
 * 录制会话中的一路采集（多轨同时录音时一个会话包含多路）。
 * `key` 在会话内唯一，渲染进程与主进程用它路由分片数据。
 */
export interface TrackDraft {
  key: string
  /** null 表示使用系统默认输入设备 */
  deviceId: string | null
  name: string
  /** 输入增益（线性）：备份 / 安全轨通常压低，避免削波 */
  gain: number
}

/** 一条已落盘音频轨道的元数据（多轨录音会话专用）。 */
export interface RecordingTrack {
  key: string
  name: string
  deviceId: string | null
  gain: number
  /** 相对于录音目录的文件名，例如 track-1.webm */
  file: string
  bytes: number
}

/** 转写片段（句级，毫秒时间戳） */
export interface AsrSegment {
  startMs: number
  endMs: number
  text: string
  /** 说话人序号（0 起始）；本地音色在线聚类得出，可能为 null（无法判定） */
  speaker?: number | null
}

/** 一条录音的转写结果 */
export interface AsrTranscript {
  text: string
  segments: AsrSegment[]
  /** 静音区间（毫秒），由 VAD 计算，供「压缩静音」使用 */
  silences: Array<{ startMs: number; endMs: number }>
  /** 使用的模型标识 */
  model: string
  createdAt: number
}

export interface LevelFrame {
  rms: number
  peak: number
}

export interface RecordingDraft {
  id: string
  name: string
  mimeType: string
  source: AudioSource
  sampleRate: number
  channels: number
  /** 本次会话的各路采集（按采集顺序，至少一条） */
  tracks: TrackDraft[]
}
