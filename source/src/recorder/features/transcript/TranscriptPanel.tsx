import { useEffect, useRef } from 'react'
import { useTranscriptStore } from '@renderer/state/transcript'
import { useRecorderStore } from '@renderer/state/recorder'
import { formatTimer } from '@renderer/lib/format'
import { speakerColor, speakerLabel } from '@renderer/lib/speakers'
import { cn } from '@renderer/lib/cn'

/**
 * 实时转写面板：读取 transcript store，边录边出字幕。
 * 数据来自主进程 utilityProcess 中的 sherpa-onnx（Zipformer 14M）。
 */
export function TranscriptPanel(): JSX.Element {
  const status = useTranscriptStore((s) => s.status)
  const text = useTranscriptStore((s) => s.text)
  const segments = useTranscriptStore((s) => s.segments)
  const pending = useTranscriptStore((s) => s.pending)
  const pendingSpeaker = useTranscriptStore((s) => s.pendingSpeaker)
  const speech = useTranscriptStore((s) => s.speech)
  const error = useTranscriptStore((s) => s.error)
  const transcribe = useRecorderStore((s) => s.transcribe)
  const markers = useRecorderStore((s) => s.markers)
  const recorderState = useRecorderStore((s) => s.state)

  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [text, pending])

  const showLive = text.length > 0 || pending.length > 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 状态条 */}
      <div className="flex items-center gap-2 px-5 pt-3.5 text-[11px] text-sr-ink-faint">
        {transcribe ? (
          <>
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                status === 'ready'
                  ? speech
                    ? 'animate-pulse bg-sr-rec'
                    : 'bg-emerald-400'
                  : status === 'error'
                    ? 'bg-sr-warn'
                    : 'animate-pulse bg-sr-ink-faint'
              )}
            />
            {status === 'loading'
              ? '加载模型…'
              : status === 'error'
                ? '转写不可用'
                : speech
                  ? '识别中'
                  : '聆听中'}
          </>
        ) : (
          <>
            <span className="h-1.5 w-1.5 rounded-full bg-sr-ink-faint" />
            转写已关闭
          </>
        )}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {error && (
          <div className="mb-3 rounded-xl border border-sr-warn/25 bg-sr-warn-soft px-3 py-2 text-[12px] text-sr-warn">
            {error}
          </div>
        )}

        {!transcribe ? (
          <Empty>未开启实时转写。在下方「实时转写」开关打开后，边录边出字幕。</Empty>
        ) : !showLive && status !== 'error' ? (
          <Empty>
            {status === 'loading' ? '正在加载离线语音模型…' : '开始说话，字幕会实时出现在这里。'}
          </Empty>
        ) : (
          <div className="flex flex-col gap-3">
            {segments.map((seg, i) => {
              const sp = typeof seg.speaker === 'number' ? seg.speaker : null
              const showSpeaker = sp !== null && sp !== segments[i - 1]?.speaker
              return (
                <p key={`${seg.startMs}-${i}`} className="text-[13.5px] leading-relaxed text-sr-ink">
                  {showSpeaker && (
                    <span
                      className="mr-2 inline-block rounded-full px-2 py-0.5 align-middle text-[10px] font-semibold text-white"
                      style={{ background: speakerColor(sp) }}
                    >
                      {speakerLabel(sp)}
                    </span>
                  )}
                  <span className="tabular mr-2 align-middle text-[10px] text-sr-ink-faint">
                    {formatTimer(seg.startMs)}
                  </span>
                  {seg.text}
                </p>
              )
            })}
            {pending && (
              <p className="text-[13.5px] leading-relaxed text-sr-ink-muted">
                {pendingSpeaker !== null &&
                  pendingSpeaker !== segments[segments.length - 1]?.speaker && (
                    <span
                      className="mr-2 inline-block rounded-full px-2 py-0.5 align-middle text-[10px] font-semibold text-white"
                      style={{ background: speakerColor(pendingSpeaker) }}
                    >
                      {speakerLabel(pendingSpeaker)}
                    </span>
                  )}
                {segments.length === 0 && (
                  <span className="tabular mr-2 align-middle text-[10px] text-sr-ink-faint">00:00.0</span>
                )}
                {pending}
                <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-sr-accent align-middle" />
              </p>
            )}
          </div>
        )}

        {markers.length > 0 && (
          <div className="mt-5">
            <div className="mb-2 text-[11px] uppercase tracking-wider text-sr-ink-faint">标记点</div>
            <ul className="flex flex-col gap-1">
              {markers.map((ms, i) => (
                <li
                  key={`${ms}-${i}`}
                  className="flex items-center gap-2 rounded-lg bg-sr-elevated/70 px-3 py-1.5 text-[12px] text-sr-ink-muted"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-sr-accent" />
                  <span className="tabular">{formatTimer(ms)}</span>
                  <span className="ml-auto text-[11px] text-sr-ink-faint">#{i + 1}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="border-t border-sr-line/70 px-5 py-3 text-[11px] text-sr-ink-faint">
        {recorderState === 'RECORDING'
          ? transcribe
            ? `录制中 · 已识别 ${text.replace(/\s/g, '').length} 字`
            : '录制中 · 转写未开启'
          : '本地处理，不上传'}
      </div>
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="rounded-xl border border-dashed border-sr-line/80 px-4 py-6 text-center">
      <p className="text-[12px] leading-relaxed text-sr-ink-faint">{children}</p>
    </div>
  )
}
