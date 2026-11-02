'use strict'

const { app, session, desktopCapturer, ipcMain, systemPreferences, shell } = require('electron')
const { IPC } = require('./channels.cjs')
const { isTrustedPage, isTrustedPageUrl } = require('./trust.cjs')

/**
 * 系统内录（macOS 屏幕 / 系统声音回环）支持。
 *
 * Electron 33（Chromium 130）尚未内置 Core Audio Tap，需要手动开启 Chromium 的
 * 回环特性开关，并在 `setDisplayMediaRequestHandler` 里以 `audio: 'loopback'`
 * 授权系统声音。渲染层随后用 `getDisplayMedia({video:true,audio:true})` 取流并
 * 丢弃视频轨，只保留音频。
 *
 * macOS 需要「屏幕录制 / 系统录音」授权；首次授权后通常需重启应用。
 *
 * 全部为「诚实降级」：拿不到系统声音时抛错，不静默返回静音。
 */

/**
 * 必须在 app ready 之前调用：开启 macOS 系统声音回环特性。
 */
function configureSystemAudioCapture() {
  if (process.platform !== 'darwin') return
  // ScreenCaptureKit 回环（macOS 13+，含 14/15/26）
  app.commandLine.appendSwitch(
    'enable-features',
    'MacLoopbackAudioForScreenShare,MacSckSystemAudioLoopbackOverride'
  )
}

/**
 * 在 app ready 之后调用：注册取媒处理与权限查询 IPC。
 */
function registerDisplayCapture() {
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      // 仅信任本应用自身页面发起的取屏请求，杜绝远端/注入页面静默内录
      const initiator = request.initializationUrls?.[0]
      const trusted =
        (!initiator || isTrustedPageUrl(initiator)) && isTrustedPage(request.webContents)
      if (!trusted) {
        callback({})
        return
      }
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 0, height: 0 }
      })
      if (!sources.length) {
        callback({})
        return
      }
      // audio: 'loopback' → 抓取系统内播放的声音（而非麦克风）
      callback({ video: sources[0], audio: 'loopback' })
    } catch {
      // 抛给渲染层，由引擎按「获取失败」处理
      callback({})
    }
  })

  ipcMain.handle(IPC.appSystemAudioStatus, () => {
    if (process.platform !== 'darwin') return 'granted'
    try {
      return systemPreferences.getMediaAccessStatus('screen')
    } catch {
      return 'unknown'
    }
  })

  ipcMain.handle(IPC.appOpenScreenSettings, () => {
    if (process.platform === 'darwin') {
      shell.openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
      )
    }
    return true
  })
}

module.exports = { configureSystemAudioCapture, registerDisplayCapture }
