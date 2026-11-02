'use strict'

const { contextBridge, ipcRenderer } = require('electron')

/**
 * Minimal, explicit bridge. The renderer never touches Node or the filesystem
 * directly — everything goes through these channels.
 */
contextBridge.exposeInMainWorld('taskflow', {
  /** 同步可用，渲染层据此适配窗口留白与快捷键提示 */
  platform: process.platform,
  read: () => ipcRenderer.invoke('taskflow:read'),
  write: (data) => ipcRenderer.invoke('taskflow:write', data),
  flush: () => ipcRenderer.invoke('taskflow:flush'),
  notify: (payload) => ipcRenderer.invoke('taskflow:notify', payload),
  badge: (text) => ipcRenderer.invoke('taskflow:badge', text),
  info: () => ipcRenderer.invoke('taskflow:info'),
  revealData: () => ipcRenderer.invoke('taskflow:reveal-data'),
  saveFile: (payload) => ipcRenderer.invoke('taskflow:save-file', payload),
  openFile: () => ipcRenderer.invoke('taskflow:open-file'),
  window: (action) => ipcRenderer.invoke('taskflow:window', action),
  onFocusTask: (cb) => {
    const handler = (_event, taskId) => cb(taskId)
    ipcRenderer.on('taskflow:focus-task', handler)
    return () => ipcRenderer.removeListener('taskflow:focus-task', handler)
  },
  // ---- 轻量模式：主窗口收起到 Dock + 屏幕顶部周期性飘过待办提醒 ----
  lightmodeSet: (on) => ipcRenderer.invoke('taskflow:lightmode', !!on),
  lightmodeTasks: (payload) => ipcRenderer.invoke('taskflow:lightmode-tasks', payload),
  /** 飘条（#lightfly）点击 → 唤回主窗口并退出轻量模式 */
  lightmodeOpen: () => ipcRenderer.send('taskflow:lightmode-open'),
  /** 飘条页面每帧上报各药丸矩形，主进程据此判定鼠标悬停（穿透窗收不到鼠标事件） */
  lightmodeHit: (rects) => ipcRenderer.send('taskflow:lightmode-hit', rects),
  /** 主进程轮询出的悬停下标：null = 没悬停；数字 = 该条药丸被悬停（应暂停） */
  onLightmodeHover: (cb) => {
    const handler = (_event, index) => cb(typeof index === 'number' ? index : null)
    ipcRenderer.on('taskflow:lightmode-hover', handler)
    return () => ipcRenderer.removeListener('taskflow:lightmode-hover', handler)
  },
  onLightmodeState: (cb) => {
    const handler = (_event, on) => cb(!!on)
    ipcRenderer.on('taskflow:lightmode-state', handler)
    return () => ipcRenderer.removeListener('taskflow:lightmode-state', handler)
  },
})

// ---------------------------------------------------------------------------
// 「工作速录」(SpeedRec) 桥接层
//
// 移植自 autoRec 的 preload，暴露为 `window.api`，使移植的渲染层模块无需改动
// 即可工作。通道字符串与 `src/shared/ipc.ts` 的 IPC 常量保持一致。
// 云同步（sync）按计划不移植，此处不暴露。
// ---------------------------------------------------------------------------

/** 订阅主进程事件，返回取消订阅函数。 */
function subscribe(channel, cb) {
  const listener = (_e, payload) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('api', {
  platform: () => ipcRenderer.invoke('app:platform'),
  // 窗口控制交由 Sloth 自身的顶栏 / `taskflow:window` 处理；
  // 这里保留空实现以满足 AppApi 形态，移植的速录页面不会调用。
  minimize: () => {},
  toggleMaximize: () => {},
  close: () => {},
  setKeepAwake: (enabled) => ipcRenderer.invoke('app:set-keep-awake', enabled),
  requestMicAccess: () => ipcRenderer.invoke('app:request-mic-access'),

  ui: {
    getTheme: () => ipcRenderer.invoke('app:ui-get'),
    setTheme: (pref) => ipcRenderer.invoke('app:ui-set-theme', pref),
    setMode: (m) => ipcRenderer.invoke('app:ui-set-mode', m),
  },

  recorder: {
    start: (draft) => ipcRenderer.invoke('recorder:start', draft),
    append: (id, trackKey, chunk) => ipcRenderer.send('recorder:append', id, trackKey, chunk),
    stop: (id, patch) => ipcRenderer.invoke('recorder:stop', id, patch),
    abort: (id) => ipcRenderer.invoke('recorder:abort', id),
    listIncomplete: () => ipcRenderer.invoke('recorder:list-incomplete'),
  },

  library: {
    list: () => ipcRenderer.invoke('library:list'),
    get: (id) => ipcRenderer.invoke('library:get', id),
    remove: (id, deleteFile = true) => ipcRenderer.invoke('library:remove', id, deleteFile),
    reveal: (id) => ipcRenderer.invoke('library:reveal', id),
    update: (id, patch) => ipcRenderer.invoke('library:update', id, patch),
  },

  file: {
    exportAudio: (defaultName, format, wavData, loudness) =>
      ipcRenderer.invoke('file:export-audio', defaultName, format, wavData, loudness),
  },

  asr: {
    availability: () => ipcRenderer.invoke('asr:availability'),
    start: () => ipcRenderer.invoke('asr:start'),
    feed: (samples, sampleRate) => ipcRenderer.send('asr:feed', samples, sampleRate),
    stop: () => ipcRenderer.invoke('asr:stop'),
    saveTranscript: (id, transcript) => ipcRenderer.invoke('asr:save-transcript', id, transcript),
    onPartial: (cb) => subscribe('asr:partial', cb),
    onStatus: (cb) => subscribe('asr:status', cb),
    onError: (cb) => subscribe('asr:error', cb),
    // 资料库离线「语音转文字」
    transcribeFile: (id) => ipcRenderer.invoke('asr:transcribe-file', id),
    cancelTranscribe: (id) => ipcRenderer.invoke('asr:transcribe-cancel', id),
    transcribeList: () => ipcRenderer.invoke('asr:transcribe-list'),
    onFilePartial: (cb) => subscribe('asr:file-partial', cb),
  },

  denoise: {
    availability: () => ipcRenderer.invoke('denoise:availability'),
    start: () => ipcRenderer.invoke('denoise:start'),
    feed: (samples, sampleRate) => ipcRenderer.send('denoise:feed', samples, sampleRate),
    finish: (id) => ipcRenderer.invoke('denoise:finish', id),
    revert: (id) => ipcRenderer.invoke('denoise:revert', id),
    onStatus: (cb) => subscribe('denoise:status', cb),
  },

  windows: {
    float: (action) => ipcRenderer.invoke('speedrec:float', action),
    pushFloatState: (s) => ipcRenderer.send('speedrec:float-state', s),
    sendFloatCommand: (c) => ipcRenderer.send('speedrec:float-command', c),
    onFloatCommand: (cb) => subscribe('speedrec:float-command', cb),
    onFloatState: (cb) => subscribe('speedrec:float-state', cb),
    subtitle: (action, value) => ipcRenderer.invoke('speedrec:subtitle', action, value),
    subtitleHit: (r) => ipcRenderer.send('speedrec:subtitle-hit', r),
    subtitleDrag: (on) => ipcRenderer.send('speedrec:subtitle-drag', !!on),
    onSubtitleHoverState: (cb) => subscribe('speedrec:subtitle-hover-state', cb),
    pushSubtitle: (p) => ipcRenderer.send('speedrec:subtitle-text', p),
    onSubtitle: (cb) => subscribe('speedrec:subtitle-text', cb),
    sendSubtitleCommand: (c) => ipcRenderer.send('speedrec:subtitle-command', c),
    onSubtitleCommand: (cb) => subscribe('speedrec:subtitle-command', cb),
    systemAudioStatus: () => ipcRenderer.invoke('app:system-audio-status'),
    openScreenSettings: () => ipcRenderer.invoke('app:open-screen-settings'),
  },
})
