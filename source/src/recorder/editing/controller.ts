import { encodeWav16 } from '@renderer/audio/wav'
import { runDenoise, revertDenoise } from '@renderer/denoise/controller'
import { loadMaterial, materialKey, releaseMaterial } from './material'
import { renderProject } from './render'
import {
  addTrack as addTrackToProject,
  clipSegments,
  createTrack,
  deleteRangeSegments,
  equalsProject,
  findTrack,
  removeTrack as removeTrackFromProject,
  setRepair,
  setTrackEffects,
  setTrackGain,
  setTrackOffset,
  splitSegments,
  toggleTrackMute,
  toggleTrackSolo,
  withFadeInSegments,
  withFadeOutSegments,
  withGainSegments,
  withTrackSegments,
  type Project,
  type Segment,
  type Track
} from './project'
import { editorPlayer } from './player'
import { useEditorStore } from '@renderer/state/editor'
import type { TrackEffects } from './effects'
import type { ExportFormat, LoudnessTarget } from '@shared/ipc'
import type { RecordingMeta } from '@shared/types'

/** 解码后的素材缓冲，按录音 id 缓存（整个编辑会话共享）。 */
const buffers = new Map<string, AudioBuffer>()

/** 已创建的渲染结果 Blob URL，延后回收，避免打断进行中的加载。 */
const createdUrls = new Set<string>()

function toWavBlob(rendered: Awaited<ReturnType<typeof renderProject>>): Blob {
  return new Blob([encodeWav16(rendered.channels, rendered.sampleRate)], { type: 'audio/wav' })
}

function scheduleRevoke(url: string): void {
  setTimeout(() => {
    URL.revokeObjectURL(url)
    createdUrls.delete(url)
  }, 10_000)
}

/** 渲染代际令牌：只有最后一次 rerender 的结果会被写入 store，防止旧结果覆盖新结果。 */
let renderSeq = 0
/** 打开录音的代际令牌，防止连续打开时旧加载污染新会话。 */
let openSeq = 0

async function ensureBuffers(project: Project): Promise<void> {
  for (const track of project.tracks) {
    for (const seg of track.segments) {
      if (!buffers.has(seg.sourceId)) {
        buffers.set(seg.sourceId, await loadMaterial(seg.sourceId))
      }
    }
  }
}

async function loadMaterialCached(key: string): Promise<AudioBuffer> {
  const hit = buffers.get(key)
  if (hit) return hit
  const buf = await loadMaterial(key)
  buffers.set(key, buf)
  return buf
}

/**
 * 按元数据构建工程：素材解码与建轨一步完成（多路并行解码）。
 * 多轨录音（`meta.tracks` 多于一）展开为对应条数的轨道，各轨取自己那一路素材。
 */
async function buildProject(meta: RecordingMeta): Promise<Project> {
  const lanes =
    meta.tracks && meta.tracks.length > 1
      ? meta.tracks.map((l) => ({ key: materialKey(meta.id, l.key), name: l.name || '轨道' }))
      : [{ key: materialKey(meta.id), name: meta.name || '主轨道' }]
  const loaded = await Promise.all(
    lanes.map(async (l) => ({ ...l, buf: await loadMaterialCached(l.key) }))
  )
  return {
    tracks: loaded.map((l) => createTrack(l.name, l.key, l.buf.duration || meta.durationMs / 1000))
  }
}

/** 重新渲染当前工程并生成可播放的 Blob URL（非破坏）。 */
async function rerender(): Promise<void> {
  const seq = ++renderSeq
  const store = useEditorStore.getState()
  if (!store.project) return
  store.setStatus('rendering')
  try {
    await ensureBuffers(store.project)
    const rendered = await renderProject(store.project, buffers)
    if (seq !== renderSeq) return // 已有更新的渲染排队，丢弃旧结果
    const blob = toWavBlob(rendered)
    const url = URL.createObjectURL(blob)
    createdUrls.add(url)
    const prev = useEditorStore.getState().renderedUrl
    useEditorStore.getState().setRendered(url, blob, rendered.length / rendered.sampleRate)
    useEditorStore.getState().setRepairCount(rendered.repairCount ?? 0)
    if (prev && prev !== url) scheduleRevoke(prev)
    useEditorStore.getState().setStatus('ready')
  } catch (e) {
    if (seq !== renderSeq) return
    useEditorStore.getState().setError((e as Error).message)
    useEditorStore.getState().setStatus('error')
  }
}

export async function openRecording(id: string): Promise<void> {
  const token = ++openSeq
  renderSeq++ // 作废进行中的旧渲染
  useEditorStore.getState().reset()
  for (const u of createdUrls) URL.revokeObjectURL(u)
  createdUrls.clear()
  // 释放上一会话缓存的解码素材，避免长时间使用内存无上限增长
  buffers.clear()
  useEditorStore.getState().init(id)
  useEditorStore.getState().setStatus('loading')
  try {
    const meta = await window.api.library.get(id)
    if (token !== openSeq) return
    if (!meta) throw new Error('速录不存在')
    useEditorStore.getState().setMeta(meta)
    const project = await buildProject(meta)
    if (token !== openSeq) return
    useEditorStore.getState().setProject(project)
    useEditorStore.getState().setActiveTrack(project.tracks[0].id)
    await rerender()
  } catch (e) {
    if (token !== openSeq) return
    useEditorStore.getState().setError((e as Error).message)
    useEditorStore.getState().setStatus('error')
  }
}

/** 离开编辑页时回收 Blob URL 与解码缓存。 */
export function disposeEditor(): void {
  openSeq++
  renderSeq++
  for (const u of createdUrls) URL.revokeObjectURL(u)
  createdUrls.clear()
  buffers.clear()
}

/**
 * 对当前选中轨道的片段做变换，写入历史并重渲染。
 * `offset` 为该轨的起点偏移：选区 / 播放头都是工程全局坐标，需换算回轨道本地坐标。
 */
async function applyToActive(fn: (segments: Segment[], offset: number) => Segment[]): Promise<void> {
  const store = useEditorStore.getState()
  const { project, activeTrackId } = store
  if (!project || !activeTrackId) return
  const track = findTrack(project, activeTrackId)
  if (!track) return
  store.pushProject(withTrackSegments(project, activeTrackId, fn(track.segments, track.offset ?? 0)))
  await rerender()
}

/** 对工程整体做变换，写入历史并重渲染。 */
async function applyProject(fn: (project: Project) => Project): Promise<void> {
  const current = useEditorStore.getState().project
  if (!current) return
  useEditorStore.getState().pushProject(fn(current))
  await rerender()
}

export const editorOps = {
  async trimToSelection(): Promise<void> {
    const { selection } = useEditorStore.getState()
    if (!selection) return
    await applyToActive((s, offset) => clipSegments(s, selection[0], selection[1], offset))
    useEditorStore.getState().setSelection(null)
  },

  async deleteSelection(): Promise<void> {
    const { selection } = useEditorStore.getState()
    if (!selection) return
    await applyToActive((s, offset) => deleteRangeSegments(s, selection[0], selection[1], offset))
    useEditorStore.getState().setSelection(null)
  },

  async splitAtPlayhead(): Promise<void> {
    const t = editorPlayer.getTime()
    await applyToActive((s, offset) => splitSegments(s, t, offset))
  },

  async gain(factor: number): Promise<void> {
    await applyToActive((s) => withGainSegments(s, factor))
  },

  async fadeIn(seconds: number): Promise<void> {
    await applyToActive((s) => withFadeInSegments(s, seconds))
  },

  async fadeOut(seconds: number): Promise<void> {
    await applyToActive((s) => withFadeOutSegments(s, seconds))
  },

  /** 从资料库追加轨道；多轨录音会把它的所有路都加进来。 */
  async addTrack(sourceId: string): Promise<void> {
    const store = useEditorStore.getState()
    if (!store.project) return
    const meta = await window.api.library.get(sourceId)
    if (!meta) throw new Error('速录不存在')

    const lanes = meta.tracks && meta.tracks.length > 1 ? meta.tracks : null
    const created: Track[] = []
    let project = store.project
    for (const lane of lanes ?? [{ key: undefined as string | undefined, name: meta.name || '轨道' }]) {
      const key = materialKey(sourceId, lane.key)
      if (!buffers.has(key)) buffers.set(key, await loadMaterial(key))
      const duration = buffers.get(key)?.duration ?? meta.durationMs / 1000
      const track = createTrack(lane.name || meta.name || '轨道', key, duration)
      project = addTrackToProject(project, track)
      created.push(track)
    }
    useEditorStore.getState().pushProject(project)
    if (created[0]) useEditorStore.getState().setActiveTrack(created[0].id)
    useEditorStore.getState().setSelection(null)
    await rerender()
  },

  async removeTrack(trackId: string): Promise<void> {
    const store = useEditorStore.getState()
    if (!store.project) return
    const next = removeTrackFromProject(store.project, trackId)
    if (next === store.project) return // 至少保留一条轨道
    store.pushProject(next)
    if (store.activeTrackId === trackId) {
      useEditorStore.getState().setActiveTrack(next.tracks[0].id)
    }
    useEditorStore.getState().setSelection(null)
    await rerender()
  },

  /** 切换当前编辑目标轨道（不重渲染）。 */
  setActiveTrack(trackId: string): void {
    useEditorStore.getState().setActiveTrack(trackId)
    useEditorStore.getState().setSelection(null)
  },

  async toggleMute(trackId: string): Promise<void> {
    await applyProject((p) => toggleTrackMute(p, trackId))
  },

  async toggleSolo(trackId: string): Promise<void> {
    await applyProject((p) => toggleTrackSolo(p, trackId))
  },

  /** 开启 / 关闭工程级爆音修复（写历史 + 重渲染）。 */
  async setRepair(enabled: boolean): Promise<void> {
    await applyProject((p) => setRepair(p, enabled))
  },

  /** 起点对齐：整条轨道延后 `seconds` 秒参与混音（修正多设备时钟差）。 */
  async setTrackOffset(trackId: string, seconds: number): Promise<void> {
    await applyProject((p) => setTrackOffset(p, trackId, seconds))
  },

  /**
   * 起点对齐微调（增量）：当前值取 store，避免连续点击时用到渲染前的旧值。
   * 限幅 0..10s。
   */
  async nudgeOffset(trackId: string, delta: number): Promise<void> {
    const project = useEditorStore.getState().project
    const track = project ? findTrack(project, trackId) : undefined
    if (!track) return
    const current = track.offset ?? 0
    const next = Math.min(10, Math.max(0, Math.round((current + delta) * 1000) / 1000))
    if (next === current) return
    await applyProject((p) => setTrackOffset(p, trackId, next))
  },

  /**
   * 轨道增益的实时调整：不写历史，仅更新工程并重渲染（配合滑块拖动）。
   * 释放滑块时用 commitHistory 记录一次历史。
   */
  async setTrackGainLive(trackId: string, gain: number): Promise<void> {
    const current = useEditorStore.getState().project
    if (!current) return
    useEditorStore.getState().setProject(setTrackGain(current, trackId, gain))
    await rerender()
  },

  /**
   * 轨道效果（EQ / 压缩 / 混响）的实时调整：不写历史，仅更新工程并重渲染。
   * 效果面板关闭时用 commitHistory 记录一次历史。
   */
  async setTrackEffectsLive(trackId: string, effects: TrackEffects | undefined): Promise<void> {
    const current = useEditorStore.getState().project
    if (!current) return
    useEditorStore.getState().setProject(setTrackEffects(current, trackId, effects))
    await rerender()
  },

  /** 连续调整（滑块 / 效果面板）结束后落一次历史（prev 为调整前的工程快照）。 */
  commitHistory(prev: Project): void {
    const current = useEditorStore.getState().project
    if (current && !equalsProject(current, prev)) {
      useEditorStore.getState().commitPast(prev)
    }
  },

  async restore(): Promise<void> {
    const store = useEditorStore.getState()
    if (!store.project) return
    await ensureBuffers(store.project)
    const tracks: Track[] = store.project.tracks.map((t) => {
      const src = t.segments[0]?.sourceId
      const buf = src ? buffers.get(src) : undefined
      // 「还原全部」连同起点对齐一起回到初始状态
      const next: Track = { ...t, muted: false, solo: false, gain: 1, effects: undefined }
      delete next.offset
      if (!src || !buf) return next
      return { ...next, segments: [{ sourceId: src, start: 0, end: buf.duration }] }
    })
    useEditorStore.getState().pushProject({ ...store.project, tracks })
    useEditorStore.getState().setSelection(null)
    await rerender()
  },

  async undo(): Promise<void> {
    useEditorStore.getState().undo()
    await rerender()
  },

  async redo(): Promise<void> {
    useEditorStore.getState().redo()
    await rerender()
  },

  /** 对当前录音执行离线降噪（非破坏，原始文件保留）。多轨录音不支持。 */
  async denoise(): Promise<void> {
    const { id } = useEditorStore.getState()
    if (!id) return
    const block = multiTrackBlock()
    if (block) {
      useEditorStore.getState().setError(block)
      return
    }
    const store = useEditorStore.getState()
    store.setDenoiseBusy(true)
    store.setError(null)
    try {
      const meta = await runDenoise(id)
      if (!meta) throw new Error('降噪失败')
      useEditorStore.getState().setMeta(meta)
      await reloadSource(id)
    } catch (e) {
      useEditorStore.getState().setError((e as Error).message)
    } finally {
      useEditorStore.getState().setDenoiseBusy(false)
    }
  },

  /** 还原为降噪前的原始音频。 */
  async revertDenoise(): Promise<void> {
    const { id } = useEditorStore.getState()
    if (!id) return
    const block = multiTrackBlock()
    if (block) {
      useEditorStore.getState().setError(block)
      return
    }
    const store = useEditorStore.getState()
    store.setDenoiseBusy(true)
    store.setError(null)
    try {
      const meta = await revertDenoise(id)
      if (meta) useEditorStore.getState().setMeta(meta)
      await reloadSource(id)
    } catch (e) {
      useEditorStore.getState().setError((e as Error).message)
    } finally {
      useEditorStore.getState().setDenoiseBusy(false)
    }
  }
}

/** 素材文件变化后重新解码并重渲染（保留工程编辑不变）；多轨时逐路刷新。 */
async function reloadSource(id: string): Promise<void> {
  const lanes = useEditorStore.getState().meta?.tracks
  const keys =
    lanes && lanes.length > 1 ? lanes.map((l) => materialKey(id, l.key)) : [materialKey(id)]
  for (const key of keys) {
    releaseMaterial(key)
    buffers.delete(key)
    buffers.set(key, await loadMaterial(key))
  }
  await rerender()
}

/** 多轨录音不支持整体降噪（只替换一路会破坏各轨对齐），给出诚实说明。 */
function multiTrackBlock(): string | null {
  const meta = useEditorStore.getState().meta
  return meta?.tracks && meta.tracks.length > 1
    ? '多轨速录暂不支持整体降噪（会破坏各轨对齐）；可导出单轨后逐轨处理，或使用爆音修复'
    : null
}

export async function exportProject(
  format: ExportFormat,
  loudness: LoudnessTarget = 'off'
): Promise<string | null> {
  const { renderedBlob, meta } = useEditorStore.getState()
  if (!renderedBlob) return null
  useEditorStore.getState().setExporting(true)
  try {
    const bytes = new Uint8Array(await renderedBlob.arrayBuffer())
    const base = (meta?.name ?? 'export').replace(/[\\/:*?"<>|]/g, '_')
    return await window.api.file.exportAudio(`${base}.${format}`, format, bytes, loudness)
  } finally {
    useEditorStore.getState().setExporting(false)
  }
}
