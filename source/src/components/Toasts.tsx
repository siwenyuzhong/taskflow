import { memo } from 'react'
import { useApp } from '../store/AppContext'
import { cn } from '../lib/cn'
import type { Toast } from '../types'
import { IconCheckCircle, IconFlame, IconSparkles, IconX } from './Icons'

const TONE = {
  info: { color: 'var(--accent)', icon: IconSparkles },
  warn: { color: 'var(--warn)', icon: IconFlame },
  danger: { color: 'var(--danger)', icon: IconFlame },
  ok: { color: 'var(--ok)', icon: IconCheckCircle },
} as const

function ToastStackBase() {
  const { toasts, dismissToast, setFocusTaskId, holdToast, releaseToast } = useApp()

  return (
    <div
      className="pointer-events-none fixed bottom-5 right-5 z-[75] flex w-[352px] max-w-[calc(100vw-2.5rem)] flex-col gap-2.5"
      aria-live="polite"
      role="status"
    >
      {toasts.map((t) => (
        <ToastItem
          key={t.id}
          toast={t}
          onClose={() => dismissToast(t.id)}
          onHold={() => holdToast(t.id)}
          onRelease={() => releaseToast(t.id)}
          onFocusTask={() => {
            if (t.taskId) {
              setFocusTaskId(t.taskId, { scroll: true })
              window.setTimeout(() => setFocusTaskId(null), 4000)
            }
          }}
        />
      ))}
    </div>
  )
}

export const ToastStack = memo(ToastStackBase)

function ToastItem({
  toast,
  onClose,
  onHold,
  onRelease,
  onFocusTask,
}: {
  toast: Toast
  onClose: () => void
  onHold: () => void
  onRelease: () => void
  onFocusTask: () => void
}) {
  const tone = TONE[toast.tone]
  const Icon = tone.icon

  return (
    <div
      className="animate-slide-in pointer-events-auto relative overflow-hidden rounded-2xl border border-line shadow-lift"
      onMouseEnter={onHold}
      onMouseLeave={onRelease}
      style={{ background: 'color-mix(in srgb, var(--ink-800) 94%, transparent)', backdropFilter: 'blur(18px)' }}
    >
      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: tone.color }} />
      <div className="flex gap-3 p-3.5 pl-4">
        <span
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
          style={{ background: `color-mix(in srgb, ${tone.color} 16%, transparent)`, color: tone.color }}
        >
          <Icon size={16} />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-bold leading-snug t1">{toast.title}</p>
          {toast.body && <p className="mt-0.5 break-words text-[13px] leading-snug t2">{toast.body}</p>}

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {toast.action && toast.actionLabel && (
              <button
                className={cn('btn !min-h-[36px] !rounded-xl !px-3 text-[13px]')}
                style={{ background: tone.color, color: '#fff' }}
                onClick={() => {
                  onFocusTask()
                  toast.action?.()
                }}
              >
                {toast.actionLabel}
              </button>
            )}
            {toast.secondaryAction && toast.secondaryLabel && (
              <button
                className="btn btn-ghost !min-h-[36px] !rounded-xl !px-3 text-[13px]"
                onClick={() => {
                  toast.secondaryAction?.()
                  onClose()
                }}
              >
                {toast.secondaryLabel}
              </button>
            )}
            {!toast.action && toast.taskId && (
              <button
                className="text-[12.5px] font-semibold t3 transition-colors hover:t1"
                onClick={onFocusTask}
              >
                定位任务
              </button>
            )}
          </div>
        </div>

        <button
          className="btn-icon !min-h-[30px] !min-w-[30px] shrink-0 rounded-lg"
          onClick={onClose}
          aria-label="关闭提示"
        >
          <IconX size={15} />
        </button>
      </div>
    </div>
  )
}
