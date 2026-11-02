import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { bridge } from '../lib/bridge'
import { playChime } from '../lib/sound'
import { HOUR, DAY, MINUTE, dayKey, formatCountdown, urgencyOf } from '../lib/time'
import { uid } from '../lib/cn'
import { blankSheet, DEFAULT_COLS, DEFAULT_ROWS, nextSheetName, sheetKey } from '../lib/spreadsheet'
import type {
  AppData,
  Category,
  Habit,
  Note,
  Prefs,
  Sheet,
  SheetCell,
  Subtask,
  Task,
  Toast,
  ViewKey,
} from '../types'

export const STORAGE_VERSION = 1

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'work', name: '工作', color: '#7c5cff', builtin: true },
  { id: 'dev', name: '研发', color: '#2ee6d6', builtin: true },
  { id: 'study', name: '学习', color: '#5b9dff', builtin: true },
  { id: 'life', name: '生活', color: '#f5a524', builtin: true },
  { id: 'idea', name: '灵感', color: '#ff5c7a', builtin: true },
]

export const DEFAULT_PREFS: Prefs = {
  theme: 'dark',
  sound: true,
  nativeNotify: true,
  defaultDurationMin: 240, // 4 小时
  defaultRemindLeadMin: 10,
}

/** 打卡 / 轻笔记可选配色 */
export const HABIT_COLORS = ['#7c5cff', '#2ee6d6', '#5b9dff', '#f5a524', '#ff5c7a', '#34d399']
export const NOTE_COLORS = [
  '#7c5cff',
  '#2ee6d6',
  '#5b9dff',
  '#f5a524',
  '#ff5c7a',
  '#34d399',
  '#a78bfa',
  '#fb923c',
]

export interface NewTaskInput {
  title: string
  note?: string
  categoryId: string
  priority: Task['priority']
  durationMin: number | null
  remindLeadMin: number
  subtasks?: Subtask[]
}

/** 未来计划：直接指定到期时刻（到点提醒） */
export interface PlannedTaskInput {
  title: string
  note?: string
  categoryId: string
  priority: Task['priority']
  dueAt: number
  remindLeadMin?: number
  subtasks?: Subtask[]
  /** 时长（分钟）：到期时刻 = 开始 + 时长；null / 不传 = 到点提醒（开始即到期） */
  durationMin?: number | null
  /** true 时保留用户选的日期时刻（哪怕已过），否则自动挪到"现在+1分钟" */
  allowPast?: boolean
}

interface State extends AppData {
  ready: boolean
}

type Action =
  | { type: 'hydrate'; data: AppData }
  | { type: 'addTask'; task: Task }
  | { type: 'patchTask'; id: string; patch: Partial<Task> }
  | { type: 'removeTask'; id: string }
  | { type: 'patchMany'; ids: string[]; patch: Partial<Task> }
  | { type: 'removeCompleted' }
  | { type: 'emptyTrash' }
  | { type: 'addCategory'; category: Category }
  | { type: 'patchCategory'; id: string; patch: Partial<Category> }
  | { type: 'removeCategory'; id: string; fallbackId: string }
  | { type: 'addHabit'; habit: Habit }
  | { type: 'patchHabit'; id: string; patch: Partial<Habit> }
  | { type: 'removeHabit'; id: string }
  | { type: 'addNote'; note: Note }
  | { type: 'patchNote'; id: string; patch: Partial<Note> }
  | { type: 'removeNote'; id: string }
  | { type: 'addSheet'; sheet: Sheet }
  | { type: 'patchSheet'; id: string; patch: Partial<Sheet> }
  | { type: 'removeSheet'; id: string }
  | { type: 'setActiveSheet'; id: string | null }
  | { type: 'setPrefs'; patch: Partial<Prefs> }

const initialState: State = {
  ready: false,
  version: STORAGE_VERSION,
  tasks: [],
  categories: DEFAULT_CATEGORIES,
  prefs: DEFAULT_PREFS,
  habits: [],
  notes: [],
  sheets: [],
  activeSheetId: null,
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'hydrate':
      return { ...state, ...action.data, ready: true }

    case 'addTask':
      return { ...state, tasks: [action.task, ...state.tasks] }

    case 'patchTask':
      return {
        ...state,
        tasks: state.tasks.map((t) => (t.id === action.id ? { ...t, ...action.patch } : t)),
      }

    case 'patchMany': {
      const set = new Set(action.ids)
      return {
        ...state,
        tasks: state.tasks.map((t) => (set.has(t.id) ? { ...t, ...action.patch } : t)),
      }
    }

    case 'removeTask':
      return { ...state, tasks: state.tasks.filter((t) => t.id !== action.id) }

    case 'removeCompleted':
      return { ...state, tasks: state.tasks.filter((t) => t.status !== 'completed') }

    // 清空回收站：只清掉已在回收站里的任务
    case 'emptyTrash':
      return { ...state, tasks: state.tasks.filter((t) => !t.trashedAt) }

    case 'addCategory':
      return { ...state, categories: [...state.categories, action.category] }

    case 'patchCategory':
      return {
        ...state,
        categories: state.categories.map((c) => (c.id === action.id ? { ...c, ...action.patch } : c)),
      }

    case 'removeCategory':
      return {
        ...state,
        categories: state.categories.filter((c) => c.id !== action.id),
        tasks: state.tasks.map((t) =>
          t.categoryId === action.id ? { ...t, categoryId: action.fallbackId } : t
        ),
      }

    case 'addHabit':
      return { ...state, habits: [action.habit, ...state.habits] }

    case 'patchHabit':
      return {
        ...state,
        habits: state.habits.map((h) => (h.id === action.id ? { ...h, ...action.patch } : h)),
      }

    case 'removeHabit':
      return { ...state, habits: state.habits.filter((h) => h.id !== action.id) }

    case 'addNote':
      return { ...state, notes: [action.note, ...state.notes] }

    case 'patchNote':
      return {
        ...state,
        notes: state.notes.map((n) => (n.id === action.id ? { ...n, ...action.patch } : n)),
      }

    case 'removeNote':
      return { ...state, notes: state.notes.filter((n) => n.id !== action.id) }

    case 'addSheet':
      return { ...state, sheets: [...state.sheets, action.sheet], activeSheetId: action.sheet.id }

    case 'patchSheet':
      return {
        ...state,
        sheets: state.sheets.map((s) => (s.id === action.id ? { ...s, ...action.patch } : s)),
      }

    case 'removeSheet':
      return {
        ...state,
        sheets: state.sheets.filter((s) => s.id !== action.id),
        activeSheetId:
          state.activeSheetId === action.id
            ? (state.sheets.find((s) => s.id !== action.id)?.id ?? null)
            : state.activeSheetId,
      }

    case 'setActiveSheet':
      return { ...state, activeSheetId: action.id }

    case 'setPrefs':
      return { ...state, prefs: { ...state.prefs, ...action.patch } }

    default:
      return state
  }
}

/** 首次启动的示例数据：让用户一眼看懂"定时 + 续时长"怎么用 */
function seedData(): AppData {
  const now = Date.now()
  const make = (
    title: string,
    note: string,
    categoryId: string,
    priority: Task['priority'],
    durationMin: number,
    offsetStartMin: number
  ): Task => {
    const cycleStartAt = now - offsetStartMin * MINUTE
    return {
      id: uid('task'),
      title,
      note,
      categoryId,
      priority,
      durationMin,
      createdAt: cycleStartAt,
      cycleStartAt,
      dueAt: cycleStartAt + durationMin * MINUTE,
      renewCount: 0,
      remindLeadMin: 10,
      status: 'active',
      completedAt: null,
      remindedAt: null,
      expiredNotifiedAt: null,
      trashedAt: null,
    }
  }
  const seedSheetId = uid('sheet')
  return {
    version: STORAGE_VERSION,
    categories: DEFAULT_CATEGORIES,
    prefs: DEFAULT_PREFS,
    tasks: [
      make('完成 Sloth 需求评审', '确认定时提醒与续时长的交互细节', 'work', 'high', 240, 8),
      make('重构任务列表的虚拟滚动', '长列表下保持 60fps', 'dev', 'medium', 90, 30),
      make('阅读《深度工作》第 3 章', '做笔记并输出一条行动项', 'study', 'low', 45, 50),
    ],
    habits: [
      {
        id: uid('habit'),
        name: '每日阅读 30 分钟',
        color: '#2ee6d6',
        createdAt: now,
        checkins: {},
      },
    ],
    notes: [
      {
        id: uid('note'),
        title: '灵感',
        content: '灵感：给「专注模式」加一个白噪音开关。',
        color: '#7c5cff',
        pinned: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
    // 示例工作表：展示自定义列、样式与 =SUM 公式
    sheets: [
      {
        id: seedSheetId,
        ...blankSheet('工作清单'),
        cells: {
          [sheetKey(0, 0)]: { v: '任务', bold: true },
          [sheetKey(0, 1)]: { v: '负责人', bold: true },
          [sheetKey(0, 2)]: { v: '状态', bold: true },
          [sheetKey(0, 3)]: { v: '得分', bold: true },
          [sheetKey(1, 0)]: { v: '完成需求评审' },
          [sheetKey(1, 1)]: { v: '小王' },
          [sheetKey(1, 2)]: { v: '进行中' },
          [sheetKey(1, 3)]: { v: '80' },
          [sheetKey(2, 0)]: { v: '修复列表滚动' },
          [sheetKey(2, 1)]: { v: '小李' },
          [sheetKey(2, 2)]: { v: '已完成' },
          [sheetKey(2, 3)]: { v: '56' },
          [sheetKey(3, 0)]: { v: '合计', bold: true },
          [sheetKey(3, 3)]: { v: '=SUM(D2:D3)' },
        },
        colWidths: { C0: 120, C1: 90, C2: 90, C3: 80 },
      },
    ],
    activeSheetId: seedSheetId,
  }
}

/** 把任意结构的工作表数据清洗成标准 Sheet（找不到就退回空白表） */
function normalizeSheet(raw: unknown): Sheet | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Partial<Sheet>
  if (typeof s.id !== 'string' || !s.id) return null
  const colCount =
    Number.isInteger(s.colCount) && (s.colCount as number) >= 1 ? (s.colCount as number) : DEFAULT_COLS
  const rowCount =
    Number.isInteger(s.rowCount) && (s.rowCount as number) >= 1 ? (s.rowCount as number) : DEFAULT_ROWS
  const cells: Record<string, SheetCell> = {}
  if (s.cells && typeof s.cells === 'object') {
    for (const [k, v] of Object.entries(s.cells)) {
      if (!v || typeof v !== 'object') continue
      const vv = v as Partial<SheetCell>
      if (typeof vv.v !== 'string') continue
      const cell: SheetCell = { v: vv.v }
      if (vv.bold) cell.bold = true
      if (typeof vv.color === 'string') cell.color = vv.color
      if (typeof vv.fc === 'string') cell.fc = vv.fc
      if (vv.align === 'left' || vv.align === 'center' || vv.align === 'right') cell.align = vv.align
      cells[k] = cell
    }
  }
  const colWidths: Record<string, number> = {}
  if (s.colWidths && typeof s.colWidths === 'object') {
    for (const [k, v] of Object.entries(s.colWidths)) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) colWidths[k] = v
    }
  }
  return {
    id: s.id,
    name: String(s.name ?? '未命名'),
    cells,
    colCount,
    rowCount,
    colWidths,
    createdAt: typeof s.createdAt === 'number' ? s.createdAt : Date.now(),
    updatedAt: typeof s.updatedAt === 'number' ? s.updatedAt : Date.now(),
  }
}

function normalize(raw: unknown): AppData | null {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Partial<AppData>
  if (!Array.isArray(d.tasks)) return null
  const categories =
    Array.isArray(d.categories) && d.categories.length ? d.categories : DEFAULT_CATEGORIES
  const known = new Set(categories.map((c) => c.id))
  const fallback = categories[0]?.id ?? 'work'

  let sheets: Sheet[] = Array.isArray(d.sheets)
    ? d.sheets.map(normalizeSheet).filter((x): x is Sheet => x !== null)
    : []
  if (!sheets.length) {
    sheets = [{ id: uid('sheet'), ...blankSheet('Sheet 1') }]
  }
  const activeSheetId =
    typeof d.activeSheetId === 'string' && sheets.some((s) => s.id === d.activeSheetId)
      ? d.activeSheetId
      : sheets[0].id

  return {
    version: STORAGE_VERSION,
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      builtin: !!c.builtin,
    })),
    prefs: { ...DEFAULT_PREFS, ...(d.prefs ?? {}) },
    tasks: d.tasks
      .filter((t) => t && typeof t.id === 'string')
      .map((t) => ({
        id: t.id,
        title: String(t.title ?? '未命名任务'),
        note: String(t.note ?? ''),
        categoryId: known.has(t.categoryId) ? t.categoryId : fallback,
        priority: (['low', 'medium', 'high'] as const).includes(t.priority) ? t.priority : 'medium',
        durationMin: typeof t.durationMin === 'number' ? t.durationMin : null,
        createdAt: typeof t.createdAt === 'number' ? t.createdAt : Date.now(),
        cycleStartAt: typeof t.cycleStartAt === 'number' ? t.cycleStartAt : null,
        dueAt: typeof t.dueAt === 'number' ? t.dueAt : null,
        renewCount: typeof t.renewCount === 'number' ? t.renewCount : 0,
        remindLeadMin: typeof t.remindLeadMin === 'number' ? t.remindLeadMin : 10,
        status: t.status === 'completed' ? 'completed' : 'active',
        completedAt: typeof t.completedAt === 'number' ? t.completedAt : null,
        remindedAt: typeof t.remindedAt === 'number' ? t.remindedAt : null,
        expiredNotifiedAt: typeof t.expiredNotifiedAt === 'number' ? t.expiredNotifiedAt : null,
        planned: !!t.planned,
        plannedStartAt: typeof t.plannedStartAt === 'number' ? t.plannedStartAt : null,
        trashedAt: typeof t.trashedAt === 'number' ? t.trashedAt : null,
        subtasks: Array.isArray(t.subtasks)
          ? t.subtasks
              .filter((s) => s && typeof s.id === 'string')
              .map((s) => ({
                id: s.id,
                title: String(s.title ?? ''),
                dueAt: typeof s.dueAt === 'number' ? s.dueAt : null,
                durationMin: typeof s.durationMin === 'number' ? s.durationMin : null,
                done: !!s.done,
              }))
          : [],
      })),
    habits: Array.isArray(d.habits)
      ? d.habits
          .filter((h) => h && typeof h.id === 'string')
          .map((h) => ({
            id: h.id,
            name: String(h.name ?? '未命名习惯'),
            color: String(h.color ?? HABIT_COLORS[0]),
            createdAt: typeof h.createdAt === 'number' ? h.createdAt : Date.now(),
            checkins:
              h.checkins && typeof h.checkins === 'object'
                ? Object.fromEntries(
                    Object.entries(h.checkins).filter(([, v]) => typeof v === 'number')
                  )
                : {},
            dayNotes:
              h.dayNotes && typeof h.dayNotes === 'object'
                ? Object.fromEntries(
                    Object.entries(h.dayNotes).filter(
                      ([, v]) => typeof v === 'string' && v.trim().length > 0
                    )
                  )
                : undefined,
            archived: !!h.archived,
          }))
      : [],
    notes: Array.isArray(d.notes)
      ? d.notes
          .filter((n) => n && typeof n.id === 'string')
          .map((n) => ({
            id: n.id,
            title: String(n.title ?? ''),
            content: String(n.content ?? ''),
            color: String(n.color ?? NOTE_COLORS[0]),
            pinned: !!n.pinned,
            createdAt: typeof n.createdAt === 'number' ? n.createdAt : Date.now(),
            updatedAt: typeof n.updatedAt === 'number' ? n.updatedAt : Date.now(),
          }))
      : [],
    sheets,
    activeSheetId,
  }
}

/** 把任务下的子任务统一标记为已完成 / 未完成 */
function markAllSubtasks(t: Task, done: boolean): Subtask[] {
  return (t.subtasks ?? []).map((s) => ({ ...s, done }))
}

interface Ctx {
  ready: boolean
  tasks: Task[]
  categories: Category[]
  habits: Habit[]
  notes: Note[]
  sheets: Sheet[]
  activeSheetId: string | null
  setActiveSheetId: (id: string | null) => void
  /** 新建工作表并自动切换过去 */
  addSheet: (init?: string | Omit<Sheet, 'id'>) => Sheet
  renameSheet: (id: string, name: string) => void
  removeSheet: (id: string) => boolean
  updateSheet: (id: string, patch: Partial<Sheet>) => void
  prefs: Prefs
  toasts: Toast[]
  focusTaskId: string | null
  /** 高亮任务；scroll 为 true 时同时滚动到该任务（仅用户主动「定位」时使用） */
  setFocusTaskId: (id: string | null, opts?: { scroll?: boolean }) => void
  /** 当前高亮任务是否需要滚动定位 */
  focusScroll: boolean
  pushToast: (t: Omit<Toast, 'id'>) => string
  dismissToast: (id: string) => void
  /** 鼠标悬停在提示上时暂停自动消失 */
  holdToast: (id: string) => void
  /** 鼠标移开后按剩余时长继续计时 */
  releaseToast: (id: string) => void
  categoryById: (id: string) => Category
  createTask: (input: NewTaskInput) => Task
  /** 未来计划：按指定时刻创建任务（到点提醒） */
  createPlannedTask: (input: PlannedTaskInput) => Task
  updateTask: (id: string, patch: Partial<Task>) => void
  removeTask: (id: string, opts?: { quiet?: boolean }) => void
  /** 软删除：移入回收站（可挽回） */
  trashTask: (id: string) => void
  /** 永久删除：仅在回收站内使用（不可恢复） */
  purgeTask: (id: string) => void
  /** 清空回收站 */
  emptyTrash: () => void
  /** 把全部已完成任务移入回收站 */
  trashAllCompleted: () => void
  /** 跨视图跳转请求（提示里的「去看看」用），App 消费后生效 */
  navRequest: { view: ViewKey } | null
  requestView: (view: ViewKey) => void
  completeTask: (id: string) => void
  restoreTask: (id: string) => void
  renewTask: (id: string, minutes?: number) => void
  completeAllVisible: (ids: string[]) => void
  /** 勾选/取消勾选某个子任务 */
  toggleSubtask: (taskId: string, subId: string) => void
  addCategory: (name: string, color: string) => void
  renameCategory: (id: string, name: string) => void
  removeCategory: (id: string) => void
  setPrefs: (patch: Partial<Prefs>) => void
  /** 打卡：新建习惯 */
  addHabit: (name: string, color: string) => void
  updateHabit: (id: string, patch: Partial<Pick<Habit, 'name' | 'color'>>) => void
  removeHabit: (id: string) => void
  /** 切换今天的打卡状态（已打卡则取消） */
  toggleHabitCheckin: (id: string, at?: number) => void
  /** 一键打卡：把打卡页里今天还没打卡的习惯全部打卡（已打卡的保持不动） */
  checkinAllHabits: () => void
  /** 给某个日期写/清空备注（双击日期格） */
  setHabitDayNote: (id: string, dayKey: string, text: string) => void
  /** 轻笔记：新建便签 */
  addNote: (content?: string, color?: string, title?: string) => Note
  updateNote: (
    id: string,
    patch: Partial<Pick<Note, 'title' | 'content' | 'color' | 'pinned'>>
  ) => void
  removeNote: (id: string) => void
  togglePinNote: (id: string) => void
}

const AppContext = createContext<Ctx | null>(null)

/**
 * 时钟单独拆成一个 context。
 * 全局每秒都会走时的 `now` 若和任务数据放进同一个 value，会导致每秒整棵组件树重渲染；
 * 拆开后，只有真正需要"实时倒计时"的组件订阅它，其余组件（侧栏、提示、表单等）不再每秒重渲染。
 */
const ClockContext = createContext<number>(0)

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  const [now, setNow] = useState(() => Date.now())
  const [toasts, setToasts] = useState<Toast[]>([])
  const [focusTaskId, setFocusTaskIdRaw] = useState<string | null>(null)
  const [focusScroll, setFocusScroll] = useState(false)
  /** 跨视图跳转请求：由提示里的操作发起，App 监听后切换视图 */
  const [navRequest, setNavRequest] = useState<{ view: ViewKey } | null>(null)
  const requestView = useCallback((view: ViewKey) => setNavRequest({ view }), [])

  /** 高亮任务；只有显式传 scroll: true 才会滚动页面（避免创建任务后视图跳动） */
  const setFocusTaskId = useCallback((id: string | null, opts?: { scroll?: boolean }) => {
    setFocusTaskIdRaw(id)
    setFocusScroll(id !== null && opts?.scroll === true)
  }, [])

  const stateRef = useRef(state)
  stateRef.current = state
  const toastTimers = useRef(new Map<string, { timer: number; remaining: number; expiresAt: number }>())
  const writeTimer = useRef<number | null>(null)

  // ---------------------------------------------------------------- 水合
  useEffect(() => {
    let alive = true
    ;(async () => {
      let raw = null
      try {
        raw = await bridge.read()
      } catch (err) {
        console.error('本地数据读取失败，使用初始数据', err)
      }
      const data = normalize(raw) ?? seedData()
      if (!alive) return
      dispatch({ type: 'hydrate', data })
    })()
    return () => {
      alive = false
    }
  }, [])

  // ---------------------------------------------------------------- 时钟
  useEffect(() => {
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    const onVisible = () => setNow(Date.now())
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [])

  // ---------------------------------------------------------------- 持久化
  useEffect(() => {
    if (!state.ready) return
    if (writeTimer.current) window.clearTimeout(writeTimer.current)
    writeTimer.current = window.setTimeout(() => {
      writeTimer.current = null
      void bridge.write({
        version: STORAGE_VERSION,
        tasks: state.tasks,
        categories: state.categories,
        prefs: state.prefs,
        habits: state.habits,
        notes: state.notes,
        sheets: state.sheets,
        activeSheetId: state.activeSheetId,
      })
    }, 220)
    return () => {
      if (writeTimer.current) window.clearTimeout(writeTimer.current)
    }
  }, [state.tasks, state.categories, state.prefs, state.habits, state.notes, state.sheets, state.activeSheetId, state.ready])

  useEffect(() => {
    const onLeave = () => {
      const s = stateRef.current
      // 水合未完成时禁止写入，否则会用空初始状态覆盖本地数据
      if (!s.ready) return
      void bridge.write({
        version: STORAGE_VERSION,
        tasks: s.tasks,
        categories: s.categories,
        prefs: s.prefs,
        habits: s.habits,
        notes: s.notes,
        sheets: s.sheets,
        activeSheetId: s.activeSheetId,
      })
    }
    window.addEventListener('beforeunload', onLeave)
    return () => window.removeEventListener('beforeunload', onLeave)
  }, [])

  // ---------------------------------------------------------------- 主题
  useEffect(() => {
    document.documentElement.dataset.theme = state.prefs.theme
    document.documentElement.style.colorScheme = state.prefs.theme
  }, [state.prefs.theme])

  // ---------------------------------------------------------------- Toast
  const dismissToast = useCallback((id: string) => {
    const entry = toastTimers.current.get(id)
    if (entry) {
      window.clearTimeout(entry.timer)
      toastTimers.current.delete(id)
    }
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  /** 启动/重启一个 toast 的自动消失计时 */
  const scheduleToast = useCallback(
    (id: string, msRaw: number) => {
      const ms = Number.isFinite(msRaw) ? Math.max(400, msRaw) : 3000
      const prev = toastTimers.current.get(id)
      if (prev) window.clearTimeout(prev.timer)
      const timer = window.setTimeout(() => dismissToast(id), ms)
      toastTimers.current.set(id, { timer, remaining: ms, expiresAt: Date.now() + ms })
    },
    [dismissToast]
  )

  /** 悬停暂停：清掉计时器并把剩余时长存下来（幂等，重复进入不会把剩余时长算成 Infinity） */
  const holdToast = useCallback((id: string) => {
    const entry = toastTimers.current.get(id)
    if (!entry || entry.expiresAt === Infinity) return
    window.clearTimeout(entry.timer)
    toastTimers.current.set(id, {
      timer: 0,
      remaining: Math.max(900, entry.expiresAt - Date.now()),
      expiresAt: Infinity,
    })
  }, [])

  /** 移开继续：按剩余时长（不足则补到 900ms）续上 */
  const releaseToast = useCallback(
    (id: string) => {
      const entry = toastTimers.current.get(id)
      if (!entry || entry.expiresAt !== Infinity) return
      scheduleToast(id, Math.max(900, entry.remaining))
    },
    [scheduleToast]
  )

  const pushToast = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = uid('toast')
      setToasts((prev) => [...prev.slice(-3), { ...t, id }])
      // 提示默认只停留 1 秒，悬停可暂停
      scheduleToast(id, t.ttl ?? 1000)
      return id
    },
    [scheduleToast]
  )

  // ---------------------------------------------------------------- 任务操作
  const categoryById = useCallback(
    (id: string) => state.categories.find((c) => c.id === id) ?? state.categories[0],
    [state.categories]
  )

  const createTask = useCallback(
    (input: NewTaskInput) => {
      const created = Date.now()
      const durationMin = input.durationMin && input.durationMin > 0 ? Math.round(input.durationMin) : null
      const dueAt = durationMin ? created + durationMin * MINUTE : null
      const task: Task = {
        id: uid('task'),
        title: input.title.trim() || '未命名任务',
        note: (input.note ?? '').trim(),
        categoryId: input.categoryId,
        priority: input.priority,
        durationMin,
        createdAt: created,
        cycleStartAt: dueAt ? created : null,
        dueAt,
        renewCount: 0,
        remindLeadMin: input.remindLeadMin,
        status: 'active',
        completedAt: null,
        // 若时长本身短于提醒提前量，则不立刻弹"即将到期"，只保留到期提醒
        remindedAt: durationMin !== null && durationMin <= input.remindLeadMin ? created : null,
        expiredNotifiedAt: null,
        trashedAt: null,
        subtasks: input.subtasks ?? [],
      }
      dispatch({ type: 'addTask', task })
      return task
    },
    []
  )

  /** 未来计划任务：用户指定"开始时刻 + 时长"，到期 = 开始 + 时长；不计时则为到点提醒（开始即到期） */
  const createPlannedTask = useCallback((input: PlannedTaskInput) => {
    const created = Date.now()
    // 开始时刻：默认把"已过去的时间"挪到此刻后 1 分钟；周视图/需要精确落日的场景可关闭
    const start = input.allowPast ? input.dueAt : Math.max(input.dueAt, created + MINUTE)
    const span = input.durationMin && input.durationMin > 0 ? input.durationMin : null
    const dueAt = span === null ? start : start + span * MINUTE
    const task: Task = {
      id: uid('task'),
      title: input.title.trim() || '未命名计划',
      note: (input.note ?? '').trim(),
      categoryId: input.categoryId,
      priority: input.priority,
      // 不计时保留原"创建→到点"占位时长；计时则记录真实时长
      durationMin: span ?? Math.max(1, Math.round((dueAt - created) / MINUTE)),
      createdAt: created,
      cycleStartAt: created,
      dueAt,
      plannedStartAt: start,
      renewCount: 0,
      remindLeadMin: input.remindLeadMin ?? 10,
      status: 'active',
      completedAt: null,
      remindedAt: null,
      expiredNotifiedAt: null,
      planned: true,
      trashedAt: null,
      subtasks: input.subtasks ?? [],
    }
    dispatch({ type: 'addTask', task })
    return task
  }, [])

  const updateTask = useCallback((id: string, patch: Partial<Task>) => {    dispatch({ type: 'patchTask', id, patch })
  }, [])

  /** 真实删除（不经过回收站）——仅用于撤销「刚创建的错误任务」这类场景 */
  const removeTask = useCallback(
    (id: string, opts?: { quiet?: boolean }) => {
      const target = stateRef.current.tasks.find((t) => t.id === id)
      dispatch({ type: 'removeTask', id })
      if (!target || opts?.quiet) return
      pushToast({
        tone: 'info',
        title: '已删除',
        body: target.title,
        actionLabel: '撤销删除',
        action: () => {
          dispatch({ type: 'addTask', task: target })
        },
        ttl: 1000,
      })
    },
    [pushToast]
  )

  /** 软删除：任务先进入回收站，可在回收站里再彻底删除 */
  const trashTask = useCallback(
    (id: string) => {
      const target = stateRef.current.tasks.find((t) => t.id === id)
      if (!target || target.trashedAt) return
      dispatch({ type: 'patchTask', id, patch: { trashedAt: Date.now() } })
      pushToast({
        tone: 'info',
        title: '已移入回收站',
        body: target.title,
        actionLabel: '去看看',
        action: () => requestView('trash'),
        ttl: 1000,
      })
    },
    [pushToast, requestView]
  )

  /** 永久删除：回收站内使用，不可恢复 */
  const purgeTask = useCallback((id: string) => {
    dispatch({ type: 'removeTask', id })
  }, [])

  const emptyTrash = useCallback(() => {
    const n = stateRef.current.tasks.filter((t) => t.trashedAt).length
    if (!n) return
    dispatch({ type: 'emptyTrash' })
    pushToast({ tone: 'info', title: `已彻底删除 ${n} 个任务`, ttl: 1000 })
  }, [pushToast])

  const trashAllCompleted = useCallback(() => {
    const ids = stateRef.current.tasks
      .filter((t) => t.status === 'completed' && !t.trashedAt)
      .map((t) => t.id)
    if (!ids.length) return
    dispatch({ type: 'patchMany', ids, patch: { trashedAt: Date.now() } })
    pushToast({
      tone: 'info',
      title: `已把 ${ids.length} 个已完成任务移入回收站`,
      actionLabel: '去看看',
      action: () => requestView('trash'),
      ttl: 1000,
    })
  }, [pushToast, requestView])

  const completeTask = useCallback(
    (id: string) => {
      const target = stateRef.current.tasks.find((t) => t.id === id)
      if (!target || target.status === 'completed') return
      const at = Date.now()
      dispatch({
        type: 'patchTask',
        id,
        patch: { status: 'completed', completedAt: at, subtasks: markAllSubtasks(target, true) },
      })
      if (stateRef.current.prefs.sound) playChime('done', true)
      pushToast({
        tone: 'ok',
        title: '任务已完成',
        body: target.title,
        actionLabel: '撤销',
        action: () =>
          dispatch({
            type: 'patchTask',
            id,
            // 撤销时恢复完成前的子任务勾选快照，而不是全部清掉
            patch: { status: 'active', completedAt: null, subtasks: target.subtasks ?? [] },
          }),
        ttl: 1000,
      })
    },
    [pushToast]
  )

  const restoreTask = useCallback((id: string) => {
    const target = stateRef.current.tasks.find((t) => t.id === id)
    if (!target) return
    dispatch({
      type: 'patchTask',
      id,
      // 仅在原本是「已完成」状态时复位子任务勾选；从回收站恢复未完成任务时保留原勾选
      patch:
        target.status === 'completed'
          ? { status: 'active', completedAt: null, subtasks: markAllSubtasks(target, false) }
          : { status: 'active', completedAt: null },
    })
  }, [])

  const renewTask = useCallback(
    (id: string, minutes?: number) => {
      const task = stateRef.current.tasks.find((t) => t.id === id)
      if (!task) return
      const base = minutes ?? task.durationMin ?? 30
      const at = Date.now()
      // 尚未到期 → 在原到期时间上叠加；已到期 → 从此刻重新计时
      const from = task.dueAt && task.dueAt > at ? task.dueAt : at
      const nextDue = from + base * MINUTE
      const cycleStart = task.dueAt && task.dueAt > at ? task.cycleStartAt ?? at : at
      dispatch({
        type: 'patchTask',
        id,
        patch: {
          dueAt: nextDue,
          cycleStartAt: cycleStart,
          // 计划任务保留真实时长（推迟只平移时点）；计时任务按续增量覆盖
          durationMin: task.planned ? task.durationMin : base,
          ...(task.planned && typeof task.plannedStartAt === 'number'
            ? { plannedStartAt: task.plannedStartAt + base * MINUTE }
            : {}),
          renewCount: task.renewCount + 1,
          remindedAt: null,
          expiredNotifiedAt: null,
          status: 'active',
          completedAt: null,
          // 从完成状态重新开启时，把子任务勾选一并复位
          ...(task.status === 'completed' ? { subtasks: markAllSubtasks(task, false) } : {}),
        },
      })
      const deferred = task.planned && base % 1440 === 0
      pushToast({
        tone: 'info',
        title: deferred ? `已推迟 ${base / 1440} 天` : `已续 ${base >= 60 ? `${base / 60} 小时` : `${base} 分钟`}`,
        body: task.title,
        ttl: 1000,
      })
    },
    [pushToast]
  )

  const completeAllVisible = useCallback((ids: string[]) => {
    const at = Date.now()
    for (const id of ids) {
      const target = stateRef.current.tasks.find((t) => t.id === id)
      dispatch({
        type: 'patchTask',
        id,
        patch: {
          status: 'completed',
          completedAt: at,
          ...(target ? { subtasks: markAllSubtasks(target, true) } : {}),
        },
      })
    }
  }, [])

  const toggleSubtask = useCallback((taskId: string, subId: string) => {
    const target = stateRef.current.tasks.find((t) => t.id === taskId)
    if (!target) return
    dispatch({
      type: 'patchTask',
      id: taskId,
      patch: {
        subtasks: (target.subtasks ?? []).map((s) =>
          s.id === subId ? { ...s, done: !s.done } : s
        ),
      },
    })
  }, [])

  // ---------------------------------------------------------------- 分类
  const addCategory = useCallback((name: string, color: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    dispatch({ type: 'addCategory', category: { id: uid('cat'), name: trimmed, color } })
  }, [])

  const renameCategory = useCallback((id: string, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    dispatch({ type: 'patchCategory', id, patch: { name: trimmed } })
  }, [])

  const removeCategory = useCallback((id: string) => {
    const cats = stateRef.current.categories
    const fallback = cats.find((c) => c.id !== id)?.id ?? 'work'
    dispatch({ type: 'removeCategory', id, fallbackId: fallback })
  }, [])

  const setPrefs = useCallback((patch: Partial<Prefs>) => {
    dispatch({ type: 'setPrefs', patch })
  }, [])

  // ---------------------------------------------------------------- 打卡
  const addHabit = useCallback((name: string, color: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    const habit: Habit = {
      id: uid('habit'),
      name: trimmed,
      color,
      createdAt: Date.now(),
      checkins: {},
    }
    dispatch({ type: 'addHabit', habit })
  }, [])

  const updateHabit = useCallback(
    (id: string, patch: Partial<Pick<Habit, 'name' | 'color'>>) => {
      const next: Partial<Habit> = { ...patch }
      if (typeof next.name === 'string') next.name = next.name.trim() || '未命名习惯'
      dispatch({ type: 'patchHabit', id, patch: next })
    },
    []
  )

  const removeHabit = useCallback((id: string) => {
    dispatch({ type: 'removeHabit', id })
  }, [])

  const toggleHabitCheckin = useCallback(
    (id: string, at?: number) => {
      const habit = stateRef.current.habits.find((h) => h.id === id)
      if (!habit) return
      const when = at ?? Date.now()
      const key = dayKey(when)
      const checkins = { ...habit.checkins }
      const wasChecked = !!checkins[key]
      if (wasChecked) delete checkins[key]
      else checkins[key] = when
      dispatch({ type: 'patchHabit', id, patch: { checkins } })
      if (!wasChecked && stateRef.current.prefs.sound) playChime('done', true)
      if (!wasChecked) {
        pushToast({
          tone: 'ok',
          title: '打卡成功',
          body: habit.name,
          ttl: 1000,
        })
      }
    },
    [pushToast]
  )

  /**
   * 一键打卡：把「打卡」页创建的所有习惯里，今天还没打卡的全部打卡。
   * 已经打过卡的习惯保持原样（不会误取消），一次点击只记一次。
   */
  const checkinAllHabits = useCallback(() => {
    const habits = stateRef.current.habits
    if (!habits.length) {
      pushToast({
        tone: 'info',
        title: '还没有打卡习惯',
        body: '先去「打卡」页新建一个习惯吧',
        actionLabel: '去看看',
        action: () => requestView('habits'),
        ttl: 1600,
      })
      return
    }
    const when = Date.now()
    const key = dayKey(when)
    const pending = habits.filter((h) => !h.checkins[key])
    if (!pending.length) {
      pushToast({ tone: 'info', title: '今天的习惯都已打卡', ttl: 1000 })
      return
    }
    for (const h of pending) {
      dispatch({
        type: 'patchHabit',
        id: h.id,
        patch: { checkins: { ...h.checkins, [key]: when } },
      })
    }
    if (stateRef.current.prefs.sound) playChime('done', true)
    pushToast({
      tone: 'ok',
      title: `已一键打卡 ${pending.length} 个习惯`,
      body: pending.map((h) => h.name).join('、'),
      actionLabel: '去看看',
      action: () => requestView('habits'),
      ttl: 1600,
    })
  }, [pushToast, requestView])

  const setHabitDayNote = useCallback((id: string, key: string, text: string) => {
    const habit = stateRef.current.habits.find((h) => h.id === id)
    if (!habit) return
    const next = { ...(habit.dayNotes ?? {}) }
    const trimmed = text.trim()
    if (trimmed) next[key] = trimmed
    else delete next[key]
    dispatch({ type: 'patchHabit', id, patch: { dayNotes: next } })
  }, [])

  // ---------------------------------------------------------------- 轻笔记
  const addNote = useCallback((content = '', color = NOTE_COLORS[0], title = '') => {
    const at = Date.now()
    const note: Note = {
      id: uid('note'),
      title,
      content,
      color,
      pinned: false,
      createdAt: at,
      updatedAt: at,
    }
    dispatch({ type: 'addNote', note })
    return note
  }, [])

  const updateNote = useCallback(
    (id: string, patch: Partial<Pick<Note, 'title' | 'content' | 'color' | 'pinned'>>) => {
      dispatch({ type: 'patchNote', id, patch: { ...patch, updatedAt: Date.now() } })
    },
    []
  )

  const removeNote = useCallback((id: string) => {
    dispatch({ type: 'removeNote', id })
  }, [])

  const togglePinNote = useCallback((id: string) => {
    const note = stateRef.current.notes.find((n) => n.id === id)
    if (!note) return
    dispatch({ type: 'patchNote', id, patch: { pinned: !note.pinned, updatedAt: Date.now() } })
  }, [])

  // ---------------------------------------------------------------- 工作清单（电子表格）
  const setActiveSheetId = useCallback((id: string | null) => {
    dispatch({ type: 'setActiveSheet', id })
  }, [])

  /** 给新建工作表的默认名字取"最小空闲编号"：Sheet1 被删后，新建的仍叫 Sheet 1 */
function pickSheetName(sheets: Sheet[]): string {
  return nextSheetName(sheets.map((s) => s.name))
}

const addSheet = useCallback((init?: string | Omit<Sheet, 'id'>) => {
    const base =
      init && typeof init !== 'string'
        ? init
        : blankSheet(init?.trim() || pickSheetName(stateRef.current.sheets))
    const sheet: Sheet = { id: uid('sheet'), ...base }
    dispatch({ type: 'addSheet', sheet })
    return sheet
  }, [])

  const renameSheet = useCallback((id: string, name: string) => {
    const next = name.trim() || '未命名'
    dispatch({ type: 'patchSheet', id, patch: { name: next, updatedAt: Date.now() } })
  }, [])

  const removeSheet = useCallback(
    (id: string) => {
      const list = stateRef.current.sheets
      if (list.length <= 1) return false
      if (!list.some((s) => s.id === id)) return false
      dispatch({ type: 'removeSheet', id })
      return true
    },
    []
  )

  const updateSheet = useCallback((id: string, patch: Partial<Sheet>) => {
    dispatch({ type: 'patchSheet', id, patch: { ...patch, updatedAt: Date.now() } })
  }, [])

  // ---------------------------------------------------------------- 提醒引擎
  const notifySoon = useCallback(
    (task: Task, remaining: number) => {
      const prefs = stateRef.current.prefs
      if (prefs.sound) playChime('soon', true)
      if (prefs.nativeNotify) {
        void bridge.notify({
          title: task.planned ? '⏰ 计划即将开始' : '⏳ 即将到期',
          subtitle: task.title,
          body: task.planned
            ? `还有 ${formatCountdown(remaining)}，点此查看`
            : `剩余 ${formatCountdown(remaining)}，点此一键续时长`,
          taskId: task.id,
        })
      }
      pushToast({
        tone: 'warn',
        title: task.planned ? '计划即将开始' : '即将到期',
        body: `${task.title} · 剩余 ${formatCountdown(remaining)}`,
        taskId: task.id,
        actionLabel: task.planned ? '标记完成' : '一键续时长',
        action: () => (task.planned ? completeTask(task.id) : renewTask(task.id)),
        secondaryLabel: task.planned ? '推迟 1 天' : '标记完成',
        secondaryAction: () => (task.planned ? renewTask(task.id, 1440) : completeTask(task.id)),
        ttl: 1000,
      })
    },
    [completeTask, pushToast, renewTask]
  )

  const notifyOverdue = useCallback(
    (task: Task) => {
      const prefs = stateRef.current.prefs
      if (prefs.sound) playChime('overdue', true)
      const planned = !!task.planned
      if (prefs.nativeNotify) {
        void bridge.notify({
          title: planned ? '📌 计划任务到点' : '⛔️ 已到期',
          subtitle: task.title,
          body: planned ? '计划时间已到，点此查看或标记完成' : '任务已到期，续时长或标记完成',
          taskId: task.id,
          urgency: planned ? 'normal' : 'critical',
        })
      }
      pushToast({
        tone: planned ? 'warn' : 'danger',
        title: planned ? '计划任务到点' : '任务已到期',
        body: task.title,
        taskId: task.id,
        actionLabel: '标记完成',
        action: () => completeTask(task.id),
        secondaryLabel: planned ? '推迟 1 天' : '一键续时长',
        secondaryAction: () => (planned ? renewTask(task.id, 1440) : renewTask(task.id)),
        ttl: 1000,
      })
    },
    [completeTask, pushToast, renewTask]
  )

  useEffect(() => {
    if (!state.ready) return
    for (const task of state.tasks) {
      // 回收站里的任务不再提醒
      if (task.trashedAt) continue
      if (task.status !== 'active' || !task.dueAt) continue
      const remaining = task.dueAt - now

      if (remaining <= 0) {
        if (task.expiredNotifiedAt) continue
        dispatch({ type: 'patchTask', id: task.id, patch: { expiredNotifiedAt: now } })
        // 错过太久（合盖休眠/关机）就不打扰：计划任务宽限 7 天，普通任务 6 小时
        const grace = task.planned ? 7 * DAY : 6 * HOUR
        if (now - task.dueAt < grace) notifyOverdue(task)
      } else if (remaining <= task.remindLeadMin * MINUTE) {
        if (task.remindedAt) continue
        dispatch({ type: 'patchTask', id: task.id, patch: { remindedAt: now } })
        notifySoon(task, remaining)
      }
    }
  }, [now, state.tasks, state.ready, notifyOverdue, notifySoon])

  // Dock 角标：即将到期 + 已到期
  const alertCount = useMemo(
    () =>
      state.tasks.filter((t) => {
        if (t.trashedAt) return false
        const u = urgencyOf(t, now)
        return u === 'soon' || u === 'overdue'
      }).length,
    [state.tasks, now]
  )

  useEffect(() => {
    if (!state.ready) return
    void bridge.badge(alertCount > 0 ? String(alertCount) : '')
  }, [alertCount, state.ready])

  // 系统通知点击 → 定位任务（滚动 + 高亮）
  useEffect(() => {
    let timer = 0
    const off = bridge.onFocusTask((taskId) => {
      setFocusTaskId(taskId, { scroll: true })
      // 多次点击共用一个计时器，旧计时不清掉新的高亮
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setFocusTaskId(null), 4000)
    })
    return () => {
      window.clearTimeout(timer)
      off()
    }
  }, [setFocusTaskId])

  // value 在任务/分类/偏好/提示等真正变化时才更新；每秒的 now 变化不再触发它
  const value: Ctx = useMemo(
    () => ({
      ready: state.ready,
      tasks: state.tasks,
      categories: state.categories,
      habits: state.habits,
      notes: state.notes,
      sheets: state.sheets,
      activeSheetId: state.activeSheetId,
      prefs: state.prefs,
      toasts,
      focusTaskId,
      setFocusTaskId,
      focusScroll,
      pushToast,
      dismissToast,
      holdToast,
      releaseToast,
      categoryById,
      createTask,
      createPlannedTask,
      updateTask,
      removeTask,
      trashTask,
      purgeTask,
      emptyTrash,
      trashAllCompleted,
      navRequest,
      requestView,
      completeTask,
      restoreTask,
      renewTask,
      completeAllVisible,
      toggleSubtask,
      addCategory,
      renameCategory,
      removeCategory,
      setPrefs,
      addHabit,
      updateHabit,
      removeHabit,
      toggleHabitCheckin,
      checkinAllHabits,
      setHabitDayNote,
      addNote,
      updateNote,
      removeNote,
      togglePinNote,
      setActiveSheetId,
      addSheet,
      renameSheet,
      removeSheet,
      updateSheet,
    }),
    [
      state.ready,
      state.tasks,
      state.categories,
      state.habits,
      state.notes,
      state.sheets,
      state.activeSheetId,
      state.prefs,
      toasts,
      focusTaskId,
      focusScroll,
      setFocusTaskId,
      pushToast,
      dismissToast,
      holdToast,
      releaseToast,
      categoryById,
      createTask,
      createPlannedTask,
      updateTask,
      removeTask,
      trashTask,
      purgeTask,
      emptyTrash,
      trashAllCompleted,
      navRequest,
      requestView,
      completeTask,
      restoreTask,
      renewTask,
      completeAllVisible,
      toggleSubtask,
      addCategory,
      renameCategory,
      removeCategory,
      setPrefs,
      addHabit,
      updateHabit,
      removeHabit,
      toggleHabitCheckin,
      checkinAllHabits,
      setHabitDayNote,
      addNote,
      updateNote,
      removeNote,
      togglePinNote,
      setActiveSheetId,
      addSheet,
      renameSheet,
      removeSheet,
      updateSheet,
    ]
  )

  return (
    <AppContext.Provider value={value}>
      <ClockContext.Provider value={now}>{children}</ClockContext.Provider>
    </AppContext.Provider>
  )
}

export function useApp(): Ctx {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp 必须在 <AppProvider> 内使用')
  return ctx
}

/** 订阅每秒走时（仅倒计时/时间相关组件需要） */
export function useNow(): number {
  return useContext(ClockContext)
}
