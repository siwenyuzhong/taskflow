'use strict'

/**
 * 页面可信度判断：仅本应用自身页面（file://、speedrec://、本地开发服务器）视为可信。
 */
function isTrustedPageUrl(urlString) {
  try {
    const url = new URL(String(urlString))
    if (url.protocol === 'file:' || url.protocol === 'speedrec:') return true
    const dev = process.env.VITE_DEV_SERVER_URL
    return Boolean(dev) && url.origin === new URL(dev).origin
  } catch {
    return false
  }
}

function isTrustedPage(wc) {
  try {
    return isTrustedPageUrl(wc.getURL())
  } catch {
    return false
  }
}

module.exports = { isTrustedPage, isTrustedPageUrl }
