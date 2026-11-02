'use strict'

/**
 * 「工作速录」(SpeedRec) 主进程入口。
 *
 * 由 `electron/main.cjs` 调用：
 *  - `registerMediaScheme()` 必须在 app ready 之前执行；
 *  - `registerRecorderFeature()` 在 whenReady 内注册全部 IPC、协议处理与崩溃恢复；
 *  - `disposeRecorder()` 在 will-quit 时回收转写 / 降噪 worker。
 */

const { session } = require('electron')
const { registerAppRecorderIpc } = require('./app.cjs')
const { registerRecorderIpc, recoverOrphanRecordings } = require('./recorder.cjs')
const { registerLibraryIpc } = require('./library.cjs')
const { registerFileIpc } = require('./file.cjs')
const { registerAsrIpc } = require('./asr.cjs')
const { registerDenoiseIpc } = require('./denoise.cjs')
const { handleMediaProtocol, registerMediaScheme } = require('./protocol.cjs')
const { isTrustedPage } = require('./trust.cjs')
const { asrService } = require('./asr-service.cjs')
const { fileAsrService } = require('./file-asr-service.cjs')
const { denoiseService } = require('./denoise-service.cjs')
const { configureSystemAudioCapture, registerDisplayCapture } = require('./capture.cjs')
const {
  initRecorderWindows,
  disposeRecorderWindows
} = require('./windows.cjs')

/** 注册自定义媒体协议（speedrec://）。必须在 app ready 之前调用。 */
function registerSpeedRecScheme() {
  registerMediaScheme()
  // 系统内录（macOS 回环）需要在 app ready 之前开启 Chromium 特性开关
  configureSystemAudioCapture()
}

/** 注册速录相关的全部 IPC 与协议处理（在 app ready 之后调用）。 */
function registerRecorderFeature(opts) {
  // 权限：仅对本应用自身页面放行麦克风 / 系统内录（display-capture）与通知；
  // 其余页面与权限一律拒绝，防止被注入的远端页面静默录音录屏。
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    const allowedType =
      permission === 'media' ||
      permission === 'display-capture' ||
      permission === 'notifications'
    callback(allowedType && isTrustedPage(wc))
  })

  registerAppRecorderIpc()
  registerRecorderIpc()
  registerLibraryIpc()
  registerFileIpc()
  registerAsrIpc()
  registerDenoiseIpc()
  handleMediaProtocol()
  registerDisplayCapture()
  initRecorderWindows(opts)

  // 修复上次异常退出遗留的录音
  recoverOrphanRecordings()
}

/** 回收转写 / 离线转写 / 降噪 worker（will-quit 时调用）。 */
function disposeRecorder() {
  asrService.dispose()
  fileAsrService.dispose()
  denoiseService.dispose()
  disposeRecorderWindows()
}

module.exports = { registerSpeedRecScheme, registerRecorderFeature, disposeRecorder }
