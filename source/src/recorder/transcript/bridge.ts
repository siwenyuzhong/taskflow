import { useTranscriptStore } from '@renderer/state/transcript'
import { useLibraryStore } from '@renderer/state/library'

let dispose: (() => void) | null = null
let disposeFile: (() => void) | null = null

/**
 * 订阅主进程的转写事件并写入 transcript store。
 * 全局只需调用一次（App 挂载时调用），返回取消订阅函数。
 */
export function initTranscriptBridge(): () => void {
  if (dispose) return dispose

  const offPartial = window.api.asr.onPartial((e) =>
    useTranscriptStore.getState().applyPartial({
      text: e.text,
      segments: e.segments,
      pending: e.pending,
      pendingSpeaker: e.pendingSpeaker ?? null,
      silence: e.silence
    })
  )
  const offStatus = window.api.asr.onStatus((e) => {
    const store = useTranscriptStore.getState()
    if (e.state === 'error') store.setError(e.message ?? '转写出错')
    else if (e.state === 'stopped') store.setStatus('idle')
    else store.setStatus(e.state)
  })
  const offError = window.api.asr.onError((m) => useTranscriptStore.getState().setError(m))

  dispose = () => {
    offPartial()
    offStatus()
    offError()
    dispose = null
  }
  return dispose
}

/**
 * 订阅资料库离线「语音转文字」的进度事件并写入 library store 的 jobs。
 * 全局只需调用一次（App 挂载时调用），返回取消订阅函数。
 */
export function initFileTranscribeBridge(): () => void {
  if (disposeFile) return disposeFile

  const off = window.api.asr.onFilePartial((e) => useLibraryStore.getState().applyFileEvent(e))

  disposeFile = () => {
    off()
    disposeFile = null
  }
  return disposeFile
}
