'use strict'

/**
 * IPC 通道名（与渲染层 `src/shared/ipc.ts` 的 IPC 常量保持一致）。
 * 主进程侧独立一份，避免跨 ts/js 模块格式差异。
 */
const IPC = {
  // 应用
  appPlatform: 'app:platform',
  appMinimize: 'app:minimize',
  appToggleMaximize: 'app:toggle-maximize',
  appClose: 'app:close',
  appSetKeepAwake: 'app:set-keep-awake',
  appRequestMicAccess: 'app:request-mic-access',
  appSystemAudioStatus: 'app:system-audio-status',
  appOpenScreenSettings: 'app:open-screen-settings',

  // 界面偏好（窗口尺寸，主进程处理）
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
  // 资料库离线「语音转文字」
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
  subtitleCommand: 'speedrec:subtitle-command',
  subtitleHit: 'speedrec:subtitle-hit',
  subtitleDrag: 'speedrec:subtitle-drag',
  subtitleHoverState: 'speedrec:subtitle-hover-state'
}

module.exports = { IPC }
