'use strict'

const { app } = require('electron')
const { existsSync } = require('fs')
const { join, sep } = require('path')

/** 内置模型根目录：开发时在仓库 resources/models，打包后在 resourcesPath/models。 */
function modelsRoot() {
  return app.isPackaged
    ? join(process.resourcesPath, 'models')
    : join(app.getAppPath(), 'resources', 'models')
}

/**
 * 解析 utilityProcess 入口脚本路径（如 asr-worker.cjs / denoise-worker.cjs）。
 *
 * 打包后优先使用 asar 解包副本：utilityProcess.fork 对 asar 内脚本支持不稳，
 * 且解包副本能让 sherpa-onnx 原生模块从 app.asar.unpacked/node_modules 解析。
 */
function resolveWorkerPath(name) {
  const packed = join(__dirname, '..', 'workers', name)
  if (!app.isPackaged) return packed
  const unpacked = join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'workers', name)
  return existsSync(unpacked) ? unpacked : packed
}

/**
 * 解析可供 child_process 直接执行的 ffmpeg 路径。
 *
 * 打包后 `require('ffmpeg-static')` 返回 app.asar 内的路径，但 asar 是归档文件，
 * `fs.existsSync` 经 shim 会误报存在，而 spawn/execFile 无法从归档内执行二进制
 * （直接 ENOTDIR）。electron-builder 已通过 asarUnpack 把 ffmpeg 解包到
 * app.asar.unpacked，这里改指向该真实副本；开发模式直接返回 node_modules 路径。
 */
let ffmpegPathCached
function resolveFfmpegPath() {
  if (ffmpegPathCached !== undefined) return ffmpegPathCached
  let p = null
  try {
    p = require('ffmpeg-static') || null
  } catch {
    p = null
  }
  if (p && app.isPackaged && p.includes(`${sep}app.asar${sep}`)) {
    const unpacked = p.replace(`${sep}app.asar${sep}`, `${sep}app.asar.unpacked${sep}`)
    p = existsSync(unpacked) ? unpacked : null
  }
  ffmpegPathCached = p
  return p
}

module.exports = { modelsRoot, resolveWorkerPath, resolveFfmpegPath }
