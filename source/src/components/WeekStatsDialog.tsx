import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '../store/AppContext'
import { cn } from '../lib/cn'
import { DAY, formatClock } from '../lib/time'
import { IconBell, IconChartBar, IconCheckCircle, IconClock, IconCopy, IconX } from './Icons'
import type { Category, Task } from '../types'

interface Props {
  /** 当前展示这一周的全部任务（含各状态），null 表示关闭 */
  tasks: Task[] | null
  /** 本周周一 0 点时间戳，用于计算星期标签 */
  monday: number
  now: number
  weekLabel: string
  onClose: () => void
}

/**
 * 本周任务统计弹窗：按具体状态（已完成 / 待办 / 已逾期）分组展示本周任务，
 * 每个状态可一键复制该状态下的全部任务。
 */
export function WeekStatsDialog({ tasks, monday, now, weekLabel, onClose }: Props) {
  const { categoryById, pushToast } = useApp()

  const open = tasks !== null

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const list = tasks as Task[]
  const isOverdue = (t: Task) => t.status !== 'completed' && t.dueAt !== null && t.dueAt <= now
  const completed = list
    .filter((t) => t.status === 'completed')
    .sort((a, b) => (b.completedAt ?? b.dueAt ?? 0) - (a.completedAt ?? a.dueAt ?? 0))
  const pending = list
    .filter((t) => t.status !== 'completed' && !isOverdue(t))
    .sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0))
  const overdue = list.filter(isOverdue).sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0))

  async function copyGroup(title: string, group: Task[]) {
    if (group.length === 0) return
    const lines = [
      `【${title}】${weekLabel} · ${group.length} 个`,
      ...group.map((t) => `${weekdayLabel(t.dueAt, monday)} ${t.dueAt !== null ? formatClock(t.dueAt) : '--:--'} ${t.title}`),
    ]
    const ok = await copyText(lines.join('\n'))
    if (ok) {
      pushToast({ tone: 'ok', title: `已复制「${title}」`, body: `${group.length} 个任务`, ttl: 1200 })
    } else {
      pushToast({ tone: 'danger', title: '复制失败', ttl: 1500 })
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[96] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-label="本周任务统计"
        className="animate-pop-in flex max-h-[min(600px,88vh)] w-full max-w-[640px] flex-col overflow-hidden rounded-[22px] border border-line shadow-lift"
        style={{ background: 'var(--ink-800)' }}
      >
        {/* 头部 */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <IconChartBar size={16} className="shrink-0 t3" />
              <h2 className="truncate font-display text-[17px] font-bold t1">本周任务统计</h2>
              <span
                className="shrink-0 rounded-full px-2 py-[2px] text-[11px] font-bold t3"
                style={{ background: 'var(--surface-2)' }}
              >
                只读
              </span>
            </div>
            <p className="mt-1 text-[12.5px] t3">{weekLabel} · 共 {list.length} 个任务</p>
          </div>
          <button className="btn-icon !min-h-[34px] !min-w-[34px] shrink-0" onClick={onClose} aria-label="关闭">
            <IconX size={17} />
          </button>
        </div>

        {/* 汇总计数 */}
        <div className="grid shrink-0 grid-cols-3 gap-2 border-b border-line px-4 py-3">
          <StatChip label="已完成" value={completed.length} color="var(--ok)" />
          <StatChip label="待办" value={pending.length} color="var(--accent)" />
          <StatChip label="已逾期" value={overdue.length} color="var(--danger)" />
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <TaskGroup
            title="已完成"
            icon={<IconCheckCircle size={14} />}
            accent="var(--ok)"
            tasks={completed}
            monday={monday}
            onCopy={() => copyGroup('已完成', completed)}
            categoryById={categoryById}
          />
          <TaskGroup
            title="待办"
            icon={<IconClock size={14} />}
            accent="var(--accent)"
            tasks={pending}
            monday={monday}
            onCopy={() => copyGroup('待办', pending)}
            categoryById={categoryById}
          />
          <TaskGroup
            title="已逾期"
            icon={<IconBell size={14} />}
            accent="var(--danger)"
            tasks={overdue}
            monday={monday}
            onCopy={() => copyGroup('已逾期', overdue)}
            categoryById={categoryById}
          />
        </div>
      </div>
    </div>,
    document.body
  )
}

/* ------------------------------------------------------------------ 汇总计数 */

function StatChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div
      className="flex flex-col items-center gap-0.5 rounded-xl border border-line px-2 py-2"
      style={{ background: 'color-mix(in srgb, var(--surface-2) 60%, transparent)' }}
    >
      <span className="tnum text-[20px] font-bold leading-none" style={{ color }}>
        {value}
      </span>
      <span className="text-[11.5px] font-semibold t3">{label}</span>
    </div>
  )
}

/* ------------------------------------------------------------------ 分组列表 */

function TaskGroup({
  title,
  icon,
  accent,
  tasks,
  monday,
  onCopy,
  categoryById,
}: {
  title: string
  icon: React.ReactNode
  accent: string
  tasks: Task[]
  monday: number
  onCopy: () => void
  categoryById: (id: string) => Category
}) {
  const done = title === '已完成'
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <span style={{ color: accent }}>{icon}</span>
        <h3 className="text-[13px] font-bold" style={{ color: accent }}>
          {title}
        </h3>
        <span className="tnum text-[12px] font-semibold t3">({tasks.length})</span>
        {tasks.length > 0 && (
          <button
            type="button"
            onClick={onCopy}
            className="ml-1 flex items-center gap-1 rounded-md px-1.5 py-1 text-[11.5px] font-semibold t3 transition-colors hover:bg-surface2 hover:t1"
            title={`复制「${title}」的全部 ${tasks.length} 个任务`}
            aria-label={`复制${title}的全部任务`}
          >
            <IconCopy size={13} />
            复制
          </button>
        )}
      </div>

      {tasks.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-3 py-3 text-center text-[12px] t3">
          本周没有{title}的任务
        </p>
      ) : (
        <div className="space-y-1.5">
          {tasks.map((t) => {
            const cat = categoryById(t.categoryId)
            return (
              <div key={t.id} className="flex items-center gap-2.5 rounded-xl border border-line px-2.5 py-2">
                <span className="tnum shrink-0 text-[11px] font-semibold t3">{weekdayLabel(t.dueAt, monday)}</span>
                <span
                  className="min-w-0 flex-1 break-words whitespace-pre-wrap text-[13.5px] font-medium leading-snug"
                  style={{
                    color: done ? 'var(--text-1)' : accent === 'var(--danger)' ? 'var(--danger)' : 'var(--text-1)',
                    textDecoration: done ? 'line-through' : 'none',
                    opacity: done ? 0.55 : 1,
                  }}
                >
                  {t.title}
                </span>
                {t.dueAt !== null && (
                  <span
                    className={cn(
                      'tnum shrink-0 text-[11.5px] font-semibold',
                      done ? 't3' : accent === 'var(--danger)' ? 'text-[var(--danger)]' : 't3'
                    )}
                  >
                    {formatClock(t.dueAt)}
                  </span>
                )}
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: cat.color }} title={cat.name} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ 工具 */

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

function weekdayLabel(dueAt: number | null, monday: number): string {
  if (dueAt === null) return '—'
  const idx = Math.round((startOfDay(dueAt) - monday) / DAY)
  return WEEKDAYS[idx >= 0 && idx < 7 ? idx : 0] ?? '—'
}

function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 写纯文本到剪贴板：优先 Clipboard API，失败退回 execCommand（与 lib/clipboard 同策略） */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 继续走 execCommand
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '-1000px'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
