import { useMemo, useState } from 'react'
import { useApp } from '../store/AppContext'
import { DAY, formatClock, nowClockHHMM, taskDisplayTime } from '../lib/time'
import { cn } from '../lib/cn'
import type { Category, Task } from '../types'
import { IconCalendar, IconChartBar, IconCheck, IconChevronLeft, IconChevronRight, IconList, IconPlus } from './Icons'
import { DayTasksDialog } from './DayTasksDialog'
import { WeekStatsDialog } from './WeekStatsDialog'

interface Props {
  now: number
  onEdit: (task: Task) => void
  /** 已过去日期上的任务 -> 只读查看 */
  onView: (task: Task) => void
}

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

/**
 * 每周任务：周一至周日 + 真实日期，每个日期可直接创建待办。
 * 创建的任务带 dueAt（到点提醒），也会出现在「未来计划」里。
 */
export function WeekBoard({ now, onEdit, onView }: Props) {
  const { tasks, categories, categoryById, createPlannedTask, completeTask, restoreTask, pushToast } = useApp()

  const today = startOfDay(now)
  const [weekOffset, setWeekOffset] = useState(0)
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [times, setTimes] = useState<Record<number, string>>({})
  const [dayDialog, setDayDialog] = useState<number | null>(null)
  const [statsOpen, setStatsOpen] = useState(false)

  const liveTasks = useMemo(() => tasks.filter((t) => !t.trashedAt), [tasks])

  const monday = mondayOf(now) + weekOffset * 7 * DAY
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => monday + i * DAY), [monday])
  const weekEnd = days[6] + DAY

  const byDay = useMemo(() => {
    const map = new Map<number, Task[]>()
    for (const t of liveTasks) {
      const anchor = taskDisplayTime(t)
      if (anchor === null) continue
      const key = startOfDay(anchor)
      if (key < monday || key >= weekEnd) continue
      const list = map.get(key)
      if (list) list.push(t)
      else map.set(key, [t])
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        if (a.status !== b.status) return a.status === 'completed' ? 1 : -1
        return (taskDisplayTime(a) ?? 0) - (taskDisplayTime(b) ?? 0)
      })
    }
    return map
  }, [liveTasks, monday, weekEnd])

  const weekLabel = `${fmtDate(days[0])} – ${fmtDate(days[6])}`
  const inThisWeek = weekOffset === 0
  const pendingThisWeek = useMemo(
    () => days.reduce((acc, d) => acc + (byDay.get(d)?.filter((t) => t.status === 'active').length ?? 0), 0),
    [byDay, days]
  )

  /** 本周展示的全部任务（含已完成与其他状态），供统计弹窗使用 */
  const weekTasks = useMemo(() => {
    const all: Task[] = []
    for (const list of byDay.values()) all.push(...list)
    return all
  }, [byDay])

  const shift = (delta: number) => setWeekOffset((w) => w + delta)
  const goToday = () => setWeekOffset(0)

  function addTask(day: number) {
    if (day < today) return // 已过去的日期不允许添加待办
    const title = (drafts[day] ?? '').trim()
    if (!title) return
    const hhmm = times[day] ?? nowClockHHMM()
    createPlannedTask({
      title,
      categoryId: categories[0]?.id ?? 'work',
      priority: 'medium',
      dueAt: combine(day, hhmm),
      allowPast: true,
    })
    setDrafts((prev) => ({ ...prev, [day]: '' }))
    pushToast({
      tone: 'ok',
      title: '已安排到' + WEEKDAYS[((day - monday) / DAY) % 7],
      body: `${title} · ${hhmm}`,
      ttl: 1000,
    })
  }

  return (
    <section className="animate-fade-up space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <h2 className="font-display text-[19px] font-bold t1">每周任务</h2>
          <span className="tnum text-[13px] font-semibold t3">{weekLabel}</span>
          {!inThisWeek && (
            <button
              className="rounded-lg border border-line px-2 py-0.5 text-[12px] font-bold t2 transition-colors hover:t1"
              onClick={goToday}
            >
              回到本周
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="tnum mr-1 text-[13px] font-semibold t3">
            {pendingThisWeek} 个待办
            {byDay.get(today)?.some((t) => t.status === 'active' && t.dueAt !== null && t.dueAt <= now) ? (
              <span style={{ color: 'var(--danger)' }}> · 今天有已到点任务</span>
            ) : null}
          </span>
          <button
            className="flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[12px] font-bold t2 transition-colors hover:t1"
            onClick={() => setStatsOpen(true)}
            aria-label="统计"
          >
            <IconChartBar size={14} />
            统计
          </button>
          <button className="btn-icon !min-h-[34px] !min-w-[34px]" onClick={() => shift(-1)} aria-label="上一周">
            <IconChevronLeft size={17} />
          </button>
          <button className="btn-icon !min-h-[34px] !min-w-[34px]" onClick={() => shift(1)} aria-label="下一周">
            <IconChevronRight size={17} />
          </button>
        </div>
      </div>

      <p className="flex items-center gap-1.5 text-[12.5px] t3">
        <IconCalendar size={14} />
        每周从<b className="font-bold t2">周一</b>开始；每列直接显示当天任务，点<b className="font-bold t2">查看全部</b>可查看/管理当天全部任务，在底部直接输入即可创建当天待办。
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        {days.map((day, i) => (
          <DayColumn
            key={day}
            day={day}
            index={i}
            now={now}
            isToday={day === today}
            isWeekend={i >= 5}
            dead={day < today}
            tasks={byDay.get(day) ?? []}
            draft={drafts[day] ?? ''}
            time={times[day] ?? nowClockHHMM()}
            onDraft={(v) => setDrafts((prev) => ({ ...prev, [day]: v }))}
            onTime={(v) => setTimes((prev) => ({ ...prev, [day]: v }))}
            onAdd={() => addTask(day)}
            onOpenTasks={() => setDayDialog(day)}
            onToggle={(t) => (t.status === 'completed' ? restoreTask(t.id) : completeTask(t.id))}
            onOpen={(t) => (day < today ? onView(t) : onEdit(t))}
            categoryById={categoryById}
          />
        ))}
      </div>

      <DayTasksDialog
        day={dayDialog}
        now={now}
        onClose={() => setDayDialog(null)}
      />

      <WeekStatsDialog
        tasks={statsOpen ? weekTasks : null}
        monday={monday}
        now={now}
        weekLabel={weekLabel}
        onClose={() => setStatsOpen(false)}
      />
    </section>
  )
}

/* ------------------------------------------------------------------ 单日列 */

function DayColumn({
  day,
  index,
  now,
  isToday,
  isWeekend,
  dead,
  tasks,
  draft,
  time,
  onDraft,
  onTime,
  onAdd,
  onOpenTasks,
  onToggle,
  onOpen,
  categoryById,
}: {
  day: number
  index: number
  now: number
  isToday: boolean
  isWeekend: boolean
  /** 已过去的日期：不允许添加待办，任务只可查看 */
  dead: boolean
  tasks: Task[]
  draft: string
  time: string
  onDraft: (v: string) => void
  onTime: (v: string) => void
  onAdd: () => void
  onOpenTasks: () => void
  onToggle: (task: Task) => void
  onOpen: (task: Task) => void
  categoryById: (id: string) => Category
}) {
  const active = tasks.filter((t) => t.status === 'active')
  const hasOverdue = active.some((t) => t.dueAt !== null && t.dueAt <= now)
  const doneCount = tasks.length - active.length

  return (
    <div
      className={cn(
        'glass flex min-h-[240px] flex-col overflow-hidden rounded-[20px] transition-all duration-300',
        isToday && 'border-[color-mix(in_srgb,var(--accent)_55%,transparent)]',
        isWeekend && !isToday && !dead && 'border-[color-mix(in_srgb,var(--weekend-accent)_55%,transparent)]',
        dead && 'border-[color-mix(in_srgb,var(--text-3)_40%,transparent)]'
      )}
      style={
        isToday
          ? { background: 'color-mix(in srgb, var(--accent) 7%, transparent)' }
          : dead
            ? { background: 'var(--past-soft)' }
            : isWeekend
              ? { background: 'var(--weekend-soft)' }
              : undefined
      }
    >
      {/* 日期头 */}
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span
            className={cn(
              'font-display text-[14.5px] font-bold',
              isToday ? 't1' : 't2'
            )}
            style={isWeekend && !isToday && !dead ? { color: 'var(--weekend-accent)' } : undefined}
          >
            {WEEKDAYS[index]}
          </span>
          <span
            className={cn('tnum text-[12.5px] font-semibold', isToday ? 't2' : 't3')}
          >
            {new Date(day).getMonth() + 1}月{new Date(day).getDate()}日
          </span>
          {isToday && (
            <span
              className="rounded-full px-1.5 py-[1px] text-[10px] font-bold text-white"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--cy))' }}
            >
              今天
            </span>
          )}
        </div>
        {tasks.length > 0 && (
          <div className="flex shrink-0 items-center gap-1.5">
            {hasOverdue && (
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: 'var(--danger)', boxShadow: '0 0 8px var(--danger)' }}
              />
            )}
            <button
              type="button"
              onClick={onOpenTasks}
              className="flex items-center justify-center gap-1 rounded-md px-1.5 py-1 t3 transition-colors hover:bg-surface2 hover:t1"
              title={`查看${new Date(day).getMonth() + 1}月${new Date(day).getDate()}日的全部任务`}
              aria-label={`查看全部：${new Date(day).getMonth() + 1}月${new Date(day).getDate()}日，共 ${tasks.length} 个`}
            >
              <IconList size={13} />
              <span className="tnum text-[11.5px] font-bold leading-none">{tasks.length}</span>
            </button>
          </div>
        )}
      </div>

      {/* 当天任务（内联显示，可滚动） */}
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2" style={{ maxHeight: 220 }}>
        {tasks.length === 0 ? (
          <p className="flex h-full min-h-[96px] items-center justify-center text-center text-[12px] t3">
            暂无任务
          </p>
        ) : (
          tasks.map((t) => {
            const cat = categoryById(t.categoryId)
            const done = t.status === 'completed'
            const late = !dead && !done && t.dueAt !== null && t.dueAt <= now
            const disp = taskDisplayTime(t)
            return (
              <div
                key={t.id}
                title={dead ? '已过去的日期 · 仅可查看' : '点击查看'}
                className="group flex cursor-pointer items-center gap-2 rounded-lg border border-line px-2 py-1.5 transition-all hover:-translate-y-px hover:border-[color-mix(in_srgb,var(--text-2)_30%,transparent)]"
                onClick={() => onOpen(t)}
              >
                {dead ? (
                  <span
                    aria-hidden
                    className="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[5px] border border-line opacity-40"
                  />
                ) : (
                  <button
                    type="button"
                    aria-label={done ? '恢复任务' : '标记完成'}
                    onClick={(e) => {
                      e.stopPropagation()
                      onToggle(t)
                    }}
                    className={cn(
                      'flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[5px] border transition-all',
                      done ? 'border-transparent' : 'border-line hover:border-[var(--ok)]'
                    )}
                    style={done ? { background: 'var(--ok)', color: 'white' } : undefined}
                  >
                    {done && <IconCheck size={12} />}
                  </button>
                )}
                <span
                  className="min-w-0 flex-1 truncate text-[12.5px] font-medium"
                  style={{
                    color: late ? 'var(--danger)' : 'var(--text-1)',
                    textDecoration: done ? 'line-through' : 'none',
                    opacity: done ? 0.55 : 1,
                  }}
                >
                  {t.title}
                </span>
                {disp !== null && (
                  <span className={cn('tnum shrink-0 text-[10.5px] font-semibold', late ? 'text-[var(--danger)]' : 't3')}>
                    {formatClock(disp)}
                  </span>
                )}
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: cat.color }} />
              </div>
            )
          })
        )}
      </div>

      {/* 完成统计 */}
      {doneCount > 0 && (
        <p className="shrink-0 px-3 text-[10.5px] font-semibold t3">已完成 {doneCount} 个</p>
      )}

      {/* 快速创建（已过去的日期不提供） */}
      {dead ? (
        <div className="flex shrink-0 items-center gap-1.5 border-t border-line p-2">
          <span className="flex w-full items-center justify-center gap-1 text-[11.5px] font-semibold t3 py-1">
            已过去的日期，不能添加待办
          </span>
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-1.5 border-t border-line p-2">
          <input
            type="time"
            aria-label="时间"
            value={time}
            onChange={(e) => onTime(e.target.value || nowClockHHMM())}
            className="field !min-h-[34px] !w-[74px] shrink-0 !px-1.5 text-[11.5px]"
          />
          <input
            className="field min-w-0 flex-1 !min-h-[34px] !px-2.5 text-[12.5px]"
            placeholder="添加待办…"
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault()
                onAdd()
              }
            }}
          />
          <button
            className="btn btn-primary !min-h-[34px] !rounded-xl !px-2.5 text-[12.5px]"
            onClick={onAdd}
            aria-label="添加待办"
            disabled={!draft.trim()}
          >
            <IconPlus size={14} />
          </button>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ 工具 */

function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function mondayOf(ts: number): number {
  const d = new Date(ts)
  const wd = (d.getDay() + 6) % 7 // 周一 = 0
  const start = startOfDay(ts)
  return start - wd * DAY
}

function combine(dayTs: number, hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  const d = new Date(dayTs)
  d.setHours(h || 0, m || 0, 0, 0)
  return d.getTime()
}

function fmtDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}