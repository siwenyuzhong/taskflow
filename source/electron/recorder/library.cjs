'use strict'

const { ipcMain, shell } = require('electron')
const { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } = require('fs')
const { join } = require('path')
const { IPC } = require('./channels.cjs')
const { recordingDir, recordingsRoot } = require('./paths.cjs')

function readMeta(dir) {
  const file = join(dir, 'meta.json')
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf-8'))
  } catch {
    return null
  }
}

/**
 * 返回某条录音音频文件的绝对路径（供自定义协议读取）。
 * `trackKey` 用于多轨录音定位具体某一路；只在 meta.tracks 内查表，不接受任意文件名。
 */
function getRecordingAudioPath(id, trackKey) {
  const dir = recordingDir(id)
  const meta = readMeta(dir)
  if (!meta) return null
  let file = meta.audioFile
  if (trackKey) {
    const lane = meta.tracks?.find((t) => t.key === trackKey)
    if (!lane) return null
    file = lane.file
  }
  const abs = join(dir, file)
  return existsSync(abs) ? abs : null
}

/** 更新录音元数据（合并 patch 并写回 meta.json）。 */
function updateMeta(id, patch) {
  const dir = recordingDir(id)
  const meta = readMeta(dir)
  if (!meta) return null
  const next = { ...meta, ...patch, updatedAt: Date.now() }
  if ('transcript' in patch) next.hasTranscript = !!patch.transcript?.text
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(next, null, 2), 'utf-8')
  return next
}

function registerLibraryIpc() {
  ipcMain.handle(IPC.libraryList, () => {
    const root = recordingsRoot()
    if (!existsSync(root)) return []
    const items = []
    for (const name of readdirSync(root)) {
      const meta = readMeta(join(root, name))
      if (meta) items.push(meta)
    }
    return items.sort((a, b) => b.createdAt - a.createdAt)
  })

  ipcMain.handle(IPC.libraryGet, (_e, id) => {
    return readMeta(recordingDir(id))
  })

  ipcMain.handle(IPC.libraryRemove, (_e, id, deleteFile = true) => {
    if (!deleteFile) return
    rmSync(recordingDir(id), { recursive: true, force: true })
  })

  ipcMain.handle(IPC.libraryReveal, async (_e, id) => {
    const dir = recordingDir(id)
    const meta = readMeta(dir)
    if (meta && existsSync(join(dir, meta.audioFile))) {
      shell.showItemInFolder(join(dir, meta.audioFile))
    } else if (existsSync(dir)) {
      shell.showItemInFolder(dir)
    }
  })

  ipcMain.handle(IPC.libraryUpdate, (_e, id, patch) => {
    return updateMeta(id, patch)
  })
}

module.exports = { readMeta, getRecordingAudioPath, updateMeta, registerLibraryIpc }
