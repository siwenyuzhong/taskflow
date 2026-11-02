'use strict'

const { net, protocol } = require('electron')
const { pathToFileURL } = require('url')
const { getRecordingAudioPath } = require('./library.cjs')

const MEDIA_SCHEME = 'speedrec'

/**
 * 注册自定义协议，供渲染层读取录音音频，避免直接暴露本地文件路径，
 * 也绕开 file:// 与 http:// 的跨源限制。
 *
 * 路径形式：
 * - `speedrec://media/<id>` 主音频（多轨时为首轨）
 * - `speedrec://media/<id>/<trackKey>` 多轨录音的指定一路（按 meta.tracks 查表）
 *
 * 必须在 app ready 之前调用。
 */
function registerMediaScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}

function handleMediaProtocol() {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      if (url.host !== 'media') return new Response('not found', { status: 404 })
      const parts = url.pathname.replace(/^\/+/, '').split('/')
      const id = decodeURIComponent(parts[0] ?? '')
      const trackKey = parts[1] ? decodeURIComponent(parts[1]) : undefined
      if (!/^[A-Za-z0-9_-]+$/.test(id)) return new Response('bad id', { status: 400 })
      if (trackKey && !/^[A-Za-z0-9_-]+$/.test(trackKey)) return new Response('bad track', { status: 400 })
      const filePath = getRecordingAudioPath(id, trackKey)
      if (!filePath) return new Response('not found', { status: 404 })
      const res = await net.fetch(pathToFileURL(filePath).toString(), {
        bypassCustomProtocolHandlers: true
      })
      // 禁用缓存：降噪后同一 id 的文件内容会变化（audioFile 切换），
      // 若被 Chromium 缓存将读到旧音频。
      return new Response(res.body, {
        status: res.status,
        headers: {
          'content-type': res.headers.get('content-type') ?? 'application/octet-stream',
          'cache-control': 'no-store'
        }
      })
    } catch {
      return new Response('error', { status: 500 })
    }
  })
}

module.exports = { MEDIA_SCHEME, registerMediaScheme, handleMediaProtocol }
