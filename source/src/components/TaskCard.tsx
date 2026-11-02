import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useApp } from '../store/AppContext'
import {
  PRIORITY_META,
  URGENCY_META,
  formatCountdown,
  formatDateTime,
  formatDurationShort,
  formatRelative,
  progressOf,
  remainingOf,
  urgencyOf,
} from '../lib/time'
import { cn } from '../lib/cn'
import type { Task } from '../types'
import { CheckDraw, celebrate } from './Celebration'
import {
  IconBolt,
  IconCalendar,
  IconCheck,
  IconClock,
  IconLayers,
  IconMore,
  IconPencil,
  IconRenew,
  IconTarget,
  IconTrash,
} from './Icons'

interface Props {
  task: Task
  now: number
  highlighted?: boolean
  /** 是否滚动到该卡片（仅在用户主动「定位任务」时为 true，创建任务不会触发） */
  reveal?: boolean
  /** 只读：过去的计划/每周任务，仅查看不可修改 */
  readOnly?: boolean
  onEdit: (task: Task) => void
  /** 拆分子任务：打开编辑弹窗并聚焦子任务 */
  onSplit?: (task: Task) => void
  /** 进入专注模式 */
  onFocus?: (task: Task) => void
  index: number
}

function TaskCardBase({ task, now, highlighted, reveal, readOnly = false, onEdit, onSplit, onFocus, index }: Props) {
  const { categoryById, completeTask, renewTask, trashTask, restoreTask, toggleSubtask } = useApp()
  const [menuOpen, setMenuOpen] = useState(false)
  const [flipUp, setFlipUp] = useState(false)
  /** 正在飞向回收站（离场动效播放中） */
  const [leaving, setLeaving] = useState(false)
  const cardRef = useRef<HTMLElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const leaveTimer = useRef(0)
  /** 离场动效期间待删除的任务 id：动效未完组件就被卸载时，仍要完成删除 */
  const pendingTrashId = useRef<string | null>(null)

  const done = task.status === 'completed'
  const urgency = urgencyOf(task, now)
  const meta = URGENCY_META[urgency]
  const category = categoryById(task.categoryId)
  const remaining = remainingOf(task, now)
  const progress = done ? 1 : urgency === 'overdue' ? 1 : progressOf(task, now)
  const priority = PRIORITY_META[task.priority]

  const barColor = done
    ? 'var(--ok)'
    : urgency === 'overdue'
      ? 'var(--danger)'
      : urgency === 'soon'
        ? 'var(--warn)'
        : 'var(--cy)'

  /**
   * 卡片本体有 overflow-hidden（玻璃拟态需要），菜单若留在卡片内会被裁掉。
   * 做法：把菜单作为卡片【同级】的绝对定位元素，位置由外层定位容器决定——
   * 不依赖坐标计算，卡片滚动/移动时菜单自动跟随。
   */
  useEffect(() => {
    if (!menuOpen) return
    const close = () => setMenuOpen(false)
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return
      close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  // 下方放不下就翻到按钮上方（一次性判定，菜单锚定卡片、随卡片滚动）
  useLayoutEffect(() => {
    if (!menuOpen || !menuRef.current || !btnRef.current) return
    const br = btnRef.current.getBoundingClientRect()
    const h = menuRef.current.getBoundingClientRect().height
    setFlipUp(br.bottom + 6 + h > window.innerHeight - 8)
  }, [menuOpen])

  // 只有用户主动「定位任务」时才滚动，避免创建任务后页面自己跳走
  useEffect(() => {
    if (!reveal || !cardRef.current) return
    cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [reveal])

  useEffect(
    () => () => {
      window.clearTimeout(leaveTimer.current)
      // 动效还没播完就被卸载（切视图/筛选）：立即补执行删除，避免任务"复活"
      if (pendingTrashId.current) trashTask(pendingTrashId.current)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  /** 删除 = 先移入回收站（播放收进回收站的离场动效），不是真的删除 */
  function handleDelete() {
    setMenuOpen(false)
    setLeaving(true)
    pendingTrashId.current = task.id
    leaveTimer.current = window.setTimeout(() => {
      pendingTrashId.current = null
      trashTask(task.id)
    }, 500)
  }

  function handleComplete(e: React.MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    celebrate(rect.left + rect.width / 2, rect.top + rect.height / 2)
    if (done) restoreTask(task.id)
    else completeTask(task.id)
  }

  return (
    <div className="relative">
      <article
      ref={cardRef}
      data-task-id={task.id}
      onClick={(e) => {
        // 点卡片任意空白处 = 查看/编辑详情；按钮、菜单等交互元素自行处理
        const el = e.target as HTMLElement
        if (el.closest('button, a, input, textarea, select, [role="menu"], [role="menuitem"]')) return
        onEdit(task)
      }}
      style={{
        animationDelay: `${Math.min(index, 8) * 45}ms`,
        ...(highlighted
          ? { boxShadow: '0 0 0 2px var(--accent), 0 24px 60px -30px var(--accent-glow)' }
          : {}),
      }}
      className={cn(
        'glass sheen group relative animate-fade-up cursor-pointer overflow-hidden rounded-[22px] p-4 transition-all duration-300',
        'hover:-translate-y-0.5 hover:border-[color-mix(in_srgb,var(--text-2)_28%,transparent)]',
        done && 'opacity-70',
        leaving && 'trash-leave'
      )}
    >
      {/* 左侧优先级条 */}
      <span
        className="absolute inset-y-3 left-0 w-[3px] rounded-full transition-opacity"
        style={{ background: priority.color, opacity: done ? 0.25 : 0.85 }}
      />

      <div className="flex items-start gap-3 pl-2.5">
        {/* 完成圆钮：只读时改为静态标识，不可点击 */}
        {readOnly ? (
          <span
            aria-hidden
            className={cn(
              'mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl',
              done ? 'text-white' : 'border border-line'
            )}
            style={done ? { background: 'var(--ok)', opacity: 0.9 } : { background: 'var(--surface)' }}
          >
            {done ? <CheckDraw /> : null}
          </span>
        ) : (
          <button
            onClick={handleComplete}
            aria-label={done ? '恢复任务' : '标记完成'}
            aria-pressed={done}
            className={cn(
              'mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border transition-all duration-200',
              done
                ? 'border-transparent text-white'
                : 'border-line t3 hover:border-[var(--ok)] hover:text-[var(--ok)]'
            )}
            style={done ? { background: 'var(--ok)' } : { background: 'var(--surface)' }}
          >
            {done ? <CheckDraw /> : <IconCheck size={19} />}
          </button>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <h3
              className={cn(
                'min-w-0 flex-1 break-words font-display text-[16.5px] font-semibold leading-snug transition-colors',
                done ? 't3 line-through decoration-1' : 't1 group-hover:text-[color-mix(in_srgb,var(--accent)_75%,var(--text-1))]'
              )}
              title="点击查看详情"
            >
              {task.title}
            </h3>

            {!readOnly && (
            <div className="relative shrink-0">
              <button
                ref={btnRef}
                className="btn-icon !min-h-[34px] !min-w-[34px] rounded-lg"
                aria-label="更多操作"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setMenuOpen((s) => !s)}
              >
                <IconMore size={17} />
              </button>
            </div>
          )}
          </div>

          {task.note && !done && (
            <p className="mt-1.5 line-clamp-2 text-[13.5px] leading-relaxed t2">{task.note}</p>
          )}

          {task.subtasks && task.subtasks.length > 0 && (
            <div className="mt-2.5 rounded-xl border border-line p-2" style={{ background: 'var(--surface)' }}>
              <div className="max-h-[150px] space-y-1 overflow-y-auto pr-1">
                {task.subtasks.map((s) => {
                  const subDone = s.done || done
                  return (
                    <div key={s.id} className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleSubtask(task.id, s.id)
                        }}
                        disabled={readOnly}
                        aria-label={subDone ? '标记子任务未完成' : '标记子任务已完成'}
                        className={cn(
                          'flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[5px] border transition-all',
                          subDone ? 'border-transparent' : 'border-line hover:border-[var(--ok)]'
                        )}
                        style={subDone ? { background: 'var(--ok)', color: 'white' } : undefined}
                      >
                        {subDone && <IconCheck size={12} />}
                      </button>
                      <span
                        className={cn(
                          'min-w-0 flex-1 truncate text-[13px] font-medium leading-tight',
                          subDone ? 't3 line-through' : 't2'
                        )}
                      >
                        {s.title}
                      </span>
                      {s.durationMin != null && (
                        <span className="chip !px-1.5 !py-0 text-[10.5px]">{formatDurationShort(s.durationMin)}</span>
                      )}
                      {s.dueAt != null && (
                        <span className="tnum shrink-0 text-[10.5px] t3">{formatDateTime(s.dueAt)}</span>
                      )}
                    </div>
                  )
                })}
              </div>
              <p className="pt-1.5 text-[11px] font-semibold t3">
                已完成 {task.subtasks.filter((s) => s.done || done).length} / {task.subtasks.length}
              </p>
            </div>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[12.5px]">
            <span className="inline-flex items-center gap-1.5 t2">
              <span className="h-2 w-2 rounded-full" style={{ background: category.color }} />
              {category.name}
            </span>
            {task.planned && (
              <>
                <span className="t3">·</span>
                <span
                  className="inline-flex items-center gap-1 rounded-full px-2 py-[1px] text-[11.5px] font-bold"
                  style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                >
                  <IconCalendar size={11} />
                  计划
                </span>
              </>
            )}
            <span className="t3">·</span>
            <span className="t3">{formatRelative(task.createdAt, now)}创建</span>
            {task.planned && task.dueAt !== null ? (
              <>
                <span className="t3">·</span>
                <span className="inline-flex items-center gap-1 t2 font-semibold">
                  <IconClock size={12} />
                  {formatDateTime(task.dueAt)}
                </span>
              </>
            ) : (
              task.durationMin !== null && (
                <>
                  <span className="t3">·</span>
                  <span className="inline-flex items-center gap-1 t3">
                    <IconClock size={12} />
                    {formatDurationShort(task.durationMin)}
                  </span>
                </>
              )
            )}
            {task.renewCount > 0 && (
              <span className="t3">· 已续 {task.renewCount} 次</span>
            )}
          </div>
        </div>
      </div>

      {/* 计时区 */}
      {!done && task.dueAt !== null && remaining !== null && (
        <div className="mt-3.5 pl-2.5">
          <div className="flex items-center justify-between gap-3">
            <span
              className="inline-flex items-center gap-1.5 text-[12px] font-bold"
              style={{ color: meta.color }}
            >
              <span
                className={cn('h-1.5 w-1.5 rounded-full', urgency !== 'running' && 'animate-breathe')}
                style={{ background: meta.color }}
              />
              {urgency === 'overdue'
                ? `已超时 ${formatCountdown(Math.abs(remaining))}`
                : `${meta.label} · 剩余`}
            </span>
            <span
              className="tnum font-mono text-[15px] font-bold leading-none"
              style={{ color: meta.color }}
            >
              {urgency === 'overdue' ? null : formatCountdown(remaining)}
            </span>
          </div>
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full"
            style={{ background: 'var(--surface-2)' }}
          >
            <div
              className="h-full w-full origin-left rounded-full"
              style={{
                transform: `scaleX(${Math.max(0.02, progress)})`,
                background: `linear-gradient(90deg, color-mix(in srgb, ${barColor} 55%, transparent), ${barColor})`,
                transition: 'transform 1s linear, background 0.5s ease',
              }}
            />
          </div>
        </div>
      )}

      {/* 操作区：紧凑按钮簇，右对齐，避免主按钮被拉满整行；只读时仅显示提示 */}
      {readOnly ? (
        <p className="mt-3.5 text-right text-[12px] font-semibold t3">已过去的日期 · 仅可查看</p>
      ) : (
      <div className="mt-3.5 flex flex-wrap items-center justify-end gap-2">
        <button
          className={cn(
            'btn !min-h-[40px] !rounded-xl !px-4 text-[13.5px]',
            done ? 'btn-ghost' : 'btn-primary'
          )}
          onClick={handleComplete}
          title={done ? '恢复到进行中' : '标记为已完成'}
        >
          {done ? <IconRenew size={15} /> : <IconCheck size={15} />}
          {done ? '恢复任务' : '标记完成'}
        </button>

        {onFocus && !done && (
          <button
            className="btn btn-ghost !min-h-[40px] !rounded-xl !px-3.5 text-[13.5px]"
            onClick={() => onFocus(task)}
            title="进入专注模式：只做这一件事，带倒计时"
          >
            <IconTarget size={15} />
            专注模式
          </button>
        )}

        {onSplit && !done && (
          <button
            className="btn btn-ghost !min-h-[40px] !rounded-xl !px-3.5 text-[13.5px]"
            onClick={() => onSplit(task)}
            title="把任务拆成多个子任务，每个子任务可单独设时长与时间"
          >
            <IconLayers size={15} />
            拆分子任务
          </button>
        )}

        {!done && task.durationMin !== null && (
          <button
            className="btn btn-ghost !min-h-[40px] !rounded-xl !px-3.5 text-[13.5px]"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              celebrate(rect.left + rect.width / 2, rect.top)
              renewTask(task.id)
            }}
            title={`一键按原时长续期（${formatDurationShort(task.durationMin)}）`}
          >
            <IconRenew size={15} />
            <span className="hidden xl:inline">续 {formatDurationShort(task.durationMin)}</span>
            <span className="xl:hidden">续时长</span>
          </button>
        )}

        {!done && task.dueAt === null && (
          <button
            className="btn btn-ghost !min-h-[40px] !rounded-xl !px-3.5 text-[13.5px]"
            onClick={() => onEdit(task)}
          >
            <IconClock size={14} />
            设定时长
          </button>
        )}
      </div>
      )}

      </article>

      {menuOpen && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="任务操作"
          className={cn(
            'animate-pop-in absolute right-3 z-40 w-[208px] overflow-hidden rounded-2xl border border-line p-1.5 shadow-lift',
            flipUp ? 'bottom-[calc(100%-18px)]' : 'top-[52px]'
          )}
          style={{ background: 'var(--ink-800)', backdropFilter: 'blur(20px)' }}
        >
          {done ? (
            <>
              <MenuItem
                icon={<IconRenew size={15} />}
                onClick={() => {
                  restoreTask(task.id)
                  setMenuOpen(false)
                }}
              >
                恢复任务
              </MenuItem>
            </>
          ) : (
            <>
              <MenuItem
                icon={<IconBolt size={15} />}
                onClick={() => {
                  renewTask(task.id, 30)
                  setMenuOpen(false)
                }}
              >
                续 30 分钟
              </MenuItem>
              <MenuItem
                icon={<IconClock size={15} />}
                onClick={() => {
                  renewTask(task.id, 60)
                  setMenuOpen(false)
                }}
              >
                续 1 小时
              </MenuItem>
              {task.planned && (
                <MenuItem
                  icon={<IconCalendar size={15} />}
                  onClick={() => {
                    renewTask(task.id, 1440)
                    setMenuOpen(false)
                  }}
                >
                  推迟 1 天
                </MenuItem>
              )}
              <MenuItem
                icon={<IconPencil size={15} />}
                onClick={() => {
                  onEdit(task)
                  setMenuOpen(false)
                }}
              >
                编辑任务
              </MenuItem>
            </>
          )}
          <div className="my-1 h-px" style={{ background: 'var(--line)' }} />
          <MenuItem
            danger
            icon={<IconTrash size={15} />}
            onClick={handleDelete}
          >
            删除到回收站
          </MenuItem>
        </div>
      )}
    </div>
  )
}

/** 列表项用 memo 包裹：父组件因搜索词/弹窗等无关状态重渲染时，卡片可跳过重渲染 */
export const TaskCard = memo(TaskCardBase)

function MenuItem({
  children,
  icon,
  onClick,
  danger,
}: {
  children: React.ReactNode
  icon: React.ReactNode
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13.5px] font-medium transition-colors',
        danger ? 'hover:bg-[rgba(255,92,122,0.12)] hover:text-[var(--danger)]' : 'hover:bg-surface2'
      )}
      style={{ color: danger ? 'var(--danger)' : 'var(--text-1)' }}
    >
      {icon}
      {children}
    </button>
  )
}
