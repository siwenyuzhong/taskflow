import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '../store/AppContext'
import { cn } from '../lib/cn'
import { formatClock, taskDisplayTime } from '../lib/time'
import { IconList, IconX } from './Icons'
import type { Task } from '../types'

interface Props {
  /** 打开的日期（当天 0 点时间戳），null 表示关闭 */
  day: number | null
  now: number
  onClose: () => void
}

/**
 * 某一天的全部任务弹窗：只读查看，不支持任何操作（不能勾选、不能编辑、不能添加）。
 */
export function DayTasksDialog({ day, now, onClose }: Props) {
  const { tasks, categoryById } = useApp()

  const open = day !== null

  const list = (() => {
    if (!open) return [] as Task[]
    return tasks
      .filter((t) => !t.trashedAt)
      .filter((t) => {
        // 与 PlanBoard 的归集口径保持一致：按「计划时刻」落当天
        const anchor = taskDisplayTime(t) ?? (t.status === 'completed' ? t.completedAt : null)
        return anchor !== null && startOfDay(anchor) === day
      })
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === 'completed' ? 1 : -1
        return (taskDisplayTime(a) ?? a.completedAt ?? 0) - (taskDisplayTime(b) ?? b.completedAt ?? 0)
      })
  })()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const dayTs = day as number
  const doneCount = list.filter((t) => t.status === 'completed').length

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
        aria-label={`${formatDayLabel(dayTs)}的任务`}
        className="animate-pop-in flex max-h-[min(560px,88vh)] w-full max-w-[640px] flex-col overflow-hidden rounded-[22px] border border-line shadow-lift"
        style={{ background: 'var(--ink-800)' }}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <IconList size={16} className="shrink-0 t3" />
              <h2 className="truncate font-display text-[17px] font-bold t1">{formatDayLabel(dayTs)}</h2>
              <span
                className="shrink-0 rounded-full px-2 py-[2px] text-[11px] font-bold t3"
                style={{ background: 'var(--surface-2)' }}
              >
                只读
              </span>
            </div>
            <p className="mt-1 text-[12.5px] t3">
              {list.length === 0 ? '这一天还没有任务' : `共 ${list.length} 个任务${doneCount > 0 ? ` · 已完成 ${doneCount} 个` : ''}`}
              {' · 仅可查看'}
            </p>
          </div>
          <button className="btn-icon !min-h-[34px] !min-w-[34px] shrink-0" onClick={onClose} aria-label="关闭">
            <IconX size={17} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
          {list.length === 0 ? (
            <p className="px-2 py-8 text-center text-[13px] t3">这一天没有任务</p>
          ) : (
            list.map((t) => {
              const cat = categoryById(t.categoryId)
              const done = t.status === 'completed'
              const late = !done && t.dueAt !== null && t.dueAt <= now
              return (
                <div
                  key={t.id}
                  className="flex items-center gap-2.5 rounded-xl border border-line px-2.5 py-2"
                >
                  <span
                    className="min-w-0 flex-1 break-words whitespace-pre-wrap text-[13.5px] font-medium leading-snug"
                    style={{
                      color: late ? 'var(--danger)' : 'var(--text-1)',
                      textDecoration: done ? 'line-through' : 'none',
                      opacity: done ? 0.55 : 1,
                    }}
                  >
                    {t.title}
                  </span>
                  {taskDisplayTime(t) !== null && (
                    <span className={cn('tnum shrink-0 text-[11.5px] font-semibold', late ? 'text-[var(--danger)]' : 't3')}>
                      {formatClock(taskDisplayTime(t) as number)}
                    </span>
                  )}
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: cat.color }} />
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

/* ------------------------------------------------------------------ 工具 */

function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const DAY = 24 * 3600 * 1000

function formatDayLabel(ts: number): string {
  const d = new Date(ts)
  const w = WEEKDAYS[(d.getDay() + 6) % 7]
  const t = startOfDay(Date.now())
  if (ts === t) return `今天 · ${d.getMonth() + 1}月${d.getDate()}日`
  if (ts === t + DAY) return `明天 · ${d.getMonth() + 1}月${d.getDate()}日`
  if (ts === t - DAY) return `昨天 · ${d.getMonth() + 1}月${d.getDate()}日`
  return `${d.getMonth() + 1}月${d.getDate()}日 ${w}`
}
