/**
 * 非破坏性多轨编辑模型。
 *
 * 素材（原始录音）永不修改；工程由若干**轨道（Track）**组成，每条轨道是
 * 一组按时间顺序排列的**片段（Segment）**。渲染时才按片段从素材取数并求和混音。
 * 支持轨道增益 / 静音 / 独奏 / 效果链，以及片段级裁剪 / 分割 / 删除 / 增益 / 淡入淡出。
 *
 * 所有时间单位：秒；轨道默认为时间轴 0 对齐，`Track.offset` 可让整条轨道延后开始。
 */
import type { TrackEffects } from './effects'

export interface Segment {
  sourceId: string
  /** 素材内起点（秒） */
  start: number
  /** 素材内终点（秒） */
  end: number
  /** 线性增益，默认 1 */
  gain?: number
  /** 淡入时长（秒） */
  fadeIn?: number
  /** 淡出时长（秒） */
  fadeOut?: number
}

export interface Track {
  id: string
  name: string
  segments: Segment[]
  /** 轨道增益（线性），默认 1 */
  gain?: number
  muted?: boolean
  solo?: boolean
  /** 轨道效果链（EQ / 压缩 / 混响） */
  effects?: TrackEffects
  /**
   * 起点对齐偏移（秒，>= 0）：该轨整体延后这么久开始。
   * 用于修正多设备同时采集时的时钟差 / 启动延迟（毫秒级）。
   */
  offset?: number
}

export interface Project {
  tracks: Track[]
  /** 渲染最终混音时是否做爆音 / 咔哒声修复（非破坏） */
  repair?: boolean
}

let trackSeq = 0

/** 生成轨道 id（仅需本地唯一）。 */
export function newTrackId(): string {
  trackSeq += 1
  return `trk-${Date.now().toString(36)}-${trackSeq}`
}

/* ------------------------------------------------------------------ */
/* 片段级操作（作用于单条轨道的 Segment 列表）                          */
/* ------------------------------------------------------------------ */

export function segLength(seg: Segment): number {
  return Math.max(0, seg.end - seg.start)
}

export function segmentsDuration(segments: Segment[]): number {
  return segments.reduce((acc, s) => acc + segLength(s), 0)
}

/** 把素材时间映射到（单轨）时间轴上的 [start,end] 列表。 */
export function timelineMap(segments: Segment[]): Array<{ seg: Segment; t0: number; t1: number }> {
  let cursor = 0
  return segments.map((seg) => {
    const t0 = cursor
    const t1 = cursor + segLength(seg)
    cursor = t1
    return { seg, t0, t1 }
  })
}

/** 把时间轴（全局）区间换算为该轨的片段区间：轨道可整体延后 `offset` 秒开始。 */
function toLocal(from: number, to: number, offset = 0): [number, number] {
  return [from - offset, to - offset]
}

/** 保留片段列表中时间轴 [from, to] 区间的内容（时间为工程全局坐标）。 */
export function clipSegments(segments: Segment[], from: number, to: number, offset = 0): Segment[] {
  const [l, r] = toLocal(from, to, offset)
  const result: Segment[] = []
  for (const { seg, t0, t1 } of timelineMap(segments)) {
    const oStart = Math.max(t0, l)
    const oEnd = Math.min(t1, r)
    if (oEnd > oStart) {
      result.push({
        ...seg,
        start: seg.start + (oStart - t0),
        end: seg.start + (oEnd - t0)
      })
    }
  }
  return result
}

/** 删除片段列表中时间轴 [from, to] 区间（其余拼接在一起）。 */
export function deleteRangeSegments(
  segments: Segment[],
  from: number,
  to: number,
  offset = 0
): Segment[] {
  const [l, r] = toLocal(from, to, offset)
  return [...clipSegments(segments, 0, l), ...clipSegments(segments, r, Number.POSITIVE_INFINITY)]
}

/** 在时间轴 t 处分割（工程全局坐标），便于分别编辑两段。 */
export function splitSegments(segments: Segment[], t: number, offset = 0): Segment[] {
  const local = t - offset
  const result: Segment[] = []
  for (const { seg, t0, t1 } of timelineMap(segments)) {
    if (local > t0 && local < t1) {
      const cut = seg.start + (local - t0)
      result.push({ ...seg, end: cut })
      result.push({ ...seg, start: cut })
    } else {
      result.push(seg)
    }
  }
  return result
}

export function withGainSegments(segments: Segment[], gain: number): Segment[] {
  return segments.map((s) => ({ ...s, gain: (s.gain ?? 1) * gain }))
}

export function withFadeInSegments(segments: Segment[], seconds: number): Segment[] {
  return segments.map((s, i) => (i === 0 ? { ...s, fadeIn: seconds } : s))
}

export function withFadeOutSegments(segments: Segment[], seconds: number): Segment[] {
  return segments.map((s, i) => (i === segments.length - 1 ? { ...s, fadeOut: seconds } : s))
}

/* ------------------------------------------------------------------ */
/* 轨道 / 工程级操作                                                    */
/* ------------------------------------------------------------------ */

export function createTrack(name: string, sourceId: string, durationSec: number): Track {
  return { id: newTrackId(), name, segments: [{ sourceId, start: 0, end: durationSec }] }
}

export function createProject(name: string, sourceId: string, durationSec: number): Project {
  return { tracks: [createTrack(name, sourceId, durationSec)] }
}

export function trackDuration(track: Track): number {
  return segmentsDuration(track.segments)
}

/** 轨道在时间轴上的结束位置 = 起点偏移 + 内容时长。 */
export function trackEnd(track: Track): number {
  return (track.offset ?? 0) + trackDuration(track)
}

/** 工程时长 = 各轨道结束位置的最大值。 */
export function projectDuration(project: Project): number {
  return project.tracks.reduce((acc, t) => Math.max(acc, trackEnd(t)), 0)
}

export function findTrack(project: Project, trackId: string): Track | undefined {
  return project.tracks.find((t) => t.id === trackId)
}

/** 更新指定轨道（保留 repair 等其余工程字段）。 */
export function updateTrack(
  project: Project,
  trackId: string,
  fn: (t: Track) => Track
): Project {
  return {
    ...project,
    tracks: project.tracks.map((t) => (t.id === trackId ? fn(t) : t))
  }
}

export function withTrackSegments(
  project: Project,
  trackId: string,
  segments: Segment[]
): Project {
  return updateTrack(project, trackId, (t) => ({ ...t, segments }))
}

export function addTrack(project: Project, track: Track): Project {
  return { ...project, tracks: [...project.tracks, track] }
}

/** 删除轨道；至少保留一条。 */
export function removeTrack(project: Project, trackId: string): Project {
  if (project.tracks.length <= 1) return project
  return { ...project, tracks: project.tracks.filter((t) => t.id !== trackId) }
}

export function setTrackGain(project: Project, trackId: string, gain: number): Project {
  return updateTrack(project, trackId, (t) => ({ ...t, gain }))
}

/** 设置轨道起点对齐偏移（秒）；0 时清除字段，保持工程数据干净。 */
export function setTrackOffset(project: Project, trackId: string, offset: number): Project {
  const safe = Math.max(0, Math.round(offset * 1000) / 1000)
  return updateTrack(project, trackId, (t) => {
    const next = { ...t }
    if (safe > 0) next.offset = safe
    else delete next.offset
    return next
  })
}

/** 设置 / 清除轨道效果链（传 undefined 或空对象即清除）。 */
export function setTrackEffects(
  project: Project,
  trackId: string,
  effects: TrackEffects | undefined
): Project {
  return updateTrack(project, trackId, (t) => {
    const next = { ...t }
    if (effects && (effects.eq || effects.compressor || effects.reverb)) next.effects = effects
    else delete next.effects
    return next
  })
}

export function toggleTrackMute(project: Project, trackId: string): Project {
  return updateTrack(project, trackId, (t) => ({ ...t, muted: !t.muted }))
}

export function toggleTrackSolo(project: Project, trackId: string): Project {
  return updateTrack(project, trackId, (t) => ({ ...t, solo: !t.solo }))
}

/** 开启 / 关闭工程级爆音修复。 */
export function setRepair(project: Project, enabled: boolean): Project {
  const next = { ...project }
  if (enabled) next.repair = true
  else delete next.repair
  return next
}

export function equalsProject(a: Project, b: Project): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
