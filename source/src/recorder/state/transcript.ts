import { create } from 'zustand'
import type { AsrSegment } from '@shared/types'

export type TranscriptStatus = 'idle' | 'loading' | 'ready' | 'error'

interface TranscriptStore {
  status: TranscriptStatus
  /** 是否处于一次转写会话中 */
  active: boolean
  /** 完整文本（已定稿 + 当前句） */
  text: string
  /** 已定稿的句子 */
  segments: AsrSegment[]
  /** 当前句未定稿的尾巴 */
  pending: string
  /** 当前未定稿句子的说话人序号（实时探测，可能为 null） */
  pendingSpeaker: number | null
  /** VAD 判定当前是否在说话 */
  speech: boolean
  error: string | null

  setStatus: (s: TranscriptStatus) => void
  begin: () => void
  applyPartial: (p: {
    text: string
    segments: AsrSegment[]
    pending: string
    pendingSpeaker?: number | null
    silence?: boolean
  }) => void
  setError: (m: string | null) => void
  reset: () => void
}

export const useTranscriptStore = create<TranscriptStore>((set) => ({
  status: 'idle',
  active: false,
  text: '',
  segments: [],
  pending: '',
  pendingSpeaker: null,
  speech: false,
  error: null,

  setStatus: (status) => set({ status, active: status === 'loading' || status === 'ready' }),

  begin: () =>
    set({
      status: 'loading',
      active: true,
      text: '',
      segments: [],
      pending: '',
      pendingSpeaker: null,
      speech: false,
      error: null
    }),

  applyPartial: (p) =>
    set({
      text: p.text,
      segments: p.segments,
      pending: p.pending,
      pendingSpeaker: p.pendingSpeaker ?? null,
      speech: p.silence === false
    }),

  setError: (error) => set({ error, status: error ? 'error' : 'idle', active: false }),

  reset: () =>
    set({
      status: 'idle',
      active: false,
      text: '',
      segments: [],
      pending: '',
      pendingSpeaker: null,
      speech: false,
      error: null
    })
}))
