import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { HABIT_COLORS, useApp } from '../store/AppContext'
import { dayKey, habitStreak, lastNDayKeys } from '../lib/time'
import { cn } from '../lib/cn'
import type { Habit } from '../types'
import {
  IconArrowRight,
  IconCalendar,
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconFlame,
  IconFlower,
  IconNote,
  IconPencil,
  IconPlus,
  IconRepeat,
  IconTrash,
  IconX
} from './Icons'

/** 一周迷你条：周日在前（与历史行为保持一致） */
const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六']
/** 月历表头：周一在前（更贴近日常日历习惯） */
const MONTH_WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日']
/** 备注弹窗里的星期名 */
const FULL_WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
/** 年份缩放视图每页展示的年份数 */
const YEARS_PER_PAGE = 12
/** 单击打卡 / 双击记备注的区分窗口（ms）：窗口内的第二下点击算双击 */
const DBLCLICK_MS = 220
/** 双击撤销「第一下已误触的打卡」的时间窗（ms），要大于系统双击阈值 */
const UNDO_TOGGLE_MS = 1500

const pad2 = (n: number) => String(n).padStart(2, '0')

/** 把 'YYYY-MM-DD' 还原成当天中午的时间戳（避开夏令时边界） */
function dayKeyToNoon(key: string): number {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d, 12).getTime()
}

/** 从日期键里取出「几号」 */
function dayOfMonth(key: string): number {
  return Number(key.slice(8, 10))
}

/** 'YYYY-MM-DD' → '10/16' */
function shortDay(key: string): string {
  return `${key.slice(5, 7)}/${key.slice(8, 10)}`
}

/** 备注压成一行预览，供日期格内显示 */
function notePreview(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

/** 日期格角标：悬停出现。左上 = 写备注，右上 = 复制备注到别的格子 */
function CellBadge({
  side,
  label,
  active,
  icon,
  onClick,
}: {
  side: 'left' | 'right'
  label: string
  /** 当前格就是这个动作的对象（复制源）：常亮 + 高亮色 */
  active: boolean
  icon: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'absolute -top-1 z-10 flex h-[16px] w-[16px] items-center justify-center rounded-full border transition-all',
        side === 'left' ? '-left-1' : '-right-1',
        active ? 'opacity-100' : 'opacity-0 group-hover/day:opacity-100 focus-visible:opacity-100'
      )}
      style={{
        background: active ? 'var(--warn)' : 'var(--ink-800)',
        borderColor: active ? 'var(--warn)' : 'var(--line)',
        color: active ? '#fff' : 'var(--text-2)'
      }}
    >
      {icon}
    </button>
  )
}

/** 'YYYY-MM-DD' → "2026 年 10 月 16 日 周五" */
function formatDayLabel(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  const w = FULL_WEEKDAYS[new Date(y, m - 1, d).getDay()]
  return `${y} 年 ${m} 月 ${d} 日 ${w}`
}

/** 生成某月（0 起始）的网格：从周一起，补空格到整周，返回 (day|null)[] */
function buildMonthCells(year: number, month: number): (number | null)[] {
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7 // 0=周一
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (number | null)[] = []
  for (let i = 0; i < firstDow; i += 1) cells.push(null)
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

export function HabitsBoard({ now }: { now: number }) {
  const { habits, addHabit, updateHabit, removeHabit, toggleHabitCheckin, setHabitDayNote, pushToast } =
    useApp()
  const [adding, setAdding] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [draftColor, setDraftColor] = useState(HABIT_COLORS[0])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  /**
   * 复制模式：记下「复制源」（哪个习惯的哪天 + 当时那份文字）。
   * 之后点击其他日期格即把这条备注粘贴过去，Esc / 点角标取消。
   */
  const [copySrc, setCopySrc] = useState<{ habitId: string; day: string; text: string } | null>(
    null
  )

  const today = dayKey(now)
  const doneToday = useMemo(
    () => habits.filter((h) => !!h.checkins[today]).length,
    [habits, today]
  )

  /** 复制源当前习惯名，供提示条显示 */
  const copySrcHabitName = useMemo(() => {
    if (!copySrc) return ''
    return habits.find((h) => h.id === copySrc.habitId)?.name ?? ''
  }, [copySrc, habits])

  // Esc 取消复制模式（备注弹窗打开时交给弹窗自己处理）
  useEffect(() => {
    if (!copySrc) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (document.querySelector('[role="dialog"]')) return
      setCopySrc(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [copySrc])

  function startCopyNote(habitId: string, day: string, liveText?: string) {
    const text = (liveText ?? habits.find((h) => h.id === habitId)?.dayNotes?.[day] ?? '').trim()
    if (!text) {
      setCopySrc(null)
      return
    }
    setCopySrc({ habitId, day, text })
    pushToast({
      tone: 'info',
      title: `已复制 ${shortDay(day)} 的备注`,
      body: '单击其他日期格粘贴 · Esc 取消',
      ttl: 2400
    })
  }

  function pasteNote(habitId: string, day: string) {
    if (!copySrc) return
    setHabitDayNote(habitId, day, copySrc.text)
    pushToast({
      tone: 'ok',
      title: `已粘贴到 ${shortDay(day)}`,
      body: notePreview(copySrc.text, 24),
      ttl: 1400
    })
  }

  function submitHabit() {
    if (!draftName.trim()) return
    addHabit(draftName, draftColor)
    setDraftName('')
    setDraftColor(HABIT_COLORS[0])
    setAdding(false)
  }

  return (
    <div className="space-y-6">
      <section className="glass sheen relative overflow-hidden rounded-[24px] p-5 sm:p-6">
        <div
          className="pointer-events-none absolute -right-10 -top-14 h-48 w-48 rounded-full blur-3xl"
          style={{ background: 'radial-gradient(circle, var(--accent-glow), transparent 70%)' }}
        />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-[24px] font-bold t1">打卡</h1>
            <p className="mt-1 text-[13.5px] t2">
              每天坚持一点点 · 今日已打卡
              <span className="tnum ml-1 font-bold" style={{ color: 'var(--accent)' }}>
                {doneToday}
              </span>
              <span className="t3"> / {habits.length}</span>
            </p>
            <p className="mt-1 text-[12px] t3">
              单击日期格补打卡 / 取消 · 双击日期格写备注（双击慢也没关系，或点格子左上角铅笔），备注直接显示在格子上
              <br />
              悬停有备注的格子点右上角角标，再点另一个格子即可粘贴过去
            </p>
          </div>

          <button
            className={cn('btn btn-primary !min-h-[42px] !rounded-[14px]', adding && 'opacity-70')}
            onClick={() => setAdding((s) => !s)}
          >
            <IconPlus size={16} />
            新建习惯
          </button>
        </div>

        {adding && (
          <div className="animate-fade-up relative mt-5 rounded-2xl border border-line p-4" style={{ background: 'var(--surface)' }}>
            <input
              autoFocus
              className="field !min-h-[44px]"
              placeholder="习惯名称，例如「早睡 23:30 前」"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitHabit()
                if (e.key === 'Escape') setAdding(false)
              }}
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {HABIT_COLORS.map((c) => (
                <button
                  key={c}
                  aria-label={`颜色 ${c}`}
                  onClick={() => setDraftColor(c)}
                  className={cn(
                    'h-7 w-7 rounded-full border-2 transition-transform',
                    draftColor === c ? 'scale-110 border-[var(--text-1)]' : 'border-transparent'
                  )}
                  style={{ background: c }}
                />
              ))}
              <div className="ml-auto flex gap-2">
                <button className="btn btn-primary !min-h-[38px] !rounded-xl text-sm" onClick={submitHabit}>
                  创建
                </button>
                <button className="btn btn-ghost !min-h-[38px] !rounded-xl text-sm" onClick={() => setAdding(false)}>
                  取消
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {habits.length === 0 ? (
        <div className="glass sheen flex flex-col items-center gap-3 rounded-[22px] px-6 py-14 text-center">
          <span
            className="flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
          >
            <IconRepeat size={26} />
          </span>
          <p className="font-display text-[16px] font-bold t1">还没有打卡习惯</p>
          <p className="max-w-[320px] text-[13.5px] t2">
            建立你想坚持的小习惯，每天点一下打卡，用连续天数见证积累。
          </p>
          <button className="btn btn-primary mt-1 !min-h-[40px] !rounded-[13px]" onClick={() => setAdding(true)}>
            <IconPlus size={16} />
            新建第一个习惯
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
          {habits.map((h, i) => (
            <HabitCard
              key={h.id}
              habit={h}
              now={now}
              index={i}
              editing={editingId === h.id}
              editName={editName}
              onEditNameChange={setEditName}
              onStartEdit={() => {
                setEditingId(h.id)
                setEditName(h.name)
              }}
              onCommitEdit={() => {
                updateHabit(h.id, { name: editName })
                setEditingId(null)
              }}
              onCancelEdit={() => setEditingId(null)}
              onToggle={() => toggleHabitCheckin(h.id, now)}
              onToggleAt={(at) => toggleHabitCheckin(h.id, at)}
              onRemove={() => removeHabit(h.id)}
              copyDay={copySrc && copySrc.habitId === h.id ? copySrc.day : null}
              copyActive={!!copySrc}
              copyHint={
                copySrc ? `${shortDay(copySrc.day)} · ${copySrcHabitName}` : ''
              }
              copyText={copySrc?.text ?? ''}
              onCopyNote={(day, text) => startCopyNote(h.id, day, text)}
              onPasteNote={(day) => pasteNote(h.id, day)}
              onCancelCopy={() => setCopySrc(null)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function HabitCard({
  habit,
  now,
  index,
  editing,
  editName,
  onEditNameChange,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onToggle,
  onToggleAt,
  onRemove,
  copyDay,
  copyActive,
  copyHint,
  copyText,
  onCopyNote,
  onPasteNote,
  onCancelCopy,
}: {
  habit: Habit
  now: number
  index: number
  editing: boolean
  editName: string
  onEditNameChange: (v: string) => void
  onStartEdit: () => void
  onCommitEdit: () => void
  onCancelEdit: () => void
  onToggle: () => void
  onToggleAt: (at: number) => void
  onRemove: () => void
  /** 本习惯里正在被复制的日期（null 表示复制源不在本卡片） */
  copyDay: string | null
  /** 全局是否处于复制模式（源可以是别的习惯） */
  copyActive: boolean
  /** 复制源提示：'10/16 · 习惯名' */
  copyHint: string
  /** 复制源的备注内容 */
  copyText: string
  onCopyNote: (day: string, text?: string) => void
  onPasteNote: (day: string) => void
  onCancelCopy: () => void
}) {
  // 周/日历视图按习惯独立：每个卡片只看自己的打卡记录
  const [view, setView] = useState<'week' | 'month'>('week')
  /** 正在写备注的日期键（null 表示未打开备注弹窗） */
  const [noteDay, setNoteDay] = useState<string | null>(null)
  /** 删除确认弹窗 */
  const [confirmDelete, setConfirmDelete] = useState(false)
  const days = useMemo(() => lastNDayKeys(7, now), [now])
  const today = days[days.length - 1]
  const checkedToday = !!habit.checkins[today]
  const streak = habitStreak(habit.checkins, now)

  const checkBtn = (
    <button
      onClick={onToggle}
      className={cn(
        'btn !min-h-[42px] shrink-0 !rounded-[14px] !px-4 text-[13.5px]',
        checkedToday ? 'btn-ghost' : 'btn-primary'
      )}
      style={checkedToday ? { color: habit.color, borderColor: `color-mix(in srgb, ${habit.color} 45%, transparent)` } : undefined}
    >
      {checkedToday ? <IconFlower size={16} /> : <IconPlus size={16} />}
      {checkedToday ? '已打卡' : '打卡'}
    </button>
  )

  return (
    <article
      className={cn(
        'glass sheen group relative animate-fade-up overflow-hidden rounded-[22px] p-4 transition-all duration-300 hover:-translate-y-0.5',
        view === 'month' && 'sm:col-span-2 xl:col-span-3'
      )}
      style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
    >
      <span
        className="absolute inset-y-3 left-0 w-[3px] rounded-full"
        style={{ background: habit.color, opacity: 0.9 }}
      />

      <div className="flex items-start gap-3 pl-2.5">
        <span
          className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl"
          style={{ background: `color-mix(in srgb, ${habit.color} 18%, transparent)`, color: habit.color }}
        >
          <IconRepeat size={19} />
        </span>

        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              autoFocus
              className="field !min-h-[36px] text-sm"
              value={editName}
              onChange={(e) => onEditNameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onCommitEdit()
                if (e.key === 'Escape') onCancelEdit()
              }}
              onBlur={onCommitEdit}
            />
          ) : (
            <h3 className="break-words font-display text-[16px] font-semibold leading-snug t1">
              {habit.name}
            </h3>
          )}

          <div className="mt-1 flex items-center gap-1.5 text-[12.5px] font-semibold">
            <IconFlame size={14} style={{ color: streak > 0 ? 'var(--warn)' : 'var(--text-3)' }} />
            <span style={{ color: streak > 0 ? 'var(--warn)' : 'var(--text-3)' }}>
              连续 {streak} 天
            </span>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          {/* 视图切换：只显示本习惯的周 / 日历记录 */}
          <div
            className="flex items-center rounded-[11px] border border-line p-0.5"
            style={{ background: 'var(--surface)' }}
            role="tablist"
            aria-label={`${habit.name}的记录视图`}
          >
            {(['week', 'month'] as const).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={view === m}
                aria-label={m === 'week' ? '周视图' : '日历视图'}
                title={m === 'week' ? '周视图' : '日历视图'}
                onClick={() => setView(m)}
                className={cn(
                  'flex h-[30px] w-[34px] items-center justify-center rounded-[9px] transition-colors',
                  view === m ? 'text-white' : 't3 hover:t1'
                )}
                style={view === m ? { background: 'var(--accent)' } : undefined}
              >
                {m === 'week' ? <IconRepeat size={14} /> : <IconCalendar size={14} />}
              </button>
            ))}
          </div>

          <div className="flex items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <button className="btn-icon !min-h-[32px] !min-w-[32px]" aria-label="重命名" onClick={onStartEdit}>
              <IconPencil size={15} />
            </button>
            <button
              className="btn-icon !min-h-[32px] !min-w-[32px] hover:!text-[var(--danger)]"
              aria-label="删除习惯"
              onClick={() => setConfirmDelete(true)}
            >
              <IconTrash size={15} />
            </button>
          </div>
        </div>
      </div>

      {copyActive && (
        <div
          className="mt-3 flex flex-wrap items-center gap-2 rounded-[12px] border px-3 py-2 text-[11.5px]"
          style={{
            borderColor: 'color-mix(in srgb, var(--warn) 45%, transparent)',
            background: 'color-mix(in srgb, var(--warn) 12%, transparent)'
          }}
        >
          <IconCopy size={13} style={{ color: 'var(--warn)' }} />
          <span className="font-semibold t2">复制模式</span>
          <span className="t3">
            已复制「{copyHint}」的备注 · 单击任意日期格粘贴（可连续粘多天），双击日期格仍能写备注
          </span>
          <button
            className="btn btn-ghost ml-auto !min-h-[26px] !rounded-lg !px-2 text-[11px]"
            onClick={onCancelCopy}
          >
            取消（Esc）
          </button>
        </div>
      )}

      {view === 'week' ? (
        <HabitWeekStrip
          habit={habit}
          days={days}
          today={today}
          onToggleAt={onToggleAt}
          onEditNote={setNoteDay}
          checkBtn={checkBtn}
          copyDay={copyDay}
          copyActive={copyActive}
          onCopyNote={onCopyNote}
          onPasteNote={onPasteNote}
          onCancelCopy={onCancelCopy}
        />
      ) : (
        <HabitMonthGrid
          habit={habit}
          now={now}
          onDay={onToggleAt}
          onEditNote={setNoteDay}
          checkBtn={checkBtn}
          copyDay={copyDay}
          copyActive={copyActive}
          onCopyNote={onCopyNote}
          onPasteNote={onPasteNote}
          onCancelCopy={onCancelCopy}
        />
      )}

      {noteDay && (
        <HabitDayNoteDialog
          habit={habit}
          dayKeyStr={noteDay}
          onClose={() => setNoteDay(null)}
          onCopyNote={onCopyNote}
          pasteFrom={
            copyActive && copyDay !== noteDay
              ? { label: copyDay ? shortDay(copyDay) : copyHint, text: copyText }
              : null
          }
        />
      )}
      {confirmDelete && (
        <HabitDeleteDialog
          habit={habit}
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false)
            onRemove()
          }}
        />
      )}
    </article>
  )
}

/**
 * 日期格的单击 / 双击分流。
 *
 * 难点：双击的第一下点击和单击无法当场区分，早先只用一个 220ms 定时器猜，
 * 手速比它慢（但仍被系统判定为双击）时就会出现「双击变成打卡 + 打卡」。
 * 这里两条一起用，谁先到算谁：
 * 1. 双击窗口内的第二下（e.detail > 1）直接吞掉，主操作不执行；
 * 2. 若第一下已经执行过主操作（打卡），收到 dblclick 时把它撤销掉，再开备注。
 *
 * 普通模式：单击 = 打卡 / 取消，双击 = 写备注
 * 复制模式：单击 = 粘贴备注（幂等，双击不撤销），双击 = 照样写备注
 */
function useDayClicks({
  onPrimary,
  onUndoPrimary,
  onEdit
}: {
  onPrimary: (key: string) => void
  onUndoPrimary: (key: string) => void
  onEdit: (key: string) => void
}) {
  const clickTimer = useRef<number | null>(null)
  /** 最近一次真正执行掉的主操作，供 dblclick 撤销 */
  const done = useRef<{ key: string; at: number } | null>(null)
  useEffect(
    () => () => {
      if (clickTimer.current) window.clearTimeout(clickTimer.current)
    },
    []
  )

  function clearTimer() {
    if (clickTimer.current) {
      window.clearTimeout(clickTimer.current)
      clickTimer.current = null
    }
  }

  return {
    onClick(e: React.MouseEvent<HTMLButtonElement>, key: string) {
      if (e.detail > 1) {
        // 双击 / 多击的后续几下：不重复执行主操作，等 dblclick
        clearTimer()
        return
      }
      clearTimer()
      clickTimer.current = window.setTimeout(() => {
        clickTimer.current = null
        done.current = { key, at: Date.now() }
        onPrimary(key)
      }, DBLCLICK_MS)
    },
    onDoubleClick(_e: React.MouseEvent<HTMLButtonElement>, key: string) {
      clearTimer()
      const last = done.current
      if (last && last.key === key && Date.now() - last.at < UNDO_TOGGLE_MS) {
        done.current = null
        onUndoPrimary(key)
      }
      onEdit(key)
    }
  }
}

/** 日期格里的备注文字：折叠换行、最多两行，超出用省略号（完整内容看悬停提示） */
function CellNote({ text, max }: { text: string; max: number }) {
  if (!text) return null
  return (
    <span className="line-clamp-2 mt-auto w-full break-words text-center text-[9px] font-medium leading-[1.25] t2">
      {notePreview(text, max)}
    </span>
  )
}

/** 周迷你条：每格显示「几号 + 打卡鲜花 + 备注」，单击补打卡、双击 / 铅笔角标写备注、复制角标跨格粘贴 */
function HabitWeekStrip({
  habit,
  days,
  today,
  onToggleAt,
  onEditNote,
  checkBtn,
  copyDay,
  copyActive,
  onCopyNote,
  onPasteNote,
  onCancelCopy,
}: {
  habit: Habit
  days: string[]
  today: string
  onToggleAt: (at: number) => void
  onEditNote: (key: string) => void
  checkBtn: React.ReactNode
  copyDay: string | null
  copyActive: boolean
  onCopyNote: (key: string) => void
  onPasteNote: (key: string) => void
  onCancelCopy: () => void
}) {
  const clicks = useDayClicks({
    onPrimary: (key) => (copyActive ? onPasteNote(key) : onToggleAt(dayKeyToNoon(key))),
    onUndoPrimary: (key) => {
      // 双击的第一下已经改了打卡状态：这里再切回去
      if (!copyActive) onToggleAt(dayKeyToNoon(key))
    },
    onEdit: onEditNote
  })

  return (
    <div className="mt-4 pl-2.5">
      <div className="grid grid-cols-7 gap-1.5">
        {days.map((key) => {
          const note = habit.dayNotes?.[key] ?? ''
          const on = !!habit.checkins[key]
          const isToday = key === today
          const isSource = copyDay === key
          // 本地解析 'YYYY-MM-DD'，避免 UTC 偏移；周六/周日显示淡黄底
          const [wy, wm, wd0] = key.split('-').map(Number)
          const wd = new Date(wy, wm - 1, wd0).getDay()
          const isWeekend = wd === 0 || wd === 6
          return (
            <div key={key} className="group/day relative flex flex-col items-center gap-1">
              <button
                type="button"
                onClick={(e) => clicks.onClick(e, key)}
                onDoubleClick={(e) => clicks.onDoubleClick(e, key)}
                aria-label={`${key}${on ? ' 已打卡' : ''}${note ? ' 有备注' : ''}`}
                title={note ? `${key}\n${note}` : key}
                className={cn(
                  'flex min-h-[58px] w-full flex-col items-center rounded-[9px] border px-1 pb-1 pt-1.5 transition-colors',
                  isToday && !isSource && 'ring-1 ring-[var(--accent)]',
                  isSource && 'ring-2 ring-[var(--warn)]',
                  copyActive && !isSource && 'hover:ring-1 hover:ring-[var(--accent)]'
                )}
                style={{
                  background: on
                    ? `color-mix(in srgb, ${habit.color} 20%, transparent)`
                    : isToday
                      ? 'color-mix(in srgb, var(--accent) 22%, transparent)'
                      : isWeekend
                        ? 'var(--weekend-soft)'
                        : 'var(--surface)',
                  borderColor: on
                    ? `color-mix(in srgb, ${habit.color} 45%, transparent)`
                    : isToday
                      ? 'color-mix(in srgb, var(--accent) 45%, transparent)'
                      : isWeekend
                        ? 'color-mix(in srgb, var(--weekend-accent) 55%, transparent)'
                        : 'var(--line)',
                  color: on || (!isToday && isWeekend) ? 'var(--text-1)' : 'var(--text-3)'
                }}
              >
                <span className="tnum text-[10.5px] font-bold leading-none">{dayOfMonth(key)}</span>
                <span className="mt-0.5 flex h-[13px] items-center justify-center">
                  {on && <IconFlower size={12} style={{ color: habit.color }} />}
                </span>
                <CellNote text={note} max={16} />
              </button>
              <CellBadge
                side="left"
                active={false}
                label={`写 ${key} 的备注`}
                icon={<IconPencil size={9} />}
                onClick={() => onEditNote(key)}
              />
              {(note || isSource) && (
                <CellBadge
                  side="right"
                  active={isSource}
                  label={isSource ? `取消复制 ${key} 的备注` : `复制 ${key} 的备注到别的日期格`}
                  icon={<IconCopy size={9} />}
                  onClick={() => (isSource ? onCancelCopy() : onCopyNote(key))}
                />
              )}
              <span
                className="w-full text-center text-[10px] t3"
                style={isWeekend ? { color: 'var(--weekend-accent)', fontWeight: 700 } : undefined}
              >
                {WEEK_LABELS[wd]}
              </span>
            </div>
          )
        })}
      </div>

      <div className="mt-3 flex justify-end">{checkBtn}</div>
    </div>
  )
}

/**
 * 单习惯日历：只显示这一个习惯的打卡记录。
 * - 单击某天补打卡 / 取消当天打卡；双击某天写 / 改备注（备注显示在格子里）
 * - 悬停有备注的格子出现角标，点角标进入复制模式，再点别的格子即粘贴
 * - 点击标题可逐级缩小：月 → 年份 → 年份列表，快速定位某个日期
 * - 缩小视图里同样带打卡样式（鲜花 + 底色深浅代表打卡天数）
 */
function HabitMonthGrid({
  habit,
  now,
  onDay,
  onEditNote,
  checkBtn,
  copyDay,
  copyActive,
  onCopyNote,
  onPasteNote,
  onCancelCopy,
}: {
  habit: Habit
  now: number
  onDay: (at: number) => void
  onEditNote: (key: string) => void
  checkBtn: React.ReactNode
  copyDay: string | null
  copyActive: boolean
  onCopyNote: (key: string) => void
  onPasteNote: (key: string) => void
  onCancelCopy: () => void
}) {
  const nowDate = new Date(now)
  const nowYear = nowDate.getFullYear()
  const nowMonth = nowDate.getMonth()
  const todayKey = dayKey(now)

  const [zoom, setZoom] = useState<'day' | 'month' | 'year'>('day')
  const [cursor, setCursor] = useState(() => ({ y: nowDate.getFullYear(), m: nowDate.getMonth() }))
  const [yearBase, setYearBase] = useState(() => nowYear - (YEARS_PER_PAGE - 1))

  /** 按月 / 按年的打卡天数统计，供缩小视图着色 */
  const monthCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const k of Object.keys(habit.checkins)) {
      const p = k.slice(0, 7)
      map.set(p, (map.get(p) ?? 0) + 1)
    }
    return map
  }, [habit.checkins])
  const yearCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const k of Object.keys(habit.checkins)) {
      const p = k.slice(0, 4)
      map.set(p, (map.get(p) ?? 0) + 1)
    }
    return map
  }, [habit.checkins])

  const cells = useMemo(() => buildMonthCells(cursor.y, cursor.m), [cursor])
  const isCurrentMonth = cursor.y === nowYear && cursor.m === nowMonth
  const monthCount = monthCounts.get(`${cursor.y}-${pad2(cursor.m + 1)}`) ?? 0
  const yearCount = yearCounts.get(String(cursor.y)) ?? 0
  const years = useMemo(
    () => Array.from({ length: YEARS_PER_PAGE }, (_, i) => yearBase + i),
    [yearBase]
  )
  const yearPageHasNow = nowYear >= yearBase && nowYear <= yearBase + YEARS_PER_PAGE - 1

  function shift(delta: number) {
    if (zoom === 'day') {
      setCursor((c) => {
        const d = new Date(c.y, c.m + delta, 1)
        return { y: d.getFullYear(), m: d.getMonth() }
      })
    } else if (zoom === 'month') {
      setCursor((c) => ({ y: c.y + delta, m: c.m }))
    } else {
      setYearBase((b) => b + delta * YEARS_PER_PAGE)
    }
  }

  function zoomOut() {
    if (zoom === 'day') setZoom('month')
    else if (zoom === 'month') setZoom('year')
  }

  function goToday() {
    setCursor({ y: nowYear, m: nowMonth })
    setYearBase(nowYear - (YEARS_PER_PAGE - 1))
    setZoom('day')
  }

  const clicks = useDayClicks({
    onPrimary: (key) => (copyActive ? onPasteNote(key) : onDay(dayKeyToNoon(key))),
    onUndoPrimary: (key) => {
      if (!copyActive) onDay(dayKeyToNoon(key))
    },
    onEdit: onEditNote
  })

  const navBtn = 'btn-icon !min-h-[34px] !min-w-[34px] disabled:opacity-30'
  const titleText =
    zoom === 'day'
      ? `${cursor.y} 年 ${cursor.m + 1} 月`
      : zoom === 'month'
        ? `${cursor.y} 年`
        : `${yearBase} – ${yearBase + YEARS_PER_PAGE - 1}`

  const showReset = zoom === 'day' ? !isCurrentMonth : zoom === 'month' ? cursor.y !== nowYear : !yearPageHasNow

  return (
    <div className="mt-4 pl-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2">
          <button
            className={navBtn}
            aria-label={zoom === 'day' ? '上一月' : zoom === 'month' ? '上一年' : '往前多年'}
            onClick={() => shift(-1)}
          >
            <IconChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={zoomOut}
            disabled={zoom === 'year'}
            title={zoom === 'year' ? undefined : '点击缩小到月份 / 年份视图'}
            className={cn(
              'tnum min-w-[112px] rounded-lg px-2 py-1 font-display text-[15px] font-bold t1 transition-colors',
              zoom !== 'year' && 'hover:bg-[var(--surface-2)]'
            )}
          >
            {titleText}
          </button>
          <button
            className={navBtn}
            aria-label={zoom === 'day' ? '下一月' : zoom === 'month' ? '下一年' : '往后多年'}
            onClick={() => shift(1)}
          >
            <IconChevronRight size={16} />
          </button>
          {showReset && (
            <button className="btn btn-ghost !min-h-[34px] !rounded-xl !px-3 text-[12.5px]" onClick={goToday}>
              {zoom === 'day' ? '回到本月' : '回到今天'}
            </button>
          )}
          <span className="tnum text-[12px] t3">
            {zoom === 'day' ? `本月 ${monthCount} 天` : zoom === 'month' ? `本年 ${yearCount} 天` : ''}
          </span>
        </div>
        <div className="ml-auto">{checkBtn}</div>
      </div>

      {zoom === 'day' && (
        <>
          <div className="mt-3 grid max-w-[460px] grid-cols-7 gap-1.5">
            {MONTH_WEEK_LABELS.map((w, i) => (
              <div
                key={w}
                className="pb-1 text-center text-[11px] font-semibold t3"
                style={i >= 5 ? { color: 'var(--weekend-accent)' } : undefined}
              >
                {w}
              </div>
            ))}
            {cells.map((day, i) => {
              if (day === null) return <div key={`pad-${i}`} />
              const key = dayKey(new Date(cursor.y, cursor.m, day).getTime())
              const note = habit.dayNotes?.[key] ?? ''
              const isToday = key === todayKey
              const isFuture = key > todayKey
              const on = !!habit.checkins[key]
              const isSource = copyDay === key
              const dow = new Date(cursor.y, cursor.m, day).getDay()
              const isWeekend = dow === 0 || dow === 6
              return (
                <div key={key} className="group/day relative">
                  <button
                    type="button"
                    disabled={isFuture}
                    onClick={(e) => clicks.onClick(e, key)}
                    onDoubleClick={(e) => clicks.onDoubleClick(e, key)}
                    className={cn(
                      'flex min-h-[56px] w-full flex-col items-center gap-0.5 overflow-hidden rounded-[11px] border px-1 pb-1 pt-1.5 transition-colors disabled:cursor-not-allowed',
                      isToday && !isSource && 'ring-1 ring-[var(--accent)]',
                      isSource && 'ring-2 ring-[var(--warn)]',
                      copyActive && !isSource && !isFuture && 'hover:ring-1 hover:ring-[var(--accent)]',
                      !on && !isFuture && 'hover:border-[var(--line)]'
                    )}
                    style={{
                      background: on
                        ? `color-mix(in srgb, ${habit.color} 18%, transparent)`
                        : isToday
                          ? 'color-mix(in srgb, var(--accent) 22%, transparent)'
                          : isWeekend
                            ? 'var(--weekend-soft)'
                            : 'var(--surface)',
                      borderColor: on
                        ? `color-mix(in srgb, ${habit.color} 45%, transparent)`
                        : isToday
                          ? 'color-mix(in srgb, var(--accent) 45%, transparent)'
                          : isWeekend
                            ? 'color-mix(in srgb, var(--weekend-accent) 45%, transparent)'
                            : 'transparent',
                      color: isFuture ? 'var(--text-3)' : 'var(--text-2)',
                      opacity: isFuture ? 0.45 : 1
                    }}
                    title={note ? `${key}\n${note}` : key}
                  >
                    <span className="tnum text-[11.5px] font-semibold leading-none">{day}</span>
                    <span className="flex h-[15px] items-center justify-center">
                      {on && <IconFlower size={15} style={{ color: habit.color }} />}
                    </span>
                    <CellNote text={note} max={24} />
                  </button>
                  {!isFuture && (
                    <CellBadge
                      side="left"
                      active={false}
                      label={`写 ${key} 的备注`}
                      icon={<IconPencil size={9} />}
                      onClick={() => onEditNote(key)}
                    />
                  )}
                  {(note || isSource) && !isFuture && (
                    <CellBadge
                      side="right"
                      active={isSource}
                      label={isSource ? `取消复制 ${key} 的备注` : `复制 ${key} 的备注到别的日期格`}
                      icon={<IconCopy size={9} />}
                      onClick={() => (isSource ? onCancelCopy() : onCopyNote(key))}
                    />
                  )}
                </div>
              )
            })}
          </div>

          <p className="mt-3 text-[11px] t3">
            单击日期补打卡 / 取消；双击日期（或点格子左上角铅笔）写备注，备注会显示在格子里；有备注的格子悬停出现复制角标，
            点角标后再点别的日期即粘贴；未来日期不能打卡。
          </p>
        </>
      )}

      {zoom === 'month' && (
        <div className="mt-3 grid max-w-[460px] grid-cols-3 gap-2 sm:grid-cols-4">
          {Array.from({ length: 12 }, (_, m) => {
            const count = monthCounts.get(`${cursor.y}-${pad2(m + 1)}`) ?? 0
            const daysInMonth = new Date(cursor.y, m + 1, 0).getDate()
            const isCurrent = cursor.y === nowYear && m === nowMonth
            const isFuture = cursor.y > nowYear || (cursor.y === nowYear && m > nowMonth)
            const ratio = count / daysInMonth
            return (
              <button
                key={m}
                type="button"
                disabled={isFuture}
                onClick={() => {
                  setCursor((c) => ({ y: c.y, m }))
                  setZoom('day')
                }}
                className={cn(
                  'flex h-[64px] flex-col items-center justify-center gap-1 rounded-[13px] border transition-colors disabled:cursor-not-allowed',
                  isCurrent && 'ring-1 ring-[var(--accent)]',
                  !isFuture && 'hover:-translate-y-0.5'
                )}
                style={{
                  background: count > 0
                    ? `color-mix(in srgb, ${habit.color} ${10 + Math.round(ratio * 22)}%, transparent)`
                    : 'var(--surface)',
                  borderColor: count > 0 ? `color-mix(in srgb, ${habit.color} 40%, transparent)` : 'var(--line)',
                  opacity: isFuture ? 0.45 : 1
                }}
                title={`${cursor.y} 年 ${m + 1} 月 · 打卡 ${count} 天`}
              >
                <span className="font-display text-[13px] font-bold t1">{m + 1} 月</span>
                <span className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: count > 0 ? habit.color : 'var(--text-3)' }}>
                  {count > 0 ? (
                    <>
                      <IconFlower size={12} />
                      {count} 天
                    </>
                  ) : (
                    '—'
                  )}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {zoom === 'year' && (
        <div className="mt-3 grid max-w-[460px] grid-cols-3 gap-2 sm:grid-cols-4">
          {years.map((y) => {
            const count = yearCounts.get(String(y)) ?? 0
            const isCurrent = y === nowYear
            const isFuture = y > nowYear
            return (
              <button
                key={y}
                type="button"
                disabled={isFuture}
                onClick={() => {
                  setCursor({ y, m: 0 })
                  setZoom('month')
                }}
                className={cn(
                  'flex h-[64px] flex-col items-center justify-center gap-1 rounded-[13px] border transition-colors disabled:cursor-not-allowed',
                  isCurrent && 'ring-1 ring-[var(--accent)]',
                  !isFuture && 'hover:-translate-y-0.5'
                )}
                style={{
                  background: count > 0
                    ? `color-mix(in srgb, ${habit.color} 20%, transparent)`
                    : 'var(--surface)',
                  borderColor: count > 0 ? `color-mix(in srgb, ${habit.color} 40%, transparent)` : 'var(--line)',
                  opacity: isFuture ? 0.45 : 1
                }}
                title={`${y} 年 · 打卡 ${count} 天`}
              >
                <span className="tnum font-display text-[14px] font-bold t1">{y}</span>
                <span className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: count > 0 ? habit.color : 'var(--text-3)' }}>
                  {count > 0 ? (
                    <>
                      <IconFlower size={12} />
                      {count} 天
                    </>
                  ) : (
                    '—'
                  )}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** 通用小弹窗：点击遮罩 / Esc 关闭 */
function Modal({
  label,
  onClose,
  children,
}: {
  label: string
  onClose: () => void
  children: React.ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

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
        aria-label={label}
        className="animate-pop-in max-h-[min(620px,88vh)] w-full max-w-[440px] overflow-hidden rounded-[22px] border border-line shadow-lift"
        style={{ background: 'var(--ink-800)' }}
      >
        {children}
      </div>
    </div>,
    document.body
  )
}

/** 某一天的备注弹窗：双击日期格打开；备注内容会显示在日期格上 */
function HabitDayNoteDialog({
  habit,
  dayKeyStr,
  onClose,
  onCopyNote,
  pasteFrom,
}: {
  habit: Habit
  dayKeyStr: string
  onClose: () => void
  /** 以这一天为源进入复制模式（弹窗会关掉，去点目标日期格） */
  onCopyNote: (key: string, text?: string) => void
  /** 当前复制模式的备注内容，可直接粘进输入框 */
  pasteFrom: { label: string; text: string } | null
}) {
  const { setHabitDayNote } = useApp()
  const [text, setText] = useState(habit.dayNotes?.[dayKeyStr] ?? '')
  const checked = !!habit.checkins[dayKeyStr]
  const hadNote = !!habit.dayNotes?.[dayKeyStr]

  function save() {
    setHabitDayNote(habit.id, dayKeyStr, text)
    onClose()
  }

  function clear() {
    setHabitDayNote(habit.id, dayKeyStr, '')
    onClose()
  }

  function copyToOtherDays() {
    const trimmed = text.trim()
    if (!trimmed) return
    if (trimmed !== (habit.dayNotes?.[dayKeyStr] ?? '')) {
      setHabitDayNote(habit.id, dayKeyStr, trimmed)
    }
    onCopyNote(dayKeyStr, trimmed)
    onClose()
  }

  return (
    <Modal label={`${habit.name} · ${dayKeyStr} 备注`} onClose={onClose}>
      <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <IconNote size={16} className="shrink-0 t3" />
            <h2 className="truncate font-display text-[16px] font-bold t1">{formatDayLabel(dayKeyStr)}</h2>
            {checked && (
              <span
                className="flex shrink-0 items-center gap-1 rounded-full px-2 py-[2px] text-[11px] font-bold"
                style={{ background: `color-mix(in srgb, ${habit.color} 18%, transparent)`, color: habit.color }}
              >
                <IconFlower size={12} />
                已打卡
              </span>
            )}
          </div>
          <p className="mt-1 text-[12.5px] t3">{habit.name} · 记下当天的心情或进展</p>
        </div>
        <button className="btn-icon !min-h-[34px] !min-w-[34px] shrink-0" onClick={onClose} aria-label="关闭">
          <IconX size={17} />
        </button>
      </div>

      <div className="p-4">
        <textarea
          autoFocus
          className="field !min-h-[120px] w-full resize-none leading-relaxed"
          placeholder="写点什么…（例如：今天完成了什么、遇到了什么问题）"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save()
          }}
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] t3">⌘ / Ctrl + Enter 保存 · 内容会显示在日期格上</span>
          <div className="flex flex-wrap items-center gap-2">
            {pasteFrom && (
              <button
                className="btn btn-ghost !min-h-[36px] !rounded-[12px] !px-3 text-[13px]"
                onClick={() => setText(pasteFrom.text)}
                title={`把「${pasteFrom.label}」的备注填入输入框`}
              >
                <IconArrowRight size={14} />
                粘贴自 {pasteFrom.label}
              </button>
            )}
            {text.trim() ? (
              <button
                className="btn btn-ghost !min-h-[36px] !rounded-[12px] !px-3 text-[13px]"
                onClick={copyToOtherDays}
                title="复制这份备注，再去点其他日期格粘贴"
              >
                <IconCopy size={14} />
                复制到其他日期
              </button>
            ) : null}
            {hadNote && (
              <button
                className="btn btn-ghost !min-h-[40px] !rounded-[13px] text-sm hover:!text-[var(--danger)]"
                onClick={clear}
              >
                清空
              </button>
            )}
            <button className="btn btn-primary !min-h-[40px] !rounded-[13px] text-sm" onClick={save}>
              保存
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

/** 删除习惯确认弹窗 */
function HabitDeleteDialog({
  habit,
  onClose,
  onConfirm,
}: {
  habit: Habit
  onClose: () => void
  onConfirm: () => void
}) {
  const days = Object.keys(habit.checkins).length
  const notes = Object.keys(habit.dayNotes ?? {}).length
  return (
    <Modal label={`删除习惯 ${habit.name}`} onClose={onClose}>
      <div className="px-5 py-5">
        <div className="flex items-start gap-3">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl"
            style={{ background: 'color-mix(in srgb, var(--danger) 16%, transparent)', color: 'var(--danger)' }}
          >
            <IconTrash size={19} />
          </span>
          <div className="min-w-0">
            <h2 className="break-words font-display text-[16px] font-bold t1">删除「{habit.name}」？</h2>
            <p className="mt-1 text-[13px] leading-relaxed t2">
              将删除该习惯
              {days > 0 ? `、${days} 天的打卡记录` : ''}
              {notes > 0 ? `以及 ${notes} 条备注` : ''}
              ，操作不可恢复。
            </p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn btn-ghost !min-h-[40px] !rounded-[13px] text-sm" onClick={onClose}>
            取消
          </button>
          <button
            className="btn !min-h-[40px] !rounded-[13px] text-sm"
            style={{ background: 'var(--danger)', color: '#fff' }}
            onClick={onConfirm}
          >
            删除习惯
          </button>
        </div>
      </div>
    </Modal>
  )
}
