import { useRecorderStore } from '@renderer/state/recorder'
import { useTranscriptStore } from '@renderer/state/transcript'
import { pauseRecording, resumeRecording, stopRecording } from '@renderer/audio/controller'
import type { FloatCommand } from '@shared/ipc'

let dispose: (() => void) | null = null

/**
 * 主窗口与「后台录制悬浮球 / 字幕悬浮窗」之间的桥：
 *
 *  - 接收悬浮球动作（暂停 / 继续 / 停止）并驱动录音引擎；
 *  - 持续把录制状态推给悬浮球（主进程仅在悬浮球存在时转发）；
 *  - 持续把字幕文本推给字幕窗；
 *  - 接收字幕窗的关闭动作，同步开关状态。
 *
 * 全局只需调用一次（SpeedRecBoard 挂载时），返回取消订阅函数。
 */
export function initWindowsBridge(): () => void {
  if (dispose) return dispose

  const offFloat = window.api.windows.onFloatCommand((c: FloatCommand) => {
    if (c === 'pause') pauseRecording()
    else if (c === 'resume') resumeRecording()
    else if (c === 'stop') void stopRecording()
    // 'restore' 由主进程直接处理
  })

  const offSub = window.api.windows.onSubtitleCommand((c) => {
    if (c === 'hide') useRecorderStore.getState().setSubtitleOn(false)
  })

  // 录制状态：仅在状态或整 200ms 计时变化时推送，避免 ~25Hz 的高频 IPC
  const unsubRec = useRecorderStore.subscribe((s, prev) => {
    if (
      s.state === prev.state &&
      Math.floor(s.elapsedMs / 200) === Math.floor(prev.elapsedMs / 200)
    ) {
      return
    }
    window.api.windows.pushFloatState({ state: s.state, elapsedMs: s.elapsedMs })
  })

  // 字幕文本：转写增量变化时推送
  const unsubTr = useTranscriptStore.subscribe((s, prev) => {
    if (
      s.text === prev.text &&
      s.pending === prev.pending &&
      s.segments === prev.segments &&
      s.pendingSpeaker === prev.pendingSpeaker
    ) {
      return
    }
    const lastSeg = s.segments.length ? s.segments[s.segments.length - 1] : null
    const lastSpeaker = lastSeg && typeof lastSeg.speaker === 'number' ? lastSeg.speaker : null
    // 有未定稿尾巴时用实时探测的说话人；否则用最后一句定稿的说话人
    const speaker = s.pending ? (s.pendingSpeaker ?? lastSpeaker) : lastSpeaker
    window.api.windows.pushSubtitle({ text: s.text, segments: s.segments, pending: s.pending, speaker })
  })

  dispose = () => {
    offFloat()
    offSub()
    unsubRec()
    unsubTr()
    dispose = null
  }
  return dispose
}
