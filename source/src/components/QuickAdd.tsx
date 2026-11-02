import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../store/AppContext'
import {
  parseQuick,
  stripCategory,
  stripDuration,
  stripPriority,
} from '../lib/quickparse'
import { DAY, PRIORITY_META, formatClock, formatDurationLabel, isSameDay } from '../lib/time'
import { cn } from '../lib/cn'
import type { Priority } from '../types'
import { IconArrowRight, IconBolt, IconCheck, IconSparkles } from './Icons'

/** 带去「详细设置」的初值 */
export interface QuickDraft {
  title: string
  durationMin: number | null
  priority: Priority
  categoryId: string
}

const DURATION_CHIPS: { min: number | null; label: string }[] = [
  { min: 30, label: '30 分' },
  { min: 60, label: '1 小时' },
  { min: 120, label: '2 小时' },
  { min: 240, label: '4 小时' },
  { min: 480, label: '8 小时' },
  { min: null, label: '不计时' },
]

const PRIORITY_CHIPS: Priority[] = ['high', 'medium', 'low']

const PRIORITY_LABEL: Record<Priority, string> = { high: '高', medium: '中', low: '低' }

interface Props {
  inputRef?: React.RefObject<HTMLInputElement>
  onDetailed: (draft: QuickDraft) => void
}

function QuickAddBase({ inputRef, onDetailed }: Props) {
  const {
    categories,
    prefs,
    createTask,
    removeTask,
    pushToast,
    setFocusTaskId,
    ready,
  } = useApp()

  const localRef = useRef<HTMLInputElement>(null)
  const ref = inputRef ?? localRef

  const [text, setText] = useState('')
  const [durationMin, setDurationMin] = useState<number | null>(prefs.defaultDurationMin)
  const [priority, setPriority] = useState<Priority>('medium')
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? 'work')
  const [flash, setFlash] = useState(false)
  const [shake, setShake] = useState(false)

  // 应用启动后把焦点交给快速输入框，实现「打开即输入」
  useEffect(() => {
    if (!ready) return
    const t = window.setTimeout(() => ref.current?.focus({ preventScroll: true }), 260)
    return () => window.clearTimeout(t)
  }, [ready, ref])

  // 分类被删除时兜底
  useEffect(() => {
    if (!categories.some((c) => c.id === categoryId)) {
      setCategoryId(categories[0]?.id ?? 'work')
    }
  }, [categories, categoryId])

  const parsed = useMemo(() => parseQuick(text), [text])

  /** 文本中的标记优先于 chip 选择 */
  const effDuration = parsed.durationMin ?? durationMin
  const effPriority = parsed.priority ?? priority
  const matchedCategory = useMemo(() => {
    if (!parsed.categoryName) return null
    const key = parsed.categoryName.trim().toLowerCase()
    return (
      categories.find((c) => c.name.toLowerCase() === key) ??
      categories.find((c) => c.name.toLowerCase().includes(key) || key.includes(c.name.toLowerCase())) ??
      null
    )
  }, [parsed.categoryName, categories])
  const effCategory = matchedCategory ?? categories.find((c) => c.id === categoryId) ?? null

  const dueLabel = useMemo(() => {
    if (effDuration === null) return '不计时（随时可做）'
    const due = Date.now() + effDuration * 60_000
    const now = Date.now()
    const day = isSameDay(due, now)
      ? '今天'
      : isSameDay(due, now + DAY)
        ? '明天'
        : `${new Date(due).getMonth() + 1}月${new Date(due).getDate()}日`
    return `${formatDurationLabel(effDuration)}后到期 · ${day} ${formatClock(due)}`
  }, [effDuration])

  const hasInput = text.trim().length > 0

  function fail(message: string) {
    setShake(true)
    window.setTimeout(() => setShake(false), 400)
    pushToast({ tone: 'warn', title: message, ttl: 1000 })
  }

  function commit(openDetailed: boolean) {
    const title = parsed.title
    if (!title) {
      fail('先输入任务内容，再按回车创建')
      ref.current?.focus({ preventScroll: true })
      return
    }
    if (!effCategory) {
      fail('没有可用的分类，请先在侧边栏创建一个')
      return
    }
    if (openDetailed) {
      onDetailed({
        title,
        durationMin: effDuration,
        priority: effPriority,
        categoryId: effCategory.id,
      })
      return
    }

    const task = createTask({
      title,
      note: '',
      categoryId: effCategory.id,
      priority: effPriority,
      durationMin: effDuration,
      remindLeadMin: prefs.defaultRemindLeadMin,
    })

    setText('')
    setFlash(true)
    window.setTimeout(() => setFlash(false), 720)
    // 仅高亮新任务，不滚动页面（保持在输入框当前位置）
    setFocusTaskId(task.id)
    window.setTimeout(() => setFocusTaskId(null), 2600)

    pushToast({
      tone: 'ok',
      title: `已创建 · ${formatDurationLabel(effDuration)}`,
      body: title,
      actionLabel: '撤销',
      action: () => removeTask(task.id, { quiet: true }),
      secondaryLabel: '补充详情',
      secondaryAction: () =>
        onDetailed({
          title,
          durationMin: effDuration,
          priority: effPriority,
          categoryId: effCategory.id,
        }),
      ttl: 1000,
    })

    // 焦点留在输入框，方便连续录入；preventScroll 保证页面不跳动
    ref.current?.focus({ preventScroll: true })
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      commit(e.metaKey || e.ctrlKey)
      return
    }
    if (e.key === 'Escape' && hasInput) {
      e.preventDefault()
      setText('')
    }
  }

  return (
    <section
      className={cn(
        'quick-shell glass sheen relative overflow-hidden rounded-[22px] px-3 pb-2.5 pt-3 sm:px-4',
        flash && 'is-flash',
        shake && 'is-shake'
      )}
      aria-label="快速创建任务"
    >
      <div
        className="pointer-events-none absolute -left-16 -top-20 h-52 w-52 rounded-full blur-3xl"
        style={{ background: 'radial-gradient(circle, var(--orb-a), transparent 70%)' }}
      />

      <div className="relative flex items-center gap-2.5">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
          style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
          aria-hidden
        >
          {flash ? <IconCheck size={18} /> : <IconBolt size={18} />}
        </span>

        <input
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="输入任务内容，回车即可创建（如：写周报 1h !高 #工作）"
          aria-label="快速创建任务：输入内容后回车"
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent py-2 font-display text-[16px] font-semibold t1 placeholder:font-sans placeholder:text-[14.5px] placeholder:font-normal sm:text-[17px]"
        />

        <button
          className="btn btn-ghost hidden !min-h-[38px] !rounded-xl !px-3 text-[12.5px] sm:inline-flex"
          onClick={() => commit(true)}
          disabled={!hasInput}
          title="打开详细设置（⌘↵）"
        >
          详细
        </button>

        <button
          className="btn btn-primary !min-h-[38px] shrink-0 !rounded-xl !px-3.5 text-[13px]"
          onClick={() => commit(false)}
          disabled={!hasInput}
          title="创建任务（回车）"
        >
          <IconArrowRight size={16} />
          <span className="hidden sm:inline">创建</span>
        </button>
      </div>

      <p
        className="relative mt-1.5 flex min-h-[18px] flex-wrap items-center gap-x-2 gap-y-1 pl-[46px] text-[12.5px] t3"
        aria-live="polite"
      >
        {hasInput && parsed.title ? (
          <>
            <span className="font-semibold t2">{parsed.title}</span>
            <span aria-hidden>·</span>
            <span>{dueLabel}</span>
            {effPriority !== 'medium' && (
              <>
                <span aria-hidden>·</span>
                <span style={{ color: PRIORITY_META[effPriority].color }}>
                  {PRIORITY_LABEL[effPriority]}优先级
                </span>
              </>
            )}
            {effCategory && (
              <>
                <span aria-hidden>·</span>
                <span>{effCategory.name}</span>
              </>
            )}
          </>
        ) : (
          <span className="flex items-center gap-1.5">
            <IconSparkles size={12} />
            回车快速创建 · ⌘↵ 打开详细设置 · 支持 2h / 90分钟 / !高 / #分类
          </span>
        )}
      </p>

      <div className="relative mt-2 flex items-center gap-2 overflow-x-auto pb-0.5 pl-[46px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <ChipGroup label="时长">
          {DURATION_CHIPS.map((c) => (
            <Chip
              key={c.label}
              active={parsed.durationMin === null && durationMin === c.min}
              onClick={() => {
                setText((t) => stripDuration(t))
                setDurationMin(c.min)
              }}
            >
              {c.label}
            </Chip>
          ))}
        </ChipGroup>

        <Divider />

        <ChipGroup label="优先级">
          {PRIORITY_CHIPS.map((p) => (
            <Chip
              key={p}
              active={parsed.priority === null && priority === p}
              color={PRIORITY_META[p].color}
              onClick={() => {
                setText((t) => stripPriority(t))
                setPriority(p)
              }}
            >
              {PRIORITY_LABEL[p]}
            </Chip>
          ))}
        </ChipGroup>

        <Divider />

        <ChipGroup label="分类">
          {categories.map((c) => (
            <Chip
              key={c.id}
              active={!matchedCategory && categoryId === c.id}
              color={c.color}
              onClick={() => {
                setText((t) => stripCategory(t))
                setCategoryId(c.id)
              }}
            >
              {c.name}
            </Chip>
          ))}
        </ChipGroup>
      </div>
    </section>
  )
}

/** 快速创建区：不随每秒时钟重渲染，避免每次走时都跑一遍整块解析逻辑 */
export const QuickAdd = memo(QuickAddBase)

function ChipGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <span className="select-none text-[11px] font-bold tracking-wide t3">{label}</span>
      {children}
    </div>
  )
}

function Divider() {
  return <span className="h-4 w-px shrink-0" style={{ background: 'var(--line)' }} aria-hidden />
}

function Chip({
  active,
  color,
  onClick,
  children,
}: {
  active: boolean
  color?: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className="chip-btn"
      style={
        active
          ? {
              borderColor: color ? `${color}66` : 'color-mix(in srgb, var(--accent) 42%, transparent)',
              color: color ?? 'var(--accent)',
              background: color
                ? `color-mix(in srgb, ${color} 14%, transparent)`
                : 'var(--accent-soft)',
            }
          : undefined
      }
    >
      {active && <IconCheck size={12} />}
      {children}
    </button>
  )
}
