/** 主进程 / 渲染进程之间的 IPC 通道与请求响应类型（单一事实来源）。 */
import type {
  AppPlatform,
  AsrSegment,
  AsrTranscript,
  RecordingDraft,
  RecordingMeta
} from './types'

export const IPC = {
  // 应用
  appPlatform: 'app:platform',
  appMinimize: 'app:minimize',
  appToggleMaximize: 'app:toggle-maximize',
  appClose: 'app:close',
  appSetKeepAwake: 'app:set-keep-awake',
  appRequestMicAccess: 'app:request-mic-access',
  appSystemAudioStatus: 'app:system-audio-status',
  appOpenScreenSettings: 'app:open-screen-settings',

  // 界面偏好（主题 / 轻量-功能模式窗口尺寸，主进程持久化）
  appUiGet: 'app:ui-get',
  appUiSetTheme: 'app:ui-set-theme',
  appUiSetMode: 'app:ui-set-mode',

  // 录音落盘
  recorderStart: 'recorder:start',
  recorderAppend: 'recorder:append',
  recorderStop: 'recorder:stop',
  recorderAbort: 'recorder:abort',
  recorderListIncomplete: 'recorder:list-incomplete',

  // 资料库
  libraryList: 'library:list',
  libraryGet: 'library:get',
  libraryRemove: 'library:remove',
  libraryReveal: 'library:reveal',
  libraryUpdate: 'library:update',

  // 文件导出
  fileExportAudio: 'file:export-audio',

  // 语音转写
  asrAvailability: 'asr:availability',
  asrStart: 'asr:start',
  asrFeed: 'asr:feed',
  asrStop: 'asr:stop',
  asrSaveTranscript: 'asr:save-transcript',
  asrPartial: 'asr:partial',
  asrStatus: 'asr:status',
  asrError: 'asr:error',
  asrTranscribeFile: 'asr:transcribe-file',
  asrTranscribeCancel: 'asr:transcribe-cancel',
  asrTranscribeList: 'asr:transcribe-list',
  asrFilePartial: 'asr:file-partial',

  // 离线降噪
  denoiseAvailability: 'denoise:availability',
  denoiseStart: 'denoise:start',
  denoiseFeed: 'denoise:feed',
  denoiseFinish: 'denoise:finish',
  denoiseRevert: 'denoise:revert',
  denoiseStatus: 'denoise:status',

  // 后台录制悬浮球 / 字幕悬浮窗
  floatControl: 'speedrec:float',
  floatState: 'speedrec:float-state',
  floatCommand: 'speedrec:float-command',
  subtitleControl: 'speedrec:subtitle',
  subtitleText: 'speedrec:subtitle-text',
  subtitleCommand: 'speedrec:subtitle-command'
} as const

/** 主题偏好：跟随系统 / 强制浅色 / 强制深色 */
export type ThemePref = 'system' | 'light' | 'dark'

/** 界面模式：轻量（手机式大按钮）/ 功能（多页全功能） */
export type UiMode = 'simple' | 'pro'

export interface RecorderStartResult {
  id: string
  dir: string
}

export interface IncompleteRecording {
  id: string
  dir: string
  bytes: number
  startedAt: number
}

export interface LibraryUpdatePatch {
  name?: string
  tags?: string[]
  markers?: number[]
  transcript?: AsrTranscript | null
  /** 降噪相关字段（由主进程降噪流程写入） */
  audioFile?: string
  mimeType?: string
  bytes?: number
  originalAudioFile?: string
  originalMimeType?: string
  hasDenoised?: boolean
  denoiseModel?: string
}

/** 导出格式 */
export type ExportFormat = 'wav' | 'mp3'

/** 导出响度标准化目标（LUFS，两段式 loudnorm） */
export type LoudnessTarget = 'off' | '-16' | '-14'

/** 转写增量事件 */
export interface AsrPartialEvent {
  /** 当前会话的完整文本（已定稿 + 当前句） */
  text: string
  /** 已定稿的句子 */
  segments: AsrSegment[]
  /** 当前句未定稿的尾巴 */
  pending: string
  /** 当前未定稿句子的说话人序号（实时探测，可能为 null） */
  pendingSpeaker?: number | null
  /** VAD 判定当前是否处于静音 */
  silence?: boolean
}

/** 转写 worker 状态 */
export interface AsrStatusEvent {
  state: 'loading' | 'ready' | 'stopped' | 'error'
  message?: string
}

export interface AsrAvailability {
  available: boolean
  message?: string
  model?: string
}

/**
 * 资料库离线「语音转文字」进度事件。
 * 一条录音一个任务，识别多少推多少，不需要等全部完成。
 */
export interface FileTranscribeEvent {
  /** 录音 id */
  id: string
  /** 任务阶段 */
  phase: 'queued' | 'running' | 'done' | 'error'
  /** 已定稿 + 当前句的完整文本 */
  text: string
  /** 当前句未定稿的尾巴 */
  pending: string
  /** 已定稿句子 */
  segments: AsrSegment[]
  /** 已处理的音频时长（毫秒），用于算进度 */
  progressMs: number
  /** 录音总时长（毫秒），可能为 0（老数据没有记录） */
  durationMs: number
  /** phase=error 时的说明 */
  error?: string
  /** phase=done 时的最终转写，已写回 meta.json */
  transcript?: AsrTranscript
}

/** 离线转写任务快照（渲染层重载后恢复用） */
export interface FileTranscribeJob {
  id: string
  phase: 'queued' | 'running'
  progressMs: number
  durationMs: number
  text: string
  pending: string
}

/** 降噪模型是否可用 */
export interface DenoiseAvailability {
  available: boolean
  message?: string
  model?: string
}

/** 降噪 worker 状态 */
export interface DenoiseStatusEvent {
  state: 'loading' | 'ready' | 'working' | 'done' | 'stopped' | 'error'
  message?: string
}

/** 后台录制悬浮球推送的状态 */
export interface FloatState {
  state: string
  elapsedMs: number
  /** 是否展开：收起时只露出贴在屏幕右缘的小标签（由主进程注入） */
  expanded?: boolean
}

/** 悬浮球 -> 主窗口的动作（expand / collapse 由主进程直接处理） */
export type FloatCommand = 'pause' | 'resume' | 'stop' | 'restore' | 'expand' | 'collapse'

/** 字幕悬浮窗内容 */
export interface SubtitlePayload {
  text: string
  segments: AsrSegment[]
  pending: string
  /** 当前显示这句的说话人序号（可能为 null） */
  speaker?: number | null
}

/** 字幕本体在字幕窗内的矩形（DIP，窗口内坐标），供主进程做悬停命中判定 */
export interface SubtitleHitRect {
  x: number
  y: number
  w: number
  h: number
}

/** macOS 屏幕 / 系统录音授权状态 */
export type ScreenAccessStatus =
  | 'granted'
  | 'denied'
  | 'restricted'
  | 'not-determined'
  | 'unknown'

export interface AppApi {
  platform: () => Promise<AppPlatform>
  minimize: () => void
  toggleMaximize: () => void
  close: () => void
  setKeepAwake: (enabled: boolean) => Promise<boolean>
  requestMicAccess: () => Promise<boolean>

  ui: {
    /** 主题偏好（主进程持久化，启动时决定窗口底色与尺寸） */
    getTheme: () => Promise<ThemePref>
    setTheme: (pref: ThemePref) => Promise<ThemePref>
    /** 切换窗口形态：轻量小窗 / 功能大窗（尺寸按模式记忆） */
    setMode: (mode: UiMode) => Promise<void>
  }

  recorder: {
    start: (draft: RecordingDraft) => Promise<RecorderStartResult>
    /** 按轨道 key 路由分片到对应的落盘文件 */
    append: (id: string, trackKey: string, chunk: Uint8Array) => void
    stop: (id: string, patch: Partial<RecordingMeta>) => Promise<RecordingMeta | null>
    abort: (id: string) => Promise<void>
    listIncomplete: () => Promise<IncompleteRecording[]>
  }

  library: {
    list: () => Promise<RecordingMeta[]>
    get: (id: string) => Promise<RecordingMeta | null>
    remove: (id: string, deleteFile?: boolean) => Promise<void>
    reveal: (id: string) => Promise<void>
    update: (id: string, patch: LibraryUpdatePatch) => Promise<RecordingMeta | null>
  }

  file: {
    /** 导出渲染后的音频；wavData 为 16-bit WAV 字节。返回保存路径，取消则 null。 */
    exportAudio: (
      defaultName: string,
      format: ExportFormat,
      wavData: Uint8Array,
      loudness?: LoudnessTarget
    ) => Promise<string | null>
  }

  asr: {
    /** 模型是否可用（文件是否齐全） */
    availability: () => Promise<AsrAvailability>
    /** 启动/复用转写 worker 并开始一个新会话 */
    start: () => Promise<void>
    /** 推送 16kHz 单声道 PCM 分片（Float32） */
    feed: (samples: Float32Array, sampleRate: number) => void
    /** 结束会话，返回最终转写 */
    stop: () => Promise<AsrTranscript | null>
    /** 把转写结果写回录音元数据 */
    saveTranscript: (id: string, transcript: AsrTranscript) => Promise<RecordingMeta | null>
    onPartial: (cb: (e: AsrPartialEvent) => void) => () => void
    onStatus: (cb: (e: AsrStatusEvent) => void) => () => void
    onError: (cb: (message: string) => void) => () => void
    /** 后台转写一条已存盘的录音；立即返回，进度走 onFilePartial */
    transcribeFile: (id: string) => Promise<{ queued: boolean }>
    /** 取消某条录音的后台转写 */
    cancelTranscribe: (id: string) => Promise<boolean>
    /** 当前在跑 / 排队的离线转写任务 */
    transcribeList: () => Promise<FileTranscribeJob[]>
    onFilePartial: (cb: (e: FileTranscribeEvent) => void) => () => void
  }

  denoise: {
    /** 降噪模型是否可用 */
    availability: () => Promise<DenoiseAvailability>
    /** 开始一次降噪会话（复用/启动 worker） */
    start: () => Promise<void>
    /** 推送 16kHz 单声道 PCM 分片（Float32） */
    feed: (samples: Float32Array, sampleRate: number) => void
    /** 结束会话：降噪、写入降噪文件并更新元数据 */
    finish: (id: string) => Promise<RecordingMeta | null>
    /** 还原为原始音频 */
    revert: (id: string) => Promise<RecordingMeta | null>
    onStatus: (cb: (e: DenoiseStatusEvent) => void) => () => void
  }

  windows: {
    /** 后台录制悬浮球：show 会收起主窗口并显示右下角悬浮球 */
    float: (action: 'show' | 'hide') => Promise<void>
    /** 主窗口推送状态给悬浮球（仅在悬浮球存在时由主进程转发） */
    pushFloatState: (s: FloatState) => void
    /** 悬浮球发送动作：暂停/继续/停止/恢复主窗口 */
    sendFloatCommand: (c: FloatCommand) => void
    /** 主窗口订阅悬浮球的动作 */
    onFloatCommand: (cb: (c: FloatCommand) => void) => () => void
    /** 悬浮球订阅状态 */
    onFloatState: (cb: (s: FloatState) => void) => () => void
    /** 字幕悬浮窗：show/hide 显示隐藏；interactive 切换鼠标穿透 */
    subtitle: (action: 'show' | 'hide' | 'interactive', value?: boolean) => Promise<void>
    /** 字幕窗上报字幕本体矩形（窗口内坐标），主进程据此做悬停命中 */
    subtitleHit: (r: SubtitleHitRect) => void
    /** 字幕窗上报按下拖动状态：拖动期间悬停常开，防止中途重新穿透 */
    subtitleDrag: (on: boolean) => void
    /** 字幕窗订阅主进程下发的悬停状态（true=显示阴影底板与关闭按钮） */
    onSubtitleHoverState: (cb: (on: boolean) => void) => () => void
    /** 主窗口推送字幕内容 */
    pushSubtitle: (p: SubtitlePayload) => void
    /** 字幕窗订阅内容 */
    onSubtitle: (cb: (p: SubtitlePayload) => void) => () => void
    /** 字幕窗发送动作（关闭等）给主窗口 */
    sendSubtitleCommand: (c: 'hide') => void
    /** 主窗口订阅字幕窗动作 */
    onSubtitleCommand: (cb: (c: 'hide') => void) => () => void
    /** macOS 屏幕 / 系统录音授权状态 */
    systemAudioStatus: () => Promise<ScreenAccessStatus>
    /** 打开系统设置的屏幕录制授权面板（macOS） */
    openScreenSettings: () => Promise<void>
  }
}
