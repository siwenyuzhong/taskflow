import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '../store/AppContext'
import { cn } from '../lib/cn'
import { lunarLabel } from '../lib/lunar'
import { fromLocalInputValue, isSameDay, nowClockHHMM, taskDisplayTime, toLocalInputValue } from '../lib/time'
import { DayTasksDialog } from './DayTasksDialog'
import {
  IconCalendarPlus,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconList,
  IconPlus,
  IconTrash,
  IconX,
} from './Icons'
import type { Priority, Task } from '../types'

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const WEEKDAYS_SHORT = ['一', '二', '三', '四', '五', '六', '日']
const TIME_PRESETS = ['09:00', '12:00', '14:00', '18:00', '20:00']
const PRIORITIES: { key: Priority; label: string; color: string }[] = [
  { key: 'high', label: '高', color: 'var(--danger)' },
  { key: 'medium', label: '中', color: 'var(--warn)' },
  { key: 'low', label: '低', color: 'var(--cy)' },
]

/* ------------------------------------------------------------------ 时间工具 */

function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function buildMatrix(year: number, month: number): number[] {
  const first = new Date(year, month, 1)
  const offset = (first.getDay() + 6) % 7 // 周一为一周起点
  const start = new Date(year, month, 1 - offset)
  return Array.from({ length: 42 }, (_, i) =>
    new Date(start.getFullYear(), start.getMonth(), start.getDate() + i).getTime()
  )
}

function combine(dayTs: number, hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  const d = new Date(dayTs)
  d.setHours(h || 0, m || 0, 0, 0)
  return d.getTime()
}

/* ------------------------------------------------------------------ 主组件 */

interface Props {
  now: number
  onEdit: (task: Task) => void
  /** 已过去日期上的任务 -> 只读查看 */
  onView: (task: Task) => void
}

export function PlanBoard({ now, onEdit, onView }: Props) {
  const { tasks, categories, categoryById, createPlannedTask, removeTask, pushToast } = useApp()

  /** 回收站里的任务不再出现在日历与计划列表里 */
  const liveTasks = useMemo(() => tasks.filter((t) => !t.trashedAt), [tasks])

  const today = startOfDay(now)
  const [cursor, setCursor] = useState(() => {
    const d = new Date()
    return { y: d.getFullYear(), m: d.getMonth() }
  })
  const [selected, setSelected] = useState(today)
  const [composer, setComposer] = useState<{ day: number; x: number; y: number } | null>(null)
  const [dayDialog, setDayDialog] = useState<number | null>(null)

  const cells = useMemo(() => buildMatrix(cursor.y, cursor.m), [cursor])

  /** 按"天"归集任务：一律按计划/到期时间归当天；没有日期的已完成任务才按完成时间归当天 */
  const byDay = useMemo(() => {
    const map = new Map<number, Task[]>()
    const push = (key: number, t: Task) => {
      const list = map.get(key)
      if (list) list.push(t)
      else map.set(key, [t])
    }
    for (const t of liveTasks) {
      // 提前完成的任务要留在它计划的那一天（打删除线），而不是跳到「完成当天」
      const anchor = taskDisplayTime(t) ?? (t.status === 'completed' ? t.completedAt : null)
      if (anchor === null) continue
      push(startOfDay(anchor), t)
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        if (a.status !== b.status) return a.status === 'completed' ? 1 : -1
        return (taskDisplayTime(a) ?? a.completedAt ?? 0) - (taskDisplayTime(b) ?? b.completedAt ?? 0)
      })
    }
    return map
  }, [liveTasks])

  const upcoming = useMemo(
    () =>
      liveTasks
        .filter((t) => t.status === 'active' && t.dueAt !== null && t.dueAt > now)
        .sort((a, b) => (a.dueAt as number) - (b.dueAt as number)),
    [liveTasks, now]
  )
  const plannedCount = useMemo(
    () => liveTasks.filter((t) => t.planned && t.status === 'active').length,
    [liveTasks]
  )
  const overdueCount = useMemo(
    () =>
      liveTasks.filter((t) => t.status === 'active' && t.planned && t.dueAt !== null && t.dueAt <= now)
        .length,
    [liveTasks, now]
  )
  const dayTasks = byDay.get(selected) ?? []

  const monthLabel = `${cursor.y} 年 ${cursor.m + 1} 月`
  const shiftMonth = (delta: number) => {
    setCursor((c) => {
      const d = new Date(c.y, c.m + delta, 1)
      return { y: d.getFullYear(), m: d.getMonth() }
    })
  }
  const goToday = () => {
    const d = new Date()
    setCursor({ y: d.getFullYear(), m: d.getMonth() })
    setSelected(startOfDay(d.getTime()))
  }

  return (
    <section className="space-y-4">
      {/* 概览 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <h2 className="font-display text-[19px] font-bold t1">未来计划</h2>
          <span className="tnum text-[13px] font-semibold t3">
            {plannedCount} 个计划任务
            {overdueCount > 0 && (
              <span style={{ color: 'var(--warn)' }}> · {overdueCount} 个已到点</span>
            )}
          </span>
        </div>
        <p className="flex items-center gap-1.5 text-[12.5px] t3">
          <IconCalendarPlus size={14} />
          在任意日期上<b className="font-bold t2">右键</b>即可快速添加（可连续创建多个）
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        {/* 日历 */}
        <div className="glass overflow-hidden rounded-[22px] p-3 sm:p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <button className="btn-icon !min-h-[34px] !min-w-[34px]" onClick={() => shiftMonth(-1)} aria-label="上个月">
                <IconChevronLeft size={17} />
              </button>
              <button className="btn-icon !min-h-[34px] !min-w-[34px]" onClick={() => shiftMonth(1)} aria-label="下个月">
                <IconChevronRight size={17} />
              </button>
              <span className="ml-1.5 font-display text-[15.5px] font-bold t1">{monthLabel}</span>
            </div>
            <button className="btn btn-ghost !min-h-[34px] !rounded-xl !px-3 text-[12.5px]" onClick={goToday}>
              回到今天
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
            {WEEKDAYS_SHORT.map((w, i) => (
              <div
                key={w}
                className={cn(
                  'pb-1 text-center text-[11.5px] font-bold tracking-wide',
                  i >= 5 ? 'text-[var(--weekend-accent)] opacity-90' : 't3'
                )}
                title={WEEKDAYS[i]}
              >
                {w}
              </div>
            ))}

            {cells.map((day) => (
              <DayCell
                key={day}
                day={day}
                now={now}
                inMonth={new Date(day).getMonth() === cursor.m}
                isToday={day === today}
                isSelected={day === selected}
                canAdd={day >= today}
                tasks={byDay.get(day) ?? []}
                onSelect={() => setSelected(day)}
                onOpenTasks={() => {
                  setSelected(day)
                  setDayDialog(day)
                }}
                onOpenTask={(t) => (day >= today ? onEdit(t) : onView(t))}
                onContextMenu={(x, y) => {
                  setSelected(day)
                  setComposer({ day, x, y })
                }}
              />
            ))}
          </div>
        </div>

        {/* 当天任务 + 即将到来 */}
        <aside className="space-y-4">
          <div className="glass rounded-[22px] p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="font-display text-[14.5px] font-bold t1">{formatDayLabel(selected)}</p>
              <span className="tnum text-[12px] font-semibold t3">{dayTasks.length} 个</span>
            </div>
            <button
              className="btn btn-primary mt-3 w-full !min-h-[38px] !rounded-xl text-[13px]"
              disabled={selected < today}
              onClick={(e) => {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                setComposer({ day: selected, x: r.left, y: r.bottom + 6 })
              }}
              title={selected < today ? '已过去的日期不允许添加任务' : undefined}
            >
              <IconPlus size={15} />
              {selected < today ? '过去日期不能添加' : '给这一天加计划'}
            </button>
            <p className="mt-2.5 text-[12px] leading-relaxed t3">
              到设定时间会自动弹出系统通知提醒你，也能一键标记完成或推迟 1 天。
            </p>
          </div>

          <div className="glass rounded-[22px] p-4">
            <p className="font-display text-[14.5px] font-bold t1">即将到来</p>
            {upcoming.length === 0 ? (
              <p className="mt-2 text-[12.5px] t3">还没有未来的计划任务</p>
            ) : (
              <ul className="mt-2.5 space-y-1.5">
                {upcoming.slice(0, 6).map((t) => {
                  const cat = categoryById(t.categoryId)
                  return (
                    <li key={t.id}>
                      <button
                        className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left transition-colors hover:bg-surface"
                        onClick={() => {
                          setSelected(startOfDay(t.dueAt as number))
                          const d = new Date(t.dueAt as number)
                          setCursor({ y: d.getFullYear(), m: d.getMonth() })
                        }}
                      >
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: cat.color, boxShadow: `0 0 10px ${cat.color}88` }}
                        />
                        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium t2">{t.title}</span>
                        <span className="tnum shrink-0 text-[11.5px] t3">
                          {shortDay(t.dueAt as number)}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </aside>
      </div>

      {/* 查看某天全部任务：弹窗 */}
      <DayTasksDialog
        day={dayDialog}
        now={now}
        onClose={() => setDayDialog(null)}
      />

      {composer && (
        <PlanComposer
          day={composer.day}
          x={composer.x}
          y={composer.y}
          categories={categories}
          now={now}
          onClose={(count) => {
            setComposer(null)
            if (count > 0) {
              pushToast({
                tone: 'ok',
                title: `已添加 ${count} 个计划任务`,
                body: `${formatDayLabel(composer.day)} · 到点会提醒你`,
                ttl: 1000,
              })
            }
          }}
          onCreate={(input) => createPlannedTask(input)}
          onRemove={(id) => removeTask(id, { quiet: true })}
        />
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ 日期单元格 */

function DayCell({
  day,
  now,
  inMonth,
  isToday,
  isSelected,
  canAdd,
  tasks,
  onSelect,
  onOpenTasks,
  onOpenTask,
  onContextMenu,
}: {
  day: number
  now: number
  inMonth: boolean
  isToday: boolean
  isSelected: boolean
  /** 今天及之后才允许添加任务（已过去的日期只能查看） */
  canAdd: boolean
  tasks: Task[]
  onSelect: () => void
  onOpenTasks: () => void
  onOpenTask: (task: Task) => void
  onContextMenu: (x: number, y: number) => void
}) {
  const d = new Date(day)
  const dow = d.getDay()
  const isWeekend = dow === 0 || dow === 6
  const lunar = lunarLabel(day)
  const active = tasks.filter((t) => t.status === 'active')
  const doneCount = tasks.length - active.length
  const visible = tasks.slice(0, 2)

  return (
    <div
      role="gridcell"
      tabIndex={0}
      aria-selected={isSelected}
      aria-label={`${d.getMonth() + 1}月${d.getDate()}日，${tasks.length} 个任务${doneCount ? `，已完成 ${doneCount} 个` : ''}`}
      onClick={onSelect}
      onContextMenu={(e) => {
        e.preventDefault()
        if (canAdd) onContextMenu(e.clientX, e.clientY)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      className={cn(
        'group relative flex min-h-[78px] cursor-pointer flex-col rounded-[14px] border p-1.5 transition-all duration-200 sm:min-h-[96px]',
        inMonth ? 't1' : 'opacity-40',
        isSelected
          ? 'border-transparent bg-[var(--accent-soft)] shadow-[0_10px_30px_-20px_var(--accent-glow)]'
          : 'border-line hover:bg-surface'
      )}
      style={{
        background: !isSelected && isToday
          ? 'color-mix(in srgb, var(--accent) 8%, transparent)'
          : !isSelected && !canAdd && isWeekend
            ? 'var(--weekend-faint)'
            : !isSelected && !canAdd
              ? 'var(--past-soft)'
              : !isSelected && isWeekend
                ? 'var(--weekend-soft)'
                : undefined,
        borderColor:
          !isSelected && !canAdd
            ? 'color-mix(in srgb, var(--text-3) 35%, transparent)'
            : !isSelected && isWeekend
              ? 'color-mix(in srgb, var(--weekend-accent) 55%, transparent)'
              : undefined,
      }}
    >
      {/* 日期头：左上农历 / 居中任务数按钮 / 右上公历号；逾期、完成等状态不再在此显示，避免顶部拥挤遮挡 */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1 px-0.5">
        <span className="justify-self-start truncate text-[10px] font-semibold leading-[1.4] t3" title={`农历${lunar}`}>
          {lunar}
        </span>
        {tasks.length > 0 ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onOpenTasks()
            }}
            className="flex justify-self-center items-center justify-center gap-0.5 rounded-md px-1 py-0.5 t3 transition-colors hover:bg-surface2 hover:t1"
            title={`查看 ${d.getMonth() + 1}月${d.getDate()}日的全部任务`}
            aria-label={`查看全部：${d.getMonth() + 1}月${d.getDate()}日，共 ${tasks.length} 个`}
          >
            <IconList size={12} />
            <span className="tnum text-[10.5px] font-bold leading-none">{tasks.length}</span>
          </button>
        ) : (
          /* 占位：保持三列网格，让公历号固定在最右侧 */
          <span aria-hidden="true" />
        )}
        <span
          className={cn(
            'tnum justify-self-end shrink-0 text-[12.5px] font-bold leading-none',
            isToday ? 'flex h-5 w-5 items-center justify-center rounded-full text-[11px] text-white' : '',
            !isToday && !canAdd && 't3'
          )}
          style={isToday ? { background: 'var(--danger)' } : isWeekend && canAdd ? { color: 'var(--weekend-accent)' } : undefined}
        >
          {d.getDate()}
        </span>
      </div>

      <div className="mt-1 flex-1 space-y-[3px] overflow-hidden">
        {visible.map((t) => {
          const done = t.status === 'completed'
          const late = !done && t.dueAt !== null && t.dueAt <= now
          return (
            <button
              key={t.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onOpenTask(t)
              }}
              className={cn(
                'block w-full cursor-pointer truncate rounded-[6px] px-1.5 py-[2px] text-left text-[10.5px] font-medium leading-[13px] transition-all hover:ring-1 hover:ring-[var(--accent)] hover:brightness-125',
                done && 'line-through opacity-60'
              )}
              style={{
                background: late
                  ? 'rgba(255,92,122,0.16)'
                  : done
                    ? 'var(--surface-2)'
                    : 'color-mix(in srgb, var(--accent) 18%, transparent)',
                color: late ? 'var(--danger)' : 'var(--text-1)',
              }}
              title={`${clockLabel(taskDisplayTime(t) ?? t.completedAt ?? Date.now())} ${t.title} · 点击查看详情`}
              aria-label={`查看任务：${t.title}`}
            >
              {t.planned && !done ? `${clockLabel(t.dueAt as number)} ` : ''}
              {t.title}
            </button>
          )
        })}
        {tasks.length > visible.length && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onOpenTasks()
            }}
            className="block w-full cursor-pointer px-1.5 text-left text-[10.5px] font-semibold t3 transition-colors hover:t1"
            title="查看这一天的全部任务"
          >
            +{tasks.length - visible.length} 个
          </button>
        )}
      </div>

      {/* 悬浮的快捷添加（已过去的日期不提供） */}
      {canAdd && (
        <button
          className="absolute bottom-1 right-1 flex h-5 w-5 items-center justify-center rounded-md opacity-0 transition-opacity hover:bg-surface2 group-hover:opacity-100"
          aria-label="在这一天添加计划"
          onClick={(e) => {
            e.stopPropagation()
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            onContextMenu(r.left, r.bottom + 4)
          }}
        >
          <IconPlus size={12} />
        </button>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ 创建面板 */

interface ComposerProps {
  day: number
  x: number
  y: number
  categories: { id: string; name: string; color: string }[]
  now: number
  onClose: (addedCount: number) => void
  onCreate: (input: {
    title: string
    categoryId: string
    priority: Priority
    dueAt: number
    note?: string
    durationMin?: number | null
  }) => Task
  onRemove: (id: string) => void
}

function PlanComposer({ day, x, y, categories, now, onClose, onCreate, onRemove }: ComposerProps) {
  const [title, setTitle] = useState('')
  /** 可选：在面板里直接改日期（默认跟随所点日历格） */
  const [dateStr, setDateStr] = useState(() => toLocalInputValue(day).slice(0, 10))
  const [time, setTime] = useState(() => nowClockHHMM(now))
  /** 时长：默认 4 小时（到期 = 开始 + 时长）；选「不计时」= 到点提醒 */
  const [durationMin, setDurationMin] = useState<number | null>(240)
  const [priority, setPriority] = useState<Priority>('medium')
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? 'work')
  const [added, setAdded] = useState<{ id: string; title: string; at: number }[]>([])
  const [flash, setFlash] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const dueAt = fromLocalInputValue(`${dateStr}T${time}`) ?? combine(day, time)
  const dayStart = startOfDay(now)
  const pastDay = startOfDay(dueAt) < dayStart
  const pastTime = !pastDay && dueAt <= now

  useEffect(() => {
    const t = window.setTimeout(() => inputRef.current?.focus(), 60)
    const onDown = (e: MouseEvent) => {
      if (panelRef.current?.contains(e.target as Node)) return
      onClose(added.length)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose(added.length)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(t)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [added.length, onClose])

  function add() {
    const text = title.trim()
    if (!text) {
      inputRef.current?.focus()
      return
    }
    if (pastDay) return // 已过去的日期不允许添加
    const task = onCreate({ title: text, categoryId, priority, dueAt, durationMin })
    setAdded((prev) => [...prev, { id: task.id, title: task.title, at: dueAt }])
    setTitle('')
    setFlash(true)
    window.setTimeout(() => setFlash(false), 620)
    inputRef.current?.focus()
  }

  const W = 316
  const MARGIN = 12
  const [box, setBox] = useState(() => ({
    top: Math.max(MARGIN, Math.min(y, window.innerHeight - MARGIN * 2)),
    left: Math.max(MARGIN, Math.min(x, window.innerWidth - W - MARGIN)),
    maxHeight: Math.max(240, window.innerHeight - MARGIN * 2),
  }))

  /* 面板高度会随「本次已添加」列表增长，需实时测量后重新贴边，避免底部被裁 */
  useLayoutEffect(() => {
    const el = panelRef.current
    if (!el) return
    let raf = 0
    const place = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const vh = window.innerHeight
        const maxHeight = Math.max(240, vh - MARGIN * 2)
        // 用 offsetHeight 而非 getBoundingClientRect：入场动画的 scale 会让后者偏小
        const h = Math.min(el.offsetHeight || el.getBoundingClientRect().height, maxHeight)
        let top = y
        if (top + h > vh - MARGIN) top = vh - MARGIN - h // 底部放不下 → 上移
        top = Math.max(MARGIN, Math.min(top, Math.max(MARGIN, vh - MARGIN - h)))
        const left = Math.max(MARGIN, Math.min(x, window.innerWidth - W - MARGIN))
        setBox((prev) =>
          Math.abs(prev.top - top) < 0.5 &&
          Math.abs(prev.left - left) < 0.5 &&
          Math.abs(prev.maxHeight - maxHeight) < 0.5
            ? prev
            : { top, left, maxHeight }
        )
      })
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(el)
    window.addEventListener('resize', place)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('resize', place)
    }
  }, [x, y])

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="添加计划任务"
      className="animate-pop-in fixed z-[95] flex flex-col rounded-[20px] border border-line p-3.5 shadow-lift"
      style={{
        top: box.top,
        left: box.left,
        width: W,
        maxHeight: box.maxHeight,
        background: 'var(--ink-800)',
        backdropFilter: 'blur(22px)',
        boxShadow: flash ? '0 0 0 2px var(--accent), var(--shadow-lift, 0 24px 60px -30px #000)' : undefined,
      }}
    >
      <div className="flex shrink-0 items-start justify-between gap-2">
        <div>
          <p className="font-display text-[14.5px] font-bold t1">{formatDayLabel(dueAt)}</p>
          <p className="mt-0.5 text-[11.5px] t3">回车即可连续添加多个计划</p>
        </div>
        <button className="btn-icon !min-h-[30px] !min-w-[30px]" onClick={() => onClose(added.length)} aria-label="关闭">
          <IconX size={16} />
        </button>
      </div>

      <input
        ref={inputRef}
        className="field mt-3 !min-h-[42px] shrink-0 text-[14px]"
        placeholder="计划做什么？回车添加"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault()
            add()
          }
        }}
      />

      <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pr-0.5">
        <div>
          <p className="text-[11px] font-bold tracking-[0.12em] t3">日期与时间</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <input
              type="date"
              aria-label="计划日期"
              value={dateStr}
              min={toLocalInputValue(dayStart).slice(0, 10)}
              onChange={(e) => {
                const v = e.target.value
                if (v) setDateStr(v)
              }}
              className="field !min-h-[30px] !px-2 text-[12px]"
            />
            <input
              type="time"
              aria-label="计划时间"
              value={time}
              onChange={(e) => setTime(e.target.value || nowClockHHMM(now))}
              className="field !min-h-[30px] !w-[92px] !px-2 text-[12px]"
            />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {TIME_PRESETS.map((t) => (
              <button
                key={t}
                onClick={() => setTime(t)}
                className={cn('chip-btn !min-h-[30px] !px-2.5 text-[12px]', time === t && 'chip-btn-on')}
              >
                {t}
              </button>
            ))}
          </div>
          <p className="mt-2.5 text-[11px] font-bold tracking-[0.12em] t3">时长</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {(
              [
                ['不计时', null],
                ['1 小时', 60],
                ['2 小时', 120],
                ['4 小时', 240],
                ['8 小时', 480],
              ] as [string, number | null][]
            ).map(([label, mins]) => (
              <button
                key={String(mins)}
                onClick={() => setDurationMin(mins)}
                className={cn('chip-btn !min-h-[30px] !px-2.5 text-[12px]', durationMin === mins && 'chip-btn-on')}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] t3">
            {durationMin === null
              ? '到你选的时间点提醒'
              : `开始 ${durationMin / 60} 小时后到期，到期前 10 分钟自动预提醒`}
          </p>
          {pastDay ? (
            <p className="mt-1.5 text-[11.5px]" style={{ color: 'var(--danger)' }}>
              已过去的日期不能添加任务，请选择今天或以后
            </p>
          ) : pastTime ? (
            <p className="mt-1.5 text-[11.5px]" style={{ color: 'var(--warn)' }}>
              该时间已过，创建后会立刻提醒你
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          <div>
            <p className="text-[11px] font-bold tracking-[0.12em] t3">优先级</p>
            <div className="mt-1.5 flex gap-1.5">
              {PRIORITIES.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setPriority(p.key)}
                  className={cn('chip-btn !min-h-[30px] !px-2.5 text-[12px]', priority === p.key && 'chip-btn-on')}
                  style={priority === p.key ? { color: p.color, borderColor: `${p.color}66` } : undefined}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold tracking-[0.12em] t3">分类</p>
            <div className="mt-1.5 flex gap-1.5 overflow-x-auto pb-1">
              {categories.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCategoryId(c.id)}
                  className={cn(
                    'chip-btn !min-h-[30px] !shrink-0 !px-2.5 text-[12px]',
                    categoryId === c.id && 'chip-btn-on'
                  )}
                  style={categoryId === c.id ? { color: c.color, borderColor: `${c.color}66` } : undefined}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.color }} />
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {added.length > 0 && (
          <div className="rounded-2xl border border-line p-2" style={{ background: 'var(--surface)' }}>
            <p className="px-1 text-[11px] font-bold tracking-[0.12em] t3">本次已添加 {added.length} 个</p>
            <ul className="mt-1.5 space-y-1">
              {added.map((a) => (
                <li key={a.id} className="flex items-center gap-2 rounded-xl px-1.5 py-1">
                  <IconCheck size={13} />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] t1">{a.title}</span>
                  <span className="tnum shrink-0 text-[11px] t3">{clockLabel(a.at)}</span>
                  <button
                    className="btn-icon !min-h-[26px] !min-w-[26px] hover:!text-[var(--danger)]"
                    aria-label={`删除 ${a.title}`}
                    onClick={() => {
                      onRemove(a.id)
                      setAdded((prev) => prev.filter((x) => x.id !== a.id))
                    }}
                  >
                    <IconTrash size={13} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="mt-3 flex shrink-0 items-center gap-2">
        <button className="btn btn-ghost !min-h-[38px] !rounded-xl text-[13px]" onClick={() => onClose(added.length)}>
          {added.length > 0 ? '完成' : '取消'}
        </button>
        <button className="btn btn-primary flex-1 !min-h-[38px] !rounded-xl text-[13px]" onClick={add} disabled={pastDay}>
          <IconPlus size={15} />
          添加{added.length > 0 ? '下一个' : '到计划'}
        </button>
      </div>
    </div>,
    document.body
  )
}

/* ------------------------------------------------------------------ 文案工具 */

function formatDayLabel(ts: number): string {
  const d = new Date(ts)
  const w = WEEKDAYS[(d.getDay() + 6) % 7]
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const rel = (n: number) => {
    const x = new Date(today)
    x.setDate(x.getDate() + n)
    return x.getTime()
  }
  if (isSameDay(ts, today.getTime())) return `今天 · ${d.getMonth() + 1}月${d.getDate()}日 ${w}`
  if (isSameDay(ts, rel(1))) return `明天 · ${d.getMonth() + 1}月${d.getDate()}日 ${w}`
  if (isSameDay(ts, rel(-1))) return `昨天 · ${d.getMonth() + 1}月${d.getDate()}日 ${w}`
  return `${d.getMonth() + 1}月${d.getDate()}日 ${w}`
}

function clockLabel(ts: number): string {
  const d = new Date(ts)
  return `${d.getHours() < 10 ? '0' : ''}${d.getHours()}:${d.getMinutes() < 10 ? '0' : ''}${d.getMinutes()}`
}

function shortDay(ts: number): string {
  const d = new Date(ts)
  const tomorrow = new Date()
  tomorrow.setHours(0, 0, 0, 0)
  tomorrow.setDate(tomorrow.getDate() + 1)
  if (isSameDay(ts, Date.now())) return '今天'
  if (isSameDay(ts, tomorrow.getTime())) return '明天'
  return `${d.getMonth() + 1}/${d.getDate()}`
}
