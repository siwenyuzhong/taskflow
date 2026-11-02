'use strict'

const { app, ipcMain, nativeTheme, powerSaveBlocker, systemPreferences } = require('electron')
const { IPC } = require('./channels.cjs')

let keepAwakeId = null

/**
 * 「工作速录」所需的少量应用级 IPC：
 *  - 运行平台（渲染层据此做平台适配）
 *  - 录制期间阻止休眠
 *  - macOS 麦克风授权
 *  - 主题偏好（占位：速录模块跟随 Sloth 自身主题，渲染层不依赖这些）
 *
 * 窗口控制（最小化 / 最大化 / 关闭）仍由 Sloth 既有的 `taskflow:window` 负责，
 * 这里不重复注册，避免与主窗口行为冲突。
 */
function registerAppRecorderIpc() {
  ipcMain.handle(IPC.appPlatform, () => process.platform)

  ipcMain.handle(IPC.appSetKeepAwake, (_e, enabled) => {
    if (enabled) {
      if (keepAwakeId === null || !powerSaveBlocker.isStarted(keepAwakeId)) {
        // prevent-app-suspension：阻止休眠，保证后台/锁屏录制不中断
        keepAwakeId = powerSaveBlocker.start('prevent-app-suspension')
      }
    } else if (keepAwakeId !== null) {
      if (powerSaveBlocker.isStarted(keepAwakeId)) powerSaveBlocker.stop(keepAwakeId)
      keepAwakeId = null
    }
    return keepAwakeId !== null
  })

  ipcMain.handle(IPC.appRequestMicAccess, async () => {
    if (process.platform !== 'darwin') return true
    const status = systemPreferences.getMediaAccessStatus('microphone')
    if (status === 'granted') return true
    return systemPreferences.askForMediaAccess('microphone')
  })

  ipcMain.handle(IPC.appUiGet, () => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light'))
  ipcMain.handle(IPC.appUiSetTheme, (_e, pref) => {
    nativeTheme.themeSource = pref
    return pref
  })
  ipcMain.handle(IPC.appUiSetMode, () => undefined)

  app.on('will-quit', () => {
    if (keepAwakeId !== null && powerSaveBlocker.isStarted(keepAwakeId)) {
      powerSaveBlocker.stop(keepAwakeId)
    }
  })
}

module.exports = { registerAppRecorderIpc }
