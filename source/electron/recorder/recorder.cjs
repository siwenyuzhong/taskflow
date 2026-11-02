'use strict'

const { ipcMain } = require('electron')
const {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} = require('fs')
const { join } = require('path')
const { IPC } = require('./channels.cjs')
const { recordingDir, recordingsRoot } = require('./paths.cjs')
const { measureAudioDurationMs } = require('./media.cjs')

const sessions = new Map()

const DRAFT_FILE = 'draft.json'

function extFromMime(mime) {
  const base = mime.split(';')[0].trim().toLowerCase()
  switch (base) {
    case 'audio/webm':
      return '.webm'
    case 'audio/ogg':
      return '.ogg'
    case 'audio/wav':
    case 'audio/wave':
    case 'audio/x-wav':
      return '.wav'
    case 'audio/mp4':
    case 'audio/aac':
      return '.m4a'
    case 'audio/mpeg':
      return '.mp3'
    default:
      return '.webm'
  }
}

/** 单轨沿用旧版 `audio.*`；多轨使用 `track-N.*`（N 从 1 开始）。 */
function laneFileName(index, total, ext) {
  return total === 1 ? `audio${ext}` : `track-${index + 1}${ext}`
}

function lanePartName(index, total) {
  return total === 1 ? 'audio.part' : `track-${index + 1}.part`
}

/** 缺省一路（兼容未传 tracks 的旧调用）。 */
function tracksOf(draft) {
  return draft.tracks && draft.tracks.length > 0
    ? draft.tracks
    : [{ key: 't0', deviceId: null, name: '主轨', gain: 1 }]
}

/** 关闭写入流并把错误标记到轨道，避免无监听 error 事件导致主进程崩溃。 */
function attachLaneErrorHandler(lane) {
  lane.stream.on('error', (err) => {
    console.error(`录音写入失败: ${lane.partPath}`, err)
    lane.error = err
  })
}

/** 等待流关闭；出错时 'finish' 不会触发，改用 'close' 并加超时兜底。 */
function closeStream(stream) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 3000)
    stream.once('close', () => {
      clearTimeout(timer)
      resolve()
    })
    try {
      stream.end()
    } catch {
      clearTimeout(timer)
      resolve()
    }
  })
}

/** 渲染进程销毁（重载/崩溃）后清理会话，保留 `.part` 与 draft 供下次启动恢复。 */
function destroySession(id) {
  const s = sessions.get(id)
  if (!s) return
  sessions.delete(id)
  for (const lane of s.lanes) {
    lane.stream.destroy()
  }
}

/** 写入 `.part` 分片，停止时再重命名为正式音频文件。 */
function registerRecorderIpc() {
  ipcMain.handle(IPC.recorderStart, (_e, draft) => {
    const dir = recordingDir(draft.id)
    mkdirSync(dir, { recursive: true })
    const ext = extFromMime(draft.mimeType)
    const tracks = tracksOf(draft)

    const lanes = tracks.map((t, index) => {
      const partPath = join(dir, lanePartName(index, tracks.length))
      return {
        key: t.key,
        name: t.name,
        deviceId: t.deviceId ?? null,
        gain: t.gain ?? 1,
        index,
        partPath,
        finalName: laneFileName(index, tracks.length, ext),
        stream: createWriteStream(partPath),
        bytes: 0
      }
    })
    lanes.forEach(attachLaneErrorHandler)

    sessions.set(draft.id, {
      id: draft.id,
      dir,
      lanes,
      byKey: new Map(lanes.map((l) => [l.key, l])),
      startedAt: Date.now(),
      mimeType: draft.mimeType,
      draft
    })
    _e.sender.once('destroyed', () => destroySession(draft.id))

    // 记录启动信息：异常退出时据此恢复各路名称与文件名
    const draftFile = { draft, startedAt: Date.now() }
    writeFileSync(join(dir, DRAFT_FILE), JSON.stringify(draftFile, null, 2), 'utf-8')

    return { id: draft.id, dir }
  })

  ipcMain.on(IPC.recorderAppend, (_e, id, trackKey, chunk) => {
    try {
      const s = sessions.get(id)
      if (!s) return
      // 未知 key 归到主轨，避免丢数据
      const lane = s.byKey.get(trackKey) ?? s.lanes[0]
      if (!lane || lane.error) return
      const buf = Buffer.from(chunk.buffer ?? chunk, chunk.byteOffset ?? 0, chunk.byteLength ?? chunk.length)
      lane.stream.write(buf)
      lane.bytes += buf.byteLength
    } catch (err) {
      console.error('录音分片写入异常', err)
    }
  })

  ipcMain.handle(IPC.recorderStop, async (_e, id, patch) => {
    const s = sessions.get(id)
    if (!s) return null
    await Promise.all(s.lanes.map((lane) => closeStream(lane.stream)))

    for (const lane of s.lanes) {
      if (existsSync(lane.partPath)) renameSync(lane.partPath, join(s.dir, lane.finalName))
    }

    const tracks = s.lanes.map((lane) => ({
      key: lane.key,
      name: lane.name,
      deviceId: lane.deviceId,
      gain: lane.gain,
      file: lane.finalName,
      bytes: existsSync(join(s.dir, lane.finalName))
        ? statSync(join(s.dir, lane.finalName)).size
        : lane.bytes
    }))
    const multi = tracks.length > 1
    const totalBytes = tracks.reduce((acc, t) => acc + t.bytes, 0)
    const now = Date.now()
    const p = patch ?? {}
    const meta = {
      id,
      name: p.name ?? `速录 ${new Date(s.startedAt).toLocaleString('zh-CN')}`,
      durationMs: p.durationMs ?? 0,
      bytes: totalBytes,
      mimeType: s.mimeType,
      audioFile: tracks[0].file,
      source: p.source ?? 'microphone',
      sampleRate: p.sampleRate ?? 48000,
      channels: p.channels ?? 1,
      createdAt: p.createdAt ?? s.startedAt,
      updatedAt: now,
      tags: p.tags ?? [],
      markers: p.markers ?? [],
      hasTranscript: (p.transcript?.text ?? '').length > 0,
      transcript: p.transcript ?? null
    }
    // 单轨工程不写 tracks，保持与旧数据一致
    if (multi) meta.tracks = tracks
    writeFileSync(join(s.dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8')
    rmSync(join(s.dir, DRAFT_FILE), { force: true })
    sessions.delete(id)
    return meta
  })

  ipcMain.handle(IPC.recorderAbort, async (_e, id) => {
    const s = sessions.get(id)
    if (!s) return
    await Promise.all(s.lanes.map((lane) => closeStream(lane.stream)))
    sessions.delete(id)
    rmSync(s.dir, { recursive: true, force: true })
  })

  ipcMain.handle(IPC.recorderListIncomplete, () => {
    const out = []
    for (const name of recordingIds()) {
      const dir = join(recordingsRoot(), name)
      if (existsSync(join(dir, 'meta.json'))) continue
      const parts = listParts(dir)
      if (parts.length === 0) continue
      out.push({
        id: name,
        dir,
        bytes: parts.reduce((acc, p) => acc + statSync(join(dir, p)).size, 0),
        startedAt: statSync(join(dir, parts[0])).mtimeMs
      })
    }
    return out
  })
}

/** 录音目录下的录音条目 id（仅子目录，忽略 .DS_Store 等杂项文件）。 */
function recordingIds() {
  const root = recordingsRoot()
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
}

/** 目录内的分片文件名（旧版 audio.part 与多轨 track-N.part）。 */
function listParts(dir) {
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.part'))
      .sort((a, b) => partIndex(a) - partIndex(b))
  } catch {
    return []
  }
}

function partIndex(partName) {
  const m = /^track-(\d+)\.part$/.exec(partName)
  return m ? Number(m[1]) - 1 : 0
}

function readDraftFile(dir) {
  const file = join(dir, DRAFT_FILE)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf-8'))
  } catch {
    return null
  }
}

/**
 * 启动时修复上次异常退出（崩溃 / 断电）遗留的录音：存在 `.part` 且无 meta.json。
 * 若留有 draft.json，按原始各路名称与文件名恢复；否则退回按序号命名。
 */
function recoverOrphanRecordings() {
  for (const name of recordingIds()) {
    const dir = join(recordingsRoot(), name)
    if (existsSync(join(dir, 'meta.json'))) continue
    const parts = listParts(dir)
    if (parts.length === 0) continue

    try {
      const draftFile = readDraftFile(dir)
      const mimeType = draftFile?.draft.mimeType || 'audio/webm'
      const ext = extFromMime(mimeType)
      const startedAt = draftFile?.startedAt ?? statSync(join(dir, parts[0])).mtimeMs
      const draftTracks = draftFile ? tracksOf(draftFile.draft) : null
      const tracks = parts.map((part, index) => {
        const finalName = laneFileName(index, parts.length, ext)
        const t = draftTracks?.[index]
        return {
          key: t?.key ?? `r${index}`,
          name: t?.name ?? (parts.length === 1 ? '主轨' : `轨道 ${index + 1}`),
          deviceId: t?.deviceId ?? null,
          gain: t?.gain ?? 1,
          file: finalName,
          bytes: existsSync(join(dir, part)) ? statSync(join(dir, part)).size : 0
        }
      })

      for (const part of parts) {
        const index = partIndex(part)
        renameSync(join(dir, part), join(dir, tracks[index].file))
      }

      const now = Date.now()
      const meta = {
        id: name,
        name: draftFile
          ? `已恢复 · ${draftFile.draft.name}`
          : `未完成速录（已恢复）${new Date(now).toLocaleString('zh-CN')}`,
        durationMs: 0,
        bytes: tracks.reduce((acc, t) => acc + t.bytes, 0),
        mimeType,
        audioFile: tracks[0].file,
        source: draftFile?.draft.source ?? 'microphone',
        sampleRate: draftFile?.draft.sampleRate ?? 48000,
        channels: draftFile?.draft.channels ?? 1,
        createdAt: startedAt,
        updatedAt: now,
        tags: ['recovered'],
        markers: [],
        hasTranscript: false,
        transcript: null
      }
      if (tracks.length > 1) meta.tracks = tracks
      writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8')
      rmSync(join(dir, DRAFT_FILE), { force: true })
      // 时长回填：webm 不带容器时长，只能解码测量；异步做，避免拖慢启动
      void backfillDuration(dir, tracks[0].file)
    } catch {
      /* 单个目录修复失败不影响其他 */
    }
  }
}

/**
 * 给刚恢复出来的条目补写时长。
 * 读回最新 meta（期间可能已被重命名或删除），仅在 durationMs 仍为 0 时写入。
 */
async function backfillDuration(dir, audioFile) {
  const ms = await measureAudioDurationMs(join(dir, audioFile))
  if (ms <= 0) return
  const metaPath = join(dir, 'meta.json')
  try {
    if (!existsSync(metaPath)) return
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
    if (meta.durationMs > 0) return
    writeFileSync(
      metaPath,
      JSON.stringify({ ...meta, durationMs: ms, updatedAt: Date.now() }, null, 2),
      'utf-8'
    )
  } catch {
    /* 条目已被删除或改写 */
  }
}

module.exports = { registerRecorderIpc, recoverOrphanRecordings }
