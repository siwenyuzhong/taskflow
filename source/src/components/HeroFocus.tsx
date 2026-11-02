import { useMemo, useRef } from 'react'
import { useApp } from '../store/AppContext'
import {
  URGENCY_META,
  formatDurationLabel,
  formatDateTime,
  formatDurationShort,
  progressOf,
  remainingOf,
  splitCountdown,
  urgencyOf,
} from '../lib/time'
import { cn } from '../lib/cn'
import type { Task } from '../types'
import { IconBolt, IconCheck, IconClock, IconPlus, IconRenew, IconSparkles } from './Icons'
import { celebrate } from './Celebration'

export function HeroFocus({ task, now, onNew }: { task: Task | null; now: number; onNew: () => void }) {
  if (!task) return <HeroEmpty onNew={onNew} />
  return <HeroBody task={task} now={now} />
}

function HeroEmpty({ onNew }: { onNew: () => void }) {
  return (
    <section className="glass sheen relative overflow-hidden rounded-[28px] p-7 sm:p-9">
      <div
        className="pointer-events-none absolute -right-10 -top-16 h-56 w-56 rounded-full blur-3xl"
        style={{ background: 'radial-gradient(circle, var(--orb-a), transparent 70%)' }}
      />
      <div className="relative flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="chip" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
            <IconSparkles size={13} />
            一切就绪
          </span>
          <h2 className="mt-3.5 font-display text-[26px] font-bold t1 sm:text-[32px]">
            没有正在计时的任务
          </h2>
          <p className="mt-2 max-w-md text-[15px] t2">
            创建一个任务并设定时长（比如 4 小时），到点前会自动提醒你「即将到期」，还能一键续时长。
          </p>
        </div>
        <button className="btn btn-primary shrink-0 !min-h-[48px] !rounded-2xl !px-6" onClick={onNew}>
          <IconPlus size={18} />
          创建第一个任务
        </button>
      </div>
    </section>
  )
}

function HeroBody({ task, now }: { task: Task; now: number }) {
  const { categoryById, renewTask, completeTask } = useApp()
  const btnRef = useRef<HTMLButtonElement>(null)

  const urgency = urgencyOf(task, now)
  const meta = URGENCY_META[urgency]
  const remaining = remainingOf(task, now) ?? 0
  const progress = urgency === 'overdue' ? 1 : progressOf(task, now)
  const category = categoryById(task.categoryId)

  const R = 88
  const C = 2 * Math.PI * R
  const dash = C * (1 - progress)

  const stroke =
    urgency === 'overdue' ? 'var(--danger)' : urgency === 'soon' ? 'var(--warn)' : 'var(--cy)'

  const bigText = useMemo(() => splitCountdown(remaining), [remaining])

  const renewBase = task.durationMin ?? 30

  function handleComplete(e: React.MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    celebrate(rect.left + rect.width / 2, rect.top + rect.height / 2)
    completeTask(task.id)
  }

  return (
    <section
      className={cn(
        'glass sheen relative overflow-hidden rounded-[28px] p-6 sm:p-8',
        urgency === 'soon' && 'pulse-warn'
      )}
      style={
        urgency === 'overdue'
          ? { borderColor: 'color-mix(in srgb, var(--danger) 42%, transparent)' }
          : undefined
      }
    >
      {/* 氛围光 */}
      <div
        className="pointer-events-none absolute -left-16 -top-24 h-72 w-72 rounded-full blur-3xl transition-colors duration-700"
        style={{ background: `radial-gradient(circle, ${stroke}33, transparent 70%)` }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${stroke}, transparent)`, opacity: 0.6 }}
      />

      <div className="relative flex flex-col-reverse items-stretch gap-7 lg:flex-row lg:items-center lg:gap-10">
        {/* 左：信息与操作 */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="chip"
              style={{ background: meta.soft, color: meta.color }}
              aria-live="polite"
            >
              <span
                className="h-1.5 w-1.5 animate-breathe rounded-full"
                style={{ background: meta.color }}
              />
              {meta.label}
            </span>
            <span
              className="chip border border-line t2"
              style={{ background: 'var(--surface)' }}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: category.color }} />
              {category.name}
            </span>
            <span className="chip border border-line t3" style={{ background: 'var(--surface)' }}>
              <IconClock size={13} />
              {formatDurationLabel(task.durationMin)}
            </span>
            {task.renewCount > 0 && (
              <span className="chip" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                <IconRenew size={13} />
                已续 {task.renewCount} 次
              </span>
            )}
          </div>

          <h2 className="mt-4 break-words font-display text-[26px] font-bold leading-[1.15] t1 sm:text-[34px]">
            {task.title}
          </h2>
          {task.note && <p className="mt-2.5 max-w-xl text-[15px] leading-relaxed t2">{task.note}</p>}

          <p className="mt-3.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] t3">
            <span>到期时间 {task.dueAt ? formatDateTime(task.dueAt) : '—'}</span>
            <span className="t3">·</span>
            <span>提前 {task.remindLeadMin} 分钟提醒</span>
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-2.5">
            <button
              ref={btnRef}
              className="btn btn-primary !min-h-[48px] !rounded-2xl !px-5"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                celebrate(rect.left + rect.width / 2, rect.top + rect.height / 2)
                renewTask(task.id)
              }}
            >
              <IconRenew size={18} />
              <span>一键续 {formatDurationShort(renewBase)}</span>
            </button>
            <button
              className="btn btn-ghost !min-h-[48px] !rounded-2xl"
              onClick={() => renewTask(task.id, 30)}
            >
              <IconBolt size={16} />
              +30 分钟
            </button>
            <button
              className="btn btn-ghost !min-h-[48px] !rounded-2xl hover:!text-[var(--ok)]"
              onClick={handleComplete}
            >
              <IconCheck size={17} />
              标记完成
            </button>
          </div>
        </div>

        {/* 右：倒计时环 */}
        <div className="relative mx-auto flex w-[220px] shrink-0 items-center justify-center lg:mx-0">
          <div
            className="absolute h-[200px] w-[200px] rounded-full blur-2xl opacity-45"
            style={{ background: `radial-gradient(circle, ${stroke}, transparent 68%)` }}
          />
          <svg width="220" height="220" viewBox="0 0 220 220" className="relative -rotate-90">
            <defs>
              <linearGradient id="tf-ring" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={stroke} />
                <stop offset="100%" stopColor="var(--accent)" />
              </linearGradient>
            </defs>
            <circle cx="110" cy="110" r={R} fill="none" stroke="var(--line)" strokeWidth="9" />
            <circle
              cx="110"
              cy="110"
              r={R}
              fill="none"
              stroke="url(#tf-ring)"
              strokeWidth="9"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={dash}
              style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.6s ease' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center px-2 text-center">
            <span className="text-[11px] font-bold uppercase tracking-[0.2em] t3">
              {urgency === 'overdue' ? '已超时' : '剩余'}
            </span>
            {bigText.days > 0 && (
              <span
                className="tnum mt-0.5 font-mono font-bold leading-none t2"
                style={{ fontSize: 22, letterSpacing: '-0.02em' }}
              >
                {bigText.days}天
              </span>
            )}
            <span
              className="tnum font-mono font-bold leading-none t1"
              style={{ fontSize: bigText.days > 0 ? 30 : 38, letterSpacing: '-0.02em' }}
            >
              {bigText.clock}
            </span>
            <span className="mt-1.5 text-[12px] font-semibold" style={{ color: stroke }}>
              {Math.round(progress * 100)}% 已用
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}
