import type { Priority } from '../types'

/** 从自然输入中解析出的结构 */
export interface ParsedQuick {
  /** 去掉时长/优先级/分类标记后的纯标题 */
  title: string
  /** 解析出的时长（分钟），null 表示未在文本中出现 */
  durationMin: number | null
  /** 解析出的优先级，null 表示未在文本中出现 */
  priority: Priority | null
  /** 解析出的分类名（不含 #），null 表示未出现 */
  categoryName: string | null
}

const UNIT_MIN: Record<string, number> = {
  小时: 60,
  时: 60,
  h: 60,
  hr: 60,
  hrs: 60,
  hour: 60,
  hours: 60,
  分钟: 1,
  分: 1,
  min: 1,
  mins: 1,
  minute: 1,
  minutes: 1,
  m: 1,
  天: 1440,
  d: 1440,
  day: 1440,
  days: 1440,
}

/** 时长：2h / 1.5h / 90分钟 / 2个小时 / 45m / 1天（要求数字打头，避免误伤"分析"这类词） */
const DURATION_RE =
  /(^|[^\w.])(\d+(?:\.\d+)?)\s*个?\s*(小时|分钟|hours|hour|hrs|hr|h|minutes|minute|mins|min|m|days|day|d|时|分|天)(?![\w])/gi

const DAY_UNITS = new Set(['天', 'd', 'day', 'days'])

/** 优先级：! / !! / !高 / !h / !low …（裸 ! 视为高） */
const PRIORITY_RE = /(^|\s)!(high|medium|low|h|m|l|高|中|低)?(?=\s|$)/gi

/** 分类：#工作 / #deep-work */
const CATEGORY_RE = /(^|\s)#(\S+)/g

function normalizeTitle(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

export function parseQuick(raw: string): ParsedQuick {
  let text = raw
  let durationMin: number | null = null
  let priority: Priority | null = null
  let categoryName: string | null = null

  text = text.replace(
    DURATION_RE,
    (match, lead: string, num: string, unit: string, offset: number, string: string) => {
      if (durationMin !== null) return match
      const unitKey = unit.toLowerCase()
      // "第3天 / 第 3 天"这类序数词不是时长：lead 可能捕获到"第"或其后的空格
      const isOrdinalDay =
        lead.trim() === '第' || (offset > 0 && string[offset - 1] === '第')
      if (DAY_UNITS.has(unitKey) && isOrdinalDay) return match
      const factor = UNIT_MIN[unitKey]
      const value = Number(num)
      if (!factor || !Number.isFinite(value) || value <= 0) return match
      durationMin = Math.max(1, Math.round(value * factor))
      return lead
    }
  )

  text = text.replace(PRIORITY_RE, (match, lead: string, kw?: string) => {
    if (priority !== null) return match
    const k = (kw ?? '').toLowerCase()
    if (k === 'l' || k === 'low' || k === '低') priority = 'low'
    else if (k === 'm' || k === 'medium' || k === '中') priority = 'medium'
    else priority = 'high'
    return lead
  })

  text = text.replace(CATEGORY_RE, (match, lead: string, name: string) => {
    if (categoryName !== null) return match
    categoryName = name
    return lead
  })

  return { title: normalizeTitle(text), durationMin, priority, categoryName }
}

/** 用户点了时长/优先级/分类的 chip 后，把文本里的对应标记清掉，避免"文本压过 chip" */
export function stripDuration(raw: string): string {
  return normalizeTitle(raw.replace(DURATION_RE, (_m, lead: string) => lead))
}

export function stripPriority(raw: string): string {
  return normalizeTitle(raw.replace(PRIORITY_RE, (_m, lead: string) => lead))
}

export function stripCategory(raw: string): string {
  return normalizeTitle(raw.replace(CATEGORY_RE, (_m, lead: string) => lead))
}

export const QUICK_HINTS = [
  { input: '写周报 1h', desc: '1 小时后到期' },
  { input: '重构登录模块 2小时 !高 #开发', desc: '优先级 + 分类一起写' },
  { input: '回复邮件 30m', desc: '分钟级时长' },
]
