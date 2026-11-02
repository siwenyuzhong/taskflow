export type Priority = 'low' | 'medium' | 'high'
export type TaskStatus = 'active' | 'completed'

/** 任务在时间轴上的实时状态 */
export type Urgency = 'untimed' | 'running' | 'soon' | 'overdue' | 'done'

export interface Category {
  id: string
  name: string
  color: string
  builtin?: boolean
}

/** 子任务：属于某个任务，可选择时长与日期时间 */
export interface Subtask {
  id: string
  title: string
  /** 子任务选定的日期时间（分钟级） */
  dueAt: number | null
  /** 子任务时长（分钟） */
  durationMin: number | null
  done: boolean
}

export interface Task {
  id: string
  title: string
  note: string
  categoryId: string
  priority: Priority
  /** 本轮时长（分钟）；null 表示未设置定时 */
  durationMin: number | null
  createdAt: number
  /** 当前计时周期的起点（创建或最近一次续时长） */
  cycleStartAt: number | null
  /** 到期时刻 */
  dueAt: number | null
  /** 续时长次数 */
  renewCount: number
  /** 提前多少分钟提醒"即将到期" */
  remindLeadMin: number
  status: TaskStatus
  completedAt: number | null
  /** 已发出"即将到期"提醒的时刻（用于去重） */
  remindedAt: number | null
  /** 已发出"已到期"提醒的时刻（用于去重） */
  expiredNotifiedAt: number | null
  /** 由「未来计划」日历创建的计划任务（到点提醒语义不同） */
  planned?: boolean
  /** 计划任务的开始时刻：日历面按它显示与归类；有时长时 dueAt = 开始 + 时长 */
  plannedStartAt?: number | null
  /** 子任务：子任务时长总和不得超过任务总时长 */
  subtasks?: Subtask[]
  /** 移入回收站的时刻；null / undefined 表示未删除 */
  trashedAt?: number | null
}

/** 习惯打卡：每天最多记一次，checkins 以本地日期键 'YYYY-MM-DD' 为键 */
export interface Habit {
  id: string
  name: string
  color: string
  createdAt: number
  /** 打卡记录：日期键 → 打卡时刻 */
  checkins: Record<string, number>
  /** 每日备注：日期键 → 文字（双击日期格填写） */
  dayNotes?: Record<string, string>
  archived?: boolean
}

/** 表格单元格：文本 / 数字 / =公式 的原始值 + 样式 */
export interface SheetCell {
  /** 单元格原始内容（公式以 = 开头） */
  v: string
  /** 加粗 */
  bold?: boolean
  /** 底色（hex） */
  color?: string
  /** 字体颜色（hex） */
  fc?: string
  /** 水平对齐（默认左对齐） */
  align?: 'left' | 'center' | 'right'
}

/** 一个工作表（Sheet），类似飞书电子表格里的一个分页 */
export interface Sheet {
  id: string
  name: string
  /** 单元格：key = `R{row}C{col}`（0 起始，如 A1 → R0C0） */
  cells: Record<string, SheetCell>
  colCount: number
  rowCount: number
  /** 列宽（px）：key = `C{col}` */
  colWidths: Record<string, number>
  createdAt: number
  updatedAt: number
}

/** 轻笔记：随手记录的文字便签（支持 Markdown） */
export interface Note {
  id: string
  /** 笔记名称；留空时由正文首行自动推导 */
  title: string
  /** 正文（Markdown 语法，图片以 data URL 内联） */
  content: string
  color: string
  pinned: boolean
  createdAt: number
  updatedAt: number
}

export interface Prefs {
  theme: 'dark' | 'light'
  sound: boolean
  nativeNotify: boolean
  defaultDurationMin: number
  defaultRemindLeadMin: number
}

export interface AppData {
  version: number
  tasks: Task[]
  categories: Category[]
  prefs: Prefs
  habits: Habit[]
  notes: Note[]
  /** 工作清单：多个工作表 */
  sheets: Sheet[]
  /** 上次打开的工作表 id */
  activeSheetId: string | null
}

export type ViewKey =
  | 'all'
  | 'active'
  | 'soon'
  | 'week'
  | 'plan'
  | 'sheets'
  | 'speedrec'
  | 'habits'
  | 'notes'
  | 'done'
  | 'trash'
export type SortKey = 'urgency' | 'created' | 'priority' | 'title'

export interface Toast {
  id: string
  tone: 'info' | 'warn' | 'danger' | 'ok'
  title: string
  body?: string
  taskId?: string
  /** 主操作按钮 */
  actionLabel?: string
  action?: () => void
  secondaryLabel?: string
  secondaryAction?: () => void
  ttl?: number
}
