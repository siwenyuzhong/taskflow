import { clamp } from './cn'
import type { Task, Urgency } from '../types'

export const MINUTE = 60_000
export const HOUR = 3_600_000
export const DAY = 86_400_000

const pad = (n: number) => (n < 10 ? `0${n}` : String(n))

/** 此刻的钟点「HH:mm」，作为日期格创建任务的默认时间（与创建时刻一致，而非固定 09:00） */
export function nowClockHHMM(ts: number = Date.now()): string {
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** "03:24:11" 或 "2天 04:11" */
export function formatCountdown(ms: number): string {
  const abs = Math.abs(ms)
  const d = Math.floor(abs / DAY)
  const h = Math.floor((abs % DAY) / HOUR)
  const m = Math.floor((abs % HOUR) / MINUTE)
  const s = Math.floor((abs % MINUTE) / 1000)
  if (d > 0) return `${d}天 ${pad(h)}:${pad(m)}:${pad(s)}`
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

/**
 * 拆出「天数」与「时:分:秒」，便于把天数用小一号字体展示，
 * 避免长天数（如 222天）在圆形计时环里与圆环重叠。
 */
export function splitCountdown(ms: number): { days: number; clock: string } {
  const abs = Math.abs(ms)
  const d = Math.floor(abs / DAY)
  const h = Math.floor((abs % DAY) / HOUR)
  const m = Math.floor((abs % HOUR) / MINUTE)
  const s = Math.floor((abs % MINUTE) / 1000)
  return { days: d, clock: `${pad(h)}:${pad(m)}:${pad(s)}` }
}

/** 240 -> "4 小时"，90 -> "1 小时 30 分"，45 -> "45 分钟" */
export function formatDurationLabel(min: number | null): string {
  if (min === null || !Number.isFinite(min)) return '未定时'
  if (min < 60) return `${Math.round(min)} 分钟`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分`
}

/** 紧凑时长标签，用于按钮：4h / 30m / 1.5h */
export function formatDurationShort(min: number): string {
  if (min % 60 === 0) return `${min / 60} 小时`
  if (min < 60) return `${min} 分钟`
  return `${(min / 60).toFixed(1)} 小时`
}

/**
 * 周视图 / 计划视图 / 某日任务弹窗展示的「开始时刻」：
 * 计划任务 = 开始时间（plannedStartAt，到期 = 开始 + 时长；旧数据无此字段则回退 dueAt）；
 * 定时任务 = 本轮计时起点（cycleStartAt，如 14:56 创建 + 4 小时 → 显示 14:56 而非到期 18:56）；
 * 其余（无时长、已过期数据等）= dueAt。
 */
export function taskDisplayTime(t: Task): number | null {
  if (t.planned) return t.plannedStartAt ?? t.dueAt
  if (t.durationMin !== null && t.dueAt !== null) return t.cycleStartAt ?? t.createdAt
  return t.dueAt
}

export function formatClock(ts: number): string {
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function formatDateTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** "2026-10-10" */
export function formatDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function formatRelative(ts: number, now: number): string {
  const diff = now - ts
  if (diff < MINUTE) return '刚刚'
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} 分钟前`
  if (diff < DAY) return `${Math.floor(diff / HOUR)} 小时前`
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)} 天前`
  return formatDateTime(ts).replace(/ \d{2}:\d{2}$/, '')
}

export function isSameDay(a: number, b: number): boolean {
  const x = new Date(a)
  const y = new Date(b)
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate()
}

/** 本地日期键 'YYYY-MM-DD'（用于按天归组的打卡记录） */
export function dayKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 最近 n 天的日期键（含今天），从早到晚排列；按日历天加减，夏令时下也不错位 */
export function lastNDayKeys(n: number, now: number): string[] {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  const keys: string[] = []
  for (let i = n - 1; i >= 0; i -= 1) {
    const x = new Date(d)
    x.setDate(x.getDate() - i)
    keys.push(dayKey(x.getTime()))
  }
  return keys
}

/** 连续打卡天数。
 * 今天已打卡则从今天起算；今天还没打卡则从昨天起算（不算打断，给当天留余地）。
 * 按日历天回退，避免夏令时切换日 ±23/25h 造成的断签。
 */
export function habitStreak(checkins: Record<string, number>, now: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  if (!checkins[dayKey(d.getTime())]) d.setDate(d.getDate() - 1)
  let streak = 0
  while (checkins[dayKey(d.getTime())]) {
    streak += 1
    d.setDate(d.getDate() - 1)
  }
  return streak
}

/** 任务在给定时刻的实时状态 */
export function urgencyOf(task: Task, now: number): Urgency {
  if (task.status === 'completed') return 'done'
  if (!task.dueAt || task.durationMin === null) return 'untimed'
  const remaining = task.dueAt - now
  if (remaining <= 0) return 'overdue'
  if (remaining <= task.remindLeadMin * MINUTE) return 'soon'
  return 'running'
}

export const URGENCY_META: Record<
  Urgency,
  { label: string; color: string; soft: string }
> = {
  untimed: { label: '未定时', color: 'var(--text-3)', soft: 'rgba(140,140,170,0.14)' },
  running: { label: '进行中', color: 'var(--cy)', soft: 'rgba(46,230,214,0.14)' },
  soon: { label: '即将到期', color: 'var(--warn)', soft: 'rgba(245,165,36,0.16)' },
  overdue: { label: '已到期', color: 'var(--danger)', soft: 'rgba(255,92,122,0.16)' },
  done: { label: '已完成', color: 'var(--ok)', soft: 'rgba(52,211,153,0.14)' },
}

/** 当前计时周期的剩余比例（1 = 刚开始，0 = 到期） */
export function progressOf(task: Task, now: number): number {
  if (!task.dueAt || task.durationMin === null) return 0
  const start = task.plannedStartAt ?? task.cycleStartAt ?? task.dueAt - task.durationMin * MINUTE
  const span = task.dueAt - start
  if (span <= 0) return 0
  return clamp((now - start) / span, 0, 1)
}

export function remainingOf(task: Task, now: number): number | null {
  if (!task.dueAt) return null
  return task.dueAt - now
}

export const PRIORITY_META = {
  high: { label: '高', color: 'var(--danger)' },
  medium: { label: '中', color: 'var(--warn)' },
  low: { label: '低', color: 'var(--cy)' },
} as const

export function toLocalInputValue(ts: number): string {
  const d = new Date(ts - d0offset(ts))
  return d.toISOString().slice(0, 16)
}

function d0offset(ts: number): number {
  return new Date(ts).getTimezoneOffset() * MINUTE
}

export function fromLocalInputValue(value: string): number | null {
  if (!value) return null
  const ts = new Date(value).getTime()
  return Number.isFinite(ts) ? ts : null
}
