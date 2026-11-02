import { create } from 'zustand'
import type { RecordingMeta } from '@shared/types'
import type { Project } from '@renderer/editing/project'

export type EditorStatus = 'idle' | 'loading' | 'rendering' | 'ready' | 'error'

/** 轨道可能被撤销 / 重做移除，回退到仍存在的轨道。 */
function pickActive(project: Project, current: string | null): string | null {
  if (current && project.tracks.some((t) => t.id === current)) return current
  return project.tracks[0]?.id ?? null
}

interface EditorStore {
  id: string | null
  meta: RecordingMeta | null
  status: EditorStatus
  error: string | null
  project: Project | null
  past: Project[]
  future: Project[]
  /** 当前选中（编辑目标）的轨道 id */
  activeTrackId: string | null
  selection: [number, number] | null
  /** 当前渲染结果时长（秒） */
  duration: number
  renderedUrl: string | null
  renderedBlob: Blob | null
  playing: boolean
  rate: number
  exporting: boolean
  /** 降噪进行中 */
  denoiseBusy: boolean
  /** 最近一次渲染修复的爆音区间数 */
  repairCount: number

  init: (id: string) => void
  setMeta: (m: RecordingMeta) => void
  setStatus: (s: EditorStatus) => void
  setError: (e: string | null) => void
  setProject: (p: Project) => void
  pushProject: (p: Project) => void
  /** 记录一个历史快照（用于滑块等实时调整结束后一次性提交）。 */
  commitPast: (p: Project) => void
  undo: () => void
  redo: () => void
  setActiveTrack: (id: string) => void
  setSelection: (s: [number, number] | null) => void
  setRendered: (url: string, blob: Blob, duration: number) => void
  setPlaying: (p: boolean) => void
  setRate: (r: number) => void
  setExporting: (e: boolean) => void
  setDenoiseBusy: (b: boolean) => void
  setRepairCount: (n: number) => void
  reset: () => void
}

export const useEditorStore = create<EditorStore>((set) => ({
  id: null,
  meta: null,
  status: 'idle',
  error: null,
  project: null,
  past: [],
  future: [],
  activeTrackId: null,
  selection: null,
  duration: 0,
  renderedUrl: null,
  renderedBlob: null,
  playing: false,
  rate: 1,
  exporting: false,
  denoiseBusy: false,
  repairCount: 0,

  init: (id) => set({ id }),
  setMeta: (meta) => set({ meta }),
  setStatus: (status) => set({ status }),
  setError: (error) => set({ error }),
  setProject: (project) => set({ project }),
  pushProject: (project) =>
    set((s) => ({
      past: s.project ? [...s.past, s.project] : s.past,
      project,
      future: []
    })),
  commitPast: (prev) => set((s) => ({ past: [...s.past, prev], future: [] })),
  undo: () =>
    set((s) => {
      if (s.past.length === 0 || !s.project) return s
      const prev = s.past[s.past.length - 1]
      return {
        past: s.past.slice(0, -1),
        project: prev,
        future: [s.project, ...s.future],
        selection: null,
        activeTrackId: pickActive(prev, s.activeTrackId)
      }
    }),
  redo: () =>
    set((s) => {
      if (s.future.length === 0 || !s.project) return s
      const next = s.future[0]
      return {
        past: [...s.past, s.project],
        project: next,
        future: s.future.slice(1),
        selection: null,
        activeTrackId: pickActive(next, s.activeTrackId)
      }
    }),
  setSelection: (selection) => set({ selection }),
  setActiveTrack: (activeTrackId) => set({ activeTrackId }),
  setRendered: (renderedUrl, renderedBlob, duration) => set({ renderedUrl, renderedBlob, duration }),
  setPlaying: (playing) => set({ playing }),
  setRate: (rate) => set({ rate }),
  setExporting: (exporting) => set({ exporting }),
  setDenoiseBusy: (denoiseBusy) => set({ denoiseBusy }),
  setRepairCount: (repairCount) => set({ repairCount }),

  reset: () =>
    set({
      id: null,
      meta: null,
      status: 'idle',
      error: null,
      project: null,
      past: [],
      future: [],
      activeTrackId: null,
      selection: null,
      duration: 0,
      renderedUrl: null,
      renderedBlob: null,
      playing: false,
      rate: 1,
      exporting: false,
      denoiseBusy: false,
      repairCount: 0
    })
}))
