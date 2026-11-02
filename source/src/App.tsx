import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppProvider, useApp, useNow } from './store/AppContext'
import { Backdrop, LogoMark } from './components/Backdrop'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { HeroFocus } from './components/HeroFocus'
import { TaskCard } from './components/TaskCard'
import { TaskComposer } from './components/TaskComposer'
import { QuickAdd, type QuickDraft } from './components/QuickAdd'
import { PlanBoard } from './components/PlanBoard'
import { TrashBoard } from './components/TrashBoard'
import { WeekBoard } from './components/WeekBoard'
import { HabitsBoard } from './components/HabitsBoard'
import { NotesBoard } from './components/NotesBoard'
import { SheetsBoard } from './components/SheetsBoard'
import { SpeedRecBoard } from './recorder/SpeedRecBoard'
import { FocusMode } from './components/FocusMode'
import { FloatingNotes } from './components/FloatingNotes'
import { ToastStack } from './components/Toasts'
import { CelebrationLayer } from './components/Celebration'
import { EmptyState } from './components/EmptyState'
import { IconCheck, IconTrash } from './components/Icons'
import { isSameDay, urgencyOf, formatClock, dayKey, DAY } from './lib/time'
import { cn } from './lib/cn'
import { bridge } from './lib/bridge'
import type { SortKey, Task, ViewKey } from './types'

const PRIORITY_RANK: Record<Task['priority'], number> = { high: 0, medium: 1, low: 2 }

function sortTasks(list: Task[], key: SortKey): Task[] {
  const copy = [...list]
  copy.sort((a, b) => {
    if (key === 'created') return b.createdAt - a.createdAt
    if (key === 'title') return a.title.localeCompare(b.title, 'zh-Hans-CN')
    if (key === 'priority') {
      const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
      if (p !== 0) return p
      return (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity)
    }
    // 默认：未完成优先 → 有定时的按到期时间 → 其余按创建时间
    if (a.status !== b.status) return a.status === 'completed' ? 1 : -1
    if (a.status === 'completed') return (b.completedAt ?? 0) - (a.completedAt ?? 0)
    const aTimed = a.dueAt !== null
    const bTimed = b.dueAt !== null
    if (aTimed !== bTimed) return aTimed ? -1 : 1
    if (aTimed && bTimed) return (a.dueAt as number) - (b.dueAt as number)
    return b.createdAt - a.createdAt
  })
  return copy
}

function Shell() {
  const {
    ready,
    tasks,
    categories,
    habits,
    completeAllVisible,
    trashAllCompleted,
    navRequest,
    focusTaskId,
    focusScroll,
    checkinAllHabits,
  } = useApp()
  const now = useNow()

  const [view, setView] = useState<ViewKey>('all')
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('urgency')
  const [composerOpen, setComposerOpen] = useState(false)
  const [editing, setEditing] = useState<Task | null>(null)
  const [draft, setDraft] = useState<QuickDraft | null>(null)
  /** 只读详情：过去的计划/每周任务，仅查看不可修改 */
  const [readonlyMode, setReadonlyMode] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  /** 递增触发 TaskComposer 的「拆分子任务」模式（每次 +1） */
  const [splitToken, setSplitToken] = useState(0)
  /** 正在专注的任务 id（全屏专注覆盖层） */
  const [focusSessionId, setFocusSessionId] = useState<string | null>(null)
  /** 工作清单应用内全屏（隐藏顶栏/侧栏，Esc 退出） */
  const [sheetsFs, setSheetsFs] = useState(false)
  const sheetsFsRef = useRef(false)
  sheetsFsRef.current = sheetsFs

  /**
   * 轻量模式：主窗口收起到 Dock（macOS 保证 Dock 图标可见），
   * 有「今天 / 快到期」的未完成任务时，主进程周期性在屏幕顶部从右到左飘过提醒。
   * 主进程是状态的唯一真源（点 Dock 图标 / 点飘条也会改它），这里跟随它。
   */
  const [lightmode, setLightmode] = useState(false)

  /** Windows 上顶栏即标题栏：左侧不留红绿灯位，右侧给系统窗口按钮让位 */
  const isWin = bridge.platform === 'win32'

  const searchRef = useRef<HTMLInputElement>(null)
  const quickRef = useRef<HTMLInputElement>(null)
  const composerOpenRef = useRef(false)
  composerOpenRef.current = composerOpen

  const openNew = useCallback(() => {
    setEditing(null)
    setDraft(null)
    setSplitToken(0)
    setReadonlyMode(false)
    setComposerOpen(true)
  }, [])

  /** 从快速创建跳到详细设置，并带上已输入的内容 */
  const openDetailed = useCallback((d: QuickDraft) => {
    setEditing(null)
    setDraft(d)
    setSplitToken(0)
    setReadonlyMode(false)
    setComposerOpen(true)
  }, [])

  /** 把焦点交给首页快速输入框 */
  const focusQuick = useCallback(() => {
    quickRef.current?.focus()
    quickRef.current?.select()
  }, [])

  const openSidebar = useCallback(() => setSidebarOpen(true), [])
  const closeSidebar = useCallback(() => setSidebarOpen(false), [])

  /** 顶栏「工作清单」按钮：直接切到电子表格视图 */
  const openSheets = useCallback(() => {
    setView('sheets')
    setActiveCategory(null)
    setSidebarOpen(false)
  }, [])
  const closeComposer = useCallback(() => {
    setComposerOpen(false)
    setEditing(null)
    setDraft(null)
    setSplitToken(0)
    setReadonlyMode(false)
  }, [])

  /** 稳定的编辑回调：避免每次渲染都让列表卡片重渲染 */
  const handleEdit = useCallback((task: Task) => {
    setEditing(task)
    setReadonlyMode(task.status === 'completed')
    setComposerOpen(true)
  }, [])

  /** 只读查看：过去的计划/每周任务，仅查看不可修改 */
  const viewTask = useCallback((task: Task) => {
    setEditing(task)
    setDraft(null)
    setSplitToken(0)
    setReadonlyMode(true)
    setComposerOpen(true)
  }, [])

  /** 「拆分子任务」：打开编辑弹窗并聚焦子任务编辑 */
  const handleSplit = useCallback((task: Task) => {
    setEditing(task)
    setDraft(null)
    setSplitToken((n) => n + 1)
    setReadonlyMode(false)
    setComposerOpen(true)
  }, [])

  /** 进入专注模式 */
  const handleFocus = useCallback((task: Task) => {
    setFocusSessionId(task.id)
  }, [])

  const exitFocus = useCallback(() => setFocusSessionId(null), [])

  /** 专注中的任务；任务被删除或完成后自动退出 */
  const focusTask = useMemo(
    () => tasks.find((t) => t.id === focusSessionId) ?? null,
    [tasks, focusSessionId]
  )
  useEffect(() => {
    if (focusSessionId && (!focusTask || focusTask.trashedAt || focusTask.status === 'completed')) {
      setFocusSessionId(null)
    }
  }, [focusSessionId, focusTask])

  // 快捷键：⌘K 搜索、⌘N 聚焦快速创建、Esc 关闭抽屉
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      } else if (meta && !e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        if (composerOpenRef.current) return
        focusQuick()
      } else if (e.key === 'Escape') {
        setSidebarOpen(false)
        const el = e.target as HTMLElement
        // 编辑单元格输入框里的 Esc 只取消编辑，不退出表格全屏
        if (
          sheetsFsRef.current &&
          !(el instanceof HTMLInputElement) &&
          !(el instanceof HTMLTextAreaElement)
        ) {
          setSheetsFs(false)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /** 离开工作清单视图时自动退出表格全屏 */
  useEffect(() => {
    if (view !== 'sheets') setSheetsFs(false)
  }, [view])

  /** 提示里的「去看看」等跳转请求 */
  useEffect(() => {
    if (!navRequest) return
    setView(navRequest.view)
    setActiveCategory(null)
    setSidebarOpen(false)
  }, [navRequest])

  /** 回收站里的任务不参与任何常规视图 */
  const liveTasks = useMemo(() => tasks.filter((t) => !t.trashedAt), [tasks])

  const visible = useMemo(() => {
    let list = liveTasks
    if (activeCategory) list = list.filter((t) => t.categoryId === activeCategory)
    if (view === 'active') list = list.filter((t) => t.status === 'active')
    else if (view === 'done') list = list.filter((t) => t.status === 'completed')
    else if (view === 'soon') {
      list = list.filter((t) => {
        const u = urgencyOf(t, now)
        return u === 'soon' || u === 'overdue'
      })
    }
    const q = query.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (t) => t.title.toLowerCase().includes(q) || t.note.toLowerCase().includes(q)
      )
    }
    return sortTasks(list, sort)
  }, [liveTasks, activeCategory, view, query, sort, now])

  const heroTask = useMemo(() => {
    const timed = liveTasks.filter((t) => t.status === 'active' && t.dueAt !== null)
    if (!timed.length) return null
    return timed.reduce((a, b) => ((a.dueAt as number) <= (b.dueAt as number) ? a : b))
  }, [liveTasks])

  const stats = useMemo(() => {
    let active = 0
    let soon = 0
    let doneToday = 0
    let done = 0
    for (const t of liveTasks) {
      if (t.status === 'completed') {
        done += 1
        if (t.completedAt && isSameDay(t.completedAt, now)) doneToday += 1
        continue
      }
      active += 1
      const u = urgencyOf(t, now)
      if (u === 'soon' || u === 'overdue') soon += 1
    }
    return { active, soon, doneToday, done }
  }, [liveTasks, now])

  /** 轻量模式飘过提醒的对象：今天到期 / 已过期 / 24 小时内快到期的未完成任务 */
  const upcoming = useMemo(() => {
    return liveTasks
      .filter(
        (t) => t.status === 'active' && t.dueAt !== null && (t.dueAt as number) - now <= DAY
      )
      .sort((a, b) => (a.dueAt as number) - (b.dueAt as number))
  }, [liveTasks, now])

  /**
   * 飘条清单：一条任务一个飘条（主进程最多取 5 条）。
   * 时间标签稳定、不含「还剩几分钟」，避免 now 每秒走时导致 IPC 空转。
   */
  const flyTasks = useMemo(
    () =>
      upcoming.slice(0, 5).map((t) => {
        const due = t.dueAt as number
        return {
          id: t.id,
          title: t.title,
          overdue: due < now,
          label:
            due < now
              ? '已过期'
              : isSameDay(due, now)
                ? `今天 ${formatClock(due)}`
                : `明天 ${formatClock(due)}`,
        }
      }),
    [upcoming, now]
  )

  const toggleLightmode = useCallback(() => {
    setLightmode(!lightmode)
    void bridge.lightmodeSet(!lightmode)
  }, [lightmode])

  // 主进程 → 渲染层：点 Dock 图标、点飘条都会退出轻量模式
  useEffect(() => bridge.onLightmodeState((on) => setLightmode(on)), [])

  // 待办清单随时同步给主进程：主进程自己在轻量模式里才用得上，但「进入轻量模式」
  // 是主进程发起的切换，渲染层这边不一定有状态更新，所以不能只在 lightmode 为真时才推。
  const flySignature = flyTasks.map((t) => `${t.title}|${t.label}|${t.overdue ? 1 : 0}`).join('\n')
  useEffect(() => {
    void bridge.lightmodeTasks({
      tasks: flyTasks.map(({ title, label, overdue }) => ({ title, label, overdue })),
      count: upcoming.length,
      taskId: flyTasks[0]?.id ?? null,
    })
    // flySignature 是 flyTasks 的稳定指纹：内容没变就不重复推送
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flySignature, upcoming.length])

  /** 快速打卡：今天还没打卡的习惯数（顶栏按钮角标） */
  const pendingCheckins = useMemo(() => {
    const key = dayKey(now)
    let n = 0
    for (const h of habits) if (!h.checkins[key]) n += 1
    return n
  }, [habits, now])

  const sectionTitle = useMemo(() => {
    if (activeCategory) return categories.find((c) => c.id === activeCategory)?.name ?? '任务'
    if (view === 'active') return '进行中'
    if (view === 'soon') return '即将到期'
    if (view === 'week') return '每周任务'
    if (view === 'plan') return '未来计划'
    if (view === 'habits') return '打卡'
    if (view === 'notes') return '轻笔记'
    if (view === 'done') return '已完成'
    if (view === 'trash') return '回收站'
    return '全部任务'
  }, [activeCategory, categories, view])

  const completableIds = useMemo(
    () => visible.filter((t) => t.status === 'active').map((t) => t.id),
    [visible]
  )

  if (!ready) return <Splash />

  return (
    <div className="relative flex h-screen flex-col overflow-hidden">
      <Backdrop />

      {!sheetsFs && (
        <TopBar
          query={query}
          onQuery={setQuery}
          sort={sort}
          onSort={setSort}
          onNew={openNew}
          onMenu={openSidebar}
          searchRef={searchRef}
          isWin={isWin}
          lightmode={lightmode}
          onLightmode={toggleLightmode}
          canLightmode={bridge.isNative}
          onQuickCheckin={checkinAllHabits}
          pendingCheckins={pendingCheckins}
          habitTotal={habits.length}
          onOpenSheets={openSheets}
          sheetsActive={view === 'sheets'}
        />
      )}

      <div className="flex min-h-0 flex-1">
        {!sheetsFs && (
          <Sidebar
            view={view}
            onView={setView}
            activeCategory={activeCategory}
            onCategory={setActiveCategory}
            open={sidebarOpen}
            onClose={closeSidebar}
          />
        )}

        <main className="min-w-0 flex-1 overflow-y-auto">
          <div
            className={
              view === 'sheets' && sheetsFs
                ? 'mx-auto flex h-full min-h-0 w-full flex-col px-3 py-2'
                : view === 'sheets'
                  ? 'mx-auto flex h-full min-h-0 w-full max-w-[1500px] flex-col px-4 pt-2 sm:px-6'
                  : view === 'speedrec'
                    ? 'flex h-full min-h-0 w-full flex-col'
                    : 'mx-auto max-w-[1500px] space-y-6 px-4 pb-24 pt-2 sm:px-6'
            }
          >
            {view === 'plan' ? (
              <PlanBoard
                now={now}
                onEdit={handleEdit}
                onView={viewTask}
              />
            ) : view === 'trash' ? (
              <TrashBoard now={now} query={query} />
            ) : view === 'week' ? (
              <WeekBoard now={now} onEdit={handleEdit} onView={viewTask} />
            ) : view === 'habits' ? (
              <HabitsBoard now={now} />
            ) : view === 'notes' ? (
              <NotesBoard now={now} query={query} />
            ) : view === 'sheets' ? (
              <SheetsBoard
                now={now}
                fullscreen={view === 'sheets' && sheetsFs}
                onToggleFullscreen={() => setSheetsFs((v) => !v)}
              />
            ) : view === 'speedrec' ? (
              <SpeedRecBoard />
            ) : (
              <>
            <QuickAdd inputRef={quickRef} onDetailed={openDetailed} />

            <HeroFocus task={heroTask} now={now} onNew={focusQuick} />

            <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile label="进行中" value={stats.active} accent="var(--cy)" />
              <StatTile label="即将到期" value={stats.soon} accent="var(--warn)" pulse={stats.soon > 0} />
              <StatTile label="今日完成" value={stats.doneToday} accent="var(--ok)" />
              <StatTile label="累计完成" value={stats.done} accent="var(--accent)" />
            </section>

            <section>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-baseline gap-2.5">
                  <h2 className="font-display text-[19px] font-bold t1">{sectionTitle}</h2>
                  <span className="tnum text-[13px] font-semibold t3">{visible.length} 个任务</span>
                </div>

                <div className="flex items-center gap-2">
                  {view !== 'done' && completableIds.length > 0 && (
                    <button
                      className="btn btn-ghost !min-h-[38px] !rounded-xl text-[13px]"
                      onClick={() => completeAllVisible(completableIds)}
                    >
                      <IconCheck size={15} />
                      全部标记完成
                    </button>
                  )}
                  {view === 'done' && stats.done > 0 && (
                    <button
                      className="btn btn-ghost !min-h-[38px] !rounded-xl text-[13px] hover:!text-[var(--danger)]"
                      onClick={trashAllCompleted}
                      title="移入回收站后还可以在回收站里彻底删除"
                    >
                      <IconTrash size={15} />
                      全部移入回收站
                    </button>
                  )}
                </div>
              </div>

              {visible.length === 0 ? (
                <EmptyState
                  kind={query.trim() ? 'search' : 'filtered'}
                  query={query.trim()}
                  onNew={focusQuick}
                />
              ) : (
                <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-2 2xl:grid-cols-3">
                  {visible.map((t, i) => (
                    <TaskCard
                      key={t.id}
                      task={t}
                      now={now}
                      index={i}
                      highlighted={focusTaskId === t.id}
                      reveal={focusTaskId === t.id && focusScroll}
                      onEdit={handleEdit}
                      onSplit={handleSplit}
                      onFocus={handleFocus}
                    />
                  ))}
                </div>
              )}
            </section>
              </>
            )}

          </div>
        </main>
      </div>

      <TaskComposer
        open={composerOpen}
        editing={editing}
        draft={draft}
        subtaskFocus={splitToken}
        readOnly={readonlyMode}
        onClose={closeComposer}
      />
      {focusTask && <FocusMode task={focusTask} onExit={exitFocus} />}
      {!focusSessionId && !sheetsFs && view !== 'sheets' && view !== 'speedrec' && <FloatingNotes />}
      <ToastStack />
      <CelebrationLayer />
    </div>
  )
}

function StatTile({
  label,
  value,
  accent,
  pulse,
}: {
  label: string
  value: number
  accent: string
  pulse?: boolean
}) {
  return (
    <div className="glass sheen relative overflow-hidden rounded-[18px] px-4 py-3.5">
      <div
        className="pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full blur-2xl"
        style={{ background: `radial-gradient(circle, ${accent}33, transparent 70%)` }}
      />
      <div className="relative flex items-center justify-between gap-2">
        <span className="text-[12.5px] font-semibold t2">{label}</span>
        {pulse && (
          <span className="h-1.5 w-1.5 animate-breathe rounded-full" style={{ background: accent }} />
        )}
      </div>
      <p
        className={cn('tnum relative mt-1 font-display text-[26px] font-bold leading-none')}
        style={{ color: value > 0 ? accent : 'var(--text-3)' }}
      >
        {value}
      </p>
    </div>
  )
}

function Splash() {
  return (
    <div className="relative flex h-screen items-center justify-center">
      <Backdrop />
      <div className="animate-fade-up flex flex-col items-center gap-4">
        <LogoMark size={52} className="animate-breathe" />
        <p className="font-display text-[15px] font-bold t2">Sloth 正在加载…</p>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}
