import { create } from 'zustand'
import type { FileTranscribeEvent, FileTranscribeJob } from '@shared/ipc'
import type { RecordingMeta } from '@shared/types'
import { useEditorStore } from './editor'
import { useRecorderStore } from './recorder'

/** 一条录音的离线转写任务状态 */
export interface FileJob {
  /** empty：转写完成但没识别出任何文字（纯静音录音） */
  phase: 'queued' | 'running' | 'error' | 'empty'
  /** 已定稿 + 当前句的完整文本 */
  text: string
  /** 当前句未定稿尾巴 */
  pending: string
  /** 已处理音频毫秒 */
  progressMs: number
  /** 录音总时长毫秒（可能为 0） */
  durationMs: number
  error?: string
}

interface LibraryStore {
  items: RecordingMeta[]
  loading: boolean
  /** 正在 / 排队 / 失败的离线转写任务，按录音 id 归档（支持并发多条） */
  jobs: Record<string, FileJob>
  refresh: () => Promise<void>
  remove: (id: string) => Promise<void>
  rename: (id: string, name: string) => Promise<void>
  reveal: (id: string) => Promise<void>
  /** 后台转写一条录音：立即返回，识别多少显示多少 */
  transcribe: (id: string) => Promise<void>
  cancelTranscribe: (id: string) => Promise<void>
  /** 应用主进程推来的进度事件 */
  applyFileEvent: (e: FileTranscribeEvent) => void
  /** 页面挂载时与主进程对齐（重载后不留下假进度条） */
  syncJobs: () => Promise<void>
}

const emptyJob = (phase: FileJob['phase'], durationMs = 0): FileJob => ({
  phase,
  text: '',
  pending: '',
  progressMs: 0,
  durationMs
})

export const useLibraryStore = create<LibraryStore>((set, get) => ({
  items: [],
  loading: false,
  jobs: {},

  refresh: async () => {
    set({ loading: true })
    try {
      const items = await window.api.library.list()
      set({ items })
    } finally {
      set({ loading: false })
    }
  },

  remove: async (id) => {
    // 正在转写的录音被删掉：先取消任务，免得 worker 往已删除的记录上写结果
    if (get().jobs[id]) void window.api.asr.cancelTranscribe(id)
    await window.api.library.remove(id, true)
    set((s) => ({
      items: s.items.filter((i) => i.id !== id),
      jobs: without(s.jobs, id)
    }))
    // 删除的正是编辑器当前打开的录音：复位编辑器，避免继续操作已删除的数据
    if (useEditorStore.getState().id === id) useEditorStore.getState().reset()
    // 若录音页刚保存的正是这一条，清掉「已保存」横幅，避免指代已删除的录音
    if (useRecorderStore.getState().lastMeta?.id === id) useRecorderStore.getState().setLastMeta(null)
  },

  rename: async (id, name) => {
    const updated = await window.api.library.update(id, { name })
    if (updated) set((s) => ({ items: s.items.map((i) => (i.id === id ? updated : i)) }))
  },

  reveal: async (id) => {
    await window.api.library.reveal(id)
  },

  transcribe: async (id) => {
    const cur = get().jobs[id]
    // 已经在排队或转写中：重复点击不重复排队（失败 / 没识别到内容允许重试）
    if (cur && (cur.phase === 'queued' || cur.phase === 'running')) return
    set((s) => ({ jobs: { ...s.jobs, [id]: emptyJob('queued', cur?.durationMs ?? 0) } }))
    try {
      await window.api.asr.transcribeFile(id)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set((s) => ({ jobs: { ...s.jobs, [id]: { ...emptyJob('error', s.jobs[id]?.durationMs ?? 0), error: message } } }))
    }
  },

  cancelTranscribe: async (id) => {
    await window.api.asr.cancelTranscribe(id)
    set((s) => ({ jobs: without(s.jobs, id) }))
  },

  applyFileEvent: (e) => {
    const items = get().items
    const item = items.find((i) => i.id === e.id)

    if (e.phase === 'done') {
      const transcript = e.transcript ?? null
      const finished: FileJob = {
        phase: 'empty',
        text: '',
        pending: '',
        progressMs: e.progressMs,
        durationMs: e.durationMs
      }
      set((s) => ({
        // 直接把结果并进列表项，省掉一次全量刷新带来的闪动
        items: transcript
          ? items.map((i) =>
              i.id === e.id ? { ...i, transcript, hasTranscript: !!transcript.text } : i
            )
          : s.items,
        // 有内容就收起进度条；纯静音的录音留一条「未识别到文字」，别让人以为没反应
        jobs: transcript?.text ? without(s.jobs, e.id) : { ...s.jobs, [e.id]: finished }
      }))
      return
    }

    if (e.phase === 'error') {
      set((s) => ({
        jobs: {
          ...s.jobs,
          [e.id]: {
            phase: 'error',
            text: s.jobs[e.id]?.text ?? '',
            pending: '',
            progressMs: e.progressMs,
            durationMs: e.durationMs || s.jobs[e.id]?.durationMs || 0,
            error: e.error ?? '转写失败'
          }
        }
      }))
      return
    }

    // 到这里只剩 queued / running（done 与 error 已提前返回）
    const phase: FileJob['phase'] = e.phase === 'queued' ? 'queued' : 'running'
    set((s) => ({
      jobs: {
        ...s.jobs,
        [e.id]: {
          phase,
          text: e.text,
          pending: e.pending,
          progressMs: e.progressMs,
          durationMs: e.durationMs || item?.durationMs || 0
        }
      }
    }))
  },

  syncJobs: async () => {
    let list: FileTranscribeJob[] = []
    try {
      list = await window.api.asr.transcribeList()
    } catch {
      // 主进程没准备好：只保留已经知道的任务，不清空
      return
    }
    const prev = get().jobs
    const next: Record<string, FileJob> = {}
    for (const j of list) {
      next[j.id] = {
        phase: j.phase,
        text: j.text,
        pending: j.pending,
        progressMs: j.progressMs,
        durationMs: j.durationMs,
        error: prev[j.id]?.error
      }
    }
    // 保留刚失败、主进程已经不再持有的任务，否则错误提示会一闪而过
    for (const [id, job] of Object.entries(prev)) {
      if (job.phase === 'error' && !next[id]) next[id] = job
    }
    set({ jobs: next })
  }
}))

function without<T extends object>(map: Record<string, T>, id: string): Record<string, T> {
  const { [id]: _drop, ...rest } = map
  return rest
}
