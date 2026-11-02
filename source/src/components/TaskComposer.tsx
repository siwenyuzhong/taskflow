import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../store/AppContext'
import { formatClock, formatDurationLabel, fromLocalInputValue, toLocalInputValue } from '../lib/time'
import { cn, uid } from '../lib/cn'
import type { Priority, Subtask, Task } from '../types'
import type { QuickDraft } from './QuickAdd'
import { IconCheck, IconClock, IconPlus, IconSparkles, IconTrash, IconX } from './Icons'

const DURATION_PRESETS = [
  { min: 15, label: '15 分' },
  { min: 30, label: '30 分' },
  { min: 60, label: '1 小时' },
  { min: 120, label: '2 小时' },
  { min: 240, label: '4 小时' },
  { min: 480, label: '8 小时' },
]

const LEAD_PRESETS = [1, 5, 10, 30, 60]

const PRIORITIES: { key: Priority; label: string; color: string }[] = [
  { key: 'low', label: '低', color: 'var(--cy)' },
  { key: 'medium', label: '中', color: 'var(--warn)' },
  { key: 'high', label: '高', color: 'var(--danger)' },
]

/** 子任务编辑行的中间态（表单里用字符串，提交时才转成 Subtask） */
interface SubDraft {
  id: string
  title: string
  timeStr: string
  durStr: string
  done: boolean
}

function subDraftFromTask(t: Task): SubDraft[] {
  return (t.subtasks ?? []).map((s) => ({
    id: s.id,
    title: s.title,
    timeStr: s.dueAt ? toLocalInputValue(s.dueAt) : '',
    durStr: s.durationMin != null ? String(s.durationMin) : '',
    done: s.done,
  }))
}

function subDraftToSubtask(d: SubDraft): Subtask {
  const durNum = Number(d.durStr)
  return {
    id: d.id,
    title: d.title.trim(),
    dueAt: d.timeStr ? fromLocalInputValue(d.timeStr) : null,
    durationMin: d.durStr.trim() && Number.isFinite(durNum) && durNum > 0 ? Math.round(durNum) : null,
    done: d.done,
  }
}

function subDraftDuration(d: SubDraft): number {
  const n = Number(d.durStr)
  return d.durStr.trim() && Number.isFinite(n) && n > 0 ? Math.max(1, Math.round(n)) : 0
}

interface Props {
  open: boolean
  editing: Task | null
  /** 从「快速创建」带过来的初值 */
  draft?: QuickDraft | null
  onClose: () => void
  /** >0 时本次由「拆分子任务」触发：自动新增一个空子任务行并滚动聚焦 */
  subtaskFocus?: number
  /** 只读模式：过去的计划/每周任务，仅查看不可修改 */
  readOnly?: boolean
}

function TaskComposerBase({ open, editing, draft, onClose, subtaskFocus = 0, readOnly = false }: Props) {
  const { categories, prefs, createTask, updateTask, addCategory, pushToast } = useApp()

  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? 'work')
  const [priority, setPriority] = useState<Priority>('medium')
  const [timed, setTimed] = useState(true)
  const [durationMin, setDurationMin] = useState(prefs.defaultDurationMin)
  const [customMode, setCustomMode] = useState(false)
  const [customValue, setCustomValue] = useState('4')
  const [customUnit, setCustomUnit] = useState<'min' | 'hour'>('hour')
  const [leadMin, setLeadMin] = useState(prefs.defaultRemindLeadMin)
  const [customLeadMode, setCustomLeadMode] = useState(false)
  const [customLeadValue, setCustomLeadValue] = useState('15')
  const [customLeadUnit, setCustomLeadUnit] = useState<'min' | 'hour'>('min')
  const [touched, setTouched] = useState(false)
  const [newCat, setNewCat] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [subs, setSubs] = useState<SubDraft[]>([])

  const titleRef = useRef<HTMLInputElement>(null)
  // categories 仅作初始兜底值读取；放入 state 会让弹窗内"新分类"重跑本 effect、清空已输入内容
  const categoriesRef = useRef(categories)
  categoriesRef.current = categories

  useEffect(() => {
    if (!open) return
    setTouched(false)
    setNewCat(false)
    setNewCatName('')
    if (editing) {
      setTitle(editing.title)
      setNote(editing.note)
      setCategoryId(editing.categoryId)
      setPriority(editing.priority)
      const editDur = editing.durationMin
      setTimed(editDur !== null)
      setDurationMin(editDur ?? prefs.defaultDurationMin)
      // 时长不在预设里（如续期后的 24 小时）时落到自定义模式，保证有高亮反馈
      if (editDur !== null && !DURATION_PRESETS.some((p) => p.min === editDur)) {
        setCustomMode(true)
        if (editDur % 60 === 0) {
          setCustomValue(String(editDur / 60))
          setCustomUnit('hour')
        } else {
          setCustomValue(String(editDur))
          setCustomUnit('min')
        }
      } else {
        setCustomMode(false)
      }
      // 提前提醒不在预设里时，同样落到自定义模式
      const editLead = editing.remindLeadMin
      setLeadMin(editLead)
      if (editLead > 0 && !LEAD_PRESETS.includes(editLead)) {
        setCustomLeadMode(true)
        if (editLead % 60 === 0) {
          setCustomLeadValue(String(editLead / 60))
          setCustomLeadUnit('hour')
        } else {
          setCustomLeadValue(String(editLead))
          setCustomLeadUnit('min')
        }
      } else {
        setCustomLeadMode(false)
      }
      setSubs(subDraftFromTask(editing))
    } else {
      const seedDur = draft ? draft.durationMin : prefs.defaultDurationMin
      setTitle(draft?.title ?? '')
      setNote('')
      setCategoryId(draft?.categoryId ?? categoriesRef.current[0]?.id ?? 'work')
      setPriority(draft?.priority ?? 'medium')
      setTimed(seedDur !== null)
      setDurationMin(seedDur ?? prefs.defaultDurationMin)
      setLeadMin(prefs.defaultRemindLeadMin)
      if (prefs.defaultRemindLeadMin > 0 && !LEAD_PRESETS.includes(prefs.defaultRemindLeadMin)) {
        setCustomLeadMode(true)
        if (prefs.defaultRemindLeadMin % 60 === 0) {
          setCustomLeadValue(String(prefs.defaultRemindLeadMin / 60))
          setCustomLeadUnit('hour')
        } else {
          setCustomLeadValue(String(prefs.defaultRemindLeadMin))
          setCustomLeadUnit('min')
        }
      } else {
        setCustomLeadMode(false)
      }
      setSubs([])
      // 时长不在预设里（如快速创建解析出的 90 分钟）时，落到自定义模式，保证有高亮反馈
      if (seedDur !== null && !DURATION_PRESETS.some((p) => p.min === seedDur)) {
        setCustomMode(true)
        if (seedDur % 60 === 0) {
          setCustomValue(String(seedDur / 60))
          setCustomUnit('hour')
        } else {
          setCustomValue(String(seedDur))
          setCustomUnit('min')
        }
      } else {
        setCustomMode(false)
        setCustomValue('4')
        setCustomUnit('hour')
      }
    }
    if (!readOnly) {
      const t = window.setTimeout(() => titleRef.current?.focus(), 60)
      return () => window.clearTimeout(t)
    }
  }, [open, editing, draft, prefs.defaultDurationMin, prefs.defaultRemindLeadMin, readOnly])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  const effectiveDuration = useMemo(() => {
    if (!timed) return null
    if (!customMode) return durationMin
    const v = Number(customValue)
    if (!Number.isFinite(v) || v <= 0) return null
    return Math.max(1, Math.round(customUnit === 'hour' ? v * 60 : v))
  }, [timed, customMode, durationMin, customValue, customUnit])

  /** 生效的提前提醒分钟数（自定义优先，非法时回落到预设值） */
  const effectiveLead = useMemo(() => {
    if (!customLeadMode) return leadMin
    const v = Number(customLeadValue)
    if (!Number.isFinite(v) || v <= 0) return leadMin
    return Math.max(1, Math.round(customLeadUnit === 'hour' ? v * 60 : v))
  }, [customLeadMode, customLeadValue, customLeadUnit, leadMin])

  // 编辑且时长未改动时，预览应展示任务真实的到期时刻（而不是"从现在重新计时"），
  // 与实际保存逻辑保持一致。
  const duePreview = effectiveDuration
    ? editing && editing.dueAt && editing.durationMin === effectiveDuration
      ? editing.dueAt
      : Date.now() + effectiveDuration * 60_000
    : null
  const duePreviewLabel = duePreview
    ? formatDurationLabel(Math.max(1, Math.round((duePreview - Date.now()) / 60_000)))
    : null

  /** 子任务时长合计 + 超限校验（仅任务设定时长时约束） */
  const subTotal = useMemo(() => subs.reduce((acc, d) => acc + subDraftDuration(d), 0), [subs])
  const budgetMin = timed && effectiveDuration != null ? effectiveDuration : null
  const overBudget = budgetMin !== null && subTotal > budgetMin
  const validSubtasks = useMemo(
    () => subs.filter((d) => d.title.trim()).map(subDraftToSubtask),
    [subs]
  )

  const titleRefs = useRef(new Map<string, HTMLInputElement | null>())
  const subtaskBlockRef = useRef<HTMLDivElement>(null)
  const patchSub = (id: string, patch: Partial<SubDraft>) =>
    setSubs((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  const addSub = () => {
    const id = uid('sub')
    setSubs((prev) => [...prev, { id, title: '', timeStr: '', durStr: '', done: false }])
    window.setTimeout(() => titleRefs.current.get(id)?.focus(), 30)
  }
  const removeSub = (id: string) => setSubs((prev) => prev.filter((s) => s.id !== id))

  /** 「拆分子任务」触发：打开后自动新增一个空子任务行，并滚动到子任务区域 */
  useEffect(() => {
    if (!open || subtaskFocus <= 0) return
    const t = window.setTimeout(() => {
      addSub()
      subtaskBlockRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 160)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, subtaskFocus])

  function submit() {
    if (readOnly) {
      onClose()
      return
    }
    if (!title.trim()) {
      setTouched(true)
      titleRef.current?.focus()
      return
    }
    if (overBudget) return
    if (editing) {
      const dur = effectiveDuration
      const prevDur = editing.durationMin
      // 默认保留原有到期时间与计时起点；只有改动时长时才按差额平移。
      // 否则「编辑一下」就会把续期累加出来的剩余时长清零。
      let dueAt = editing.dueAt
      let cycleStartAt = editing.cycleStartAt
      if (dur !== prevDur) {
        if (dur === null) {
          dueAt = null
          cycleStartAt = null
        } else if (editing.dueAt && prevDur !== null) {
          dueAt = editing.dueAt + (dur - prevDur) * 60_000
        } else {
          const created = Date.now()
          dueAt = created + dur * 60_000
          cycleStartAt = created
        }
      }
      updateTask(editing.id, {
        title: title.trim(),
        note: note.trim(),
        categoryId,
        priority,
        durationMin: dur,
        remindLeadMin: effectiveLead,
        dueAt,
        cycleStartAt,
        remindedAt: null,
        expiredNotifiedAt: null,
        subtasks: validSubtasks,
      })
      pushToast({ tone: 'info', title: '已保存修改', body: title.trim(), ttl: 1000 })
    } else {
      createTask({
        title,
        note,
        categoryId,
        priority,
        durationMin: effectiveDuration,
        remindLeadMin: effectiveLead,
        subtasks: validSubtasks,
      })
      pushToast({
        tone: 'ok',
        title: '任务已创建',
        body: effectiveDuration
          ? `${title.trim()} · ${formatDurationLabel(effectiveDuration)}后到期`
          : title.trim(),
        ttl: 1000,
      })
    }
    onClose()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center p-0 sm:items-center sm:p-6">
      <button
        aria-label="关闭"
        className="fixed inset-0 bg-black/60 backdrop-blur-md"
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={readOnly ? '任务详情' : editing ? '编辑任务' : '新建任务'}
        className="glass animate-pop-in relative z-10 flex max-h-[90vh] w-full max-w-[580px] flex-col overflow-hidden rounded-t-[26px] border-line shadow-lift sm:max-h-[min(86vh,860px)] sm:rounded-[26px]"
        style={{ background: 'color-mix(in srgb, var(--ink-800) 92%, transparent)' }}
      >
        <div
          className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full blur-3xl"
          style={{ background: 'radial-gradient(circle, var(--orb-a), transparent 70%)' }}
        />

        {/* 固定头部：内容再长也不会把标题顶出视口 */}
        <div className="relative flex shrink-0 items-start justify-between gap-4 border-b border-line px-5 pb-4 pt-5 sm:px-6 sm:pt-6">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h2 className="font-display text-[21px] font-bold t1">
                {readOnly ? '任务详情' : editing ? '编辑任务' : '新建任务'}
              </h2>
              {readOnly && (
                <span
                  className="rounded-full px-2 py-[2px] text-[11px] font-bold"
                  style={{ background: 'rgba(245,165,36,0.16)', color: 'var(--warn)' }}
                >
                  只读
                </span>
              )}
            </div>
            <p className="mt-1 text-[13px] t2">
              {readOnly
                ? editing?.status === 'completed'
                  ? '已完成的任务：只可查看，不可修改。'
                  : '已过去的日期：只可查看，不可修改。'
                : '设定时长后，从创建那一刻开始计时，到点前会提醒你「即将到期」。'}
            </p>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="关闭">
            <IconX size={18} />
          </button>
        </div>

        {/* 主体：独立滚动，头部与底部按钮始终固定 */}
        <div className="relative min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
          <div>
            <Label>任务名称</Label>
            <input
              ref={titleRef}
              className="field"
              placeholder="例如：完成需求评审"
              value={title}
              readOnly={readOnly}
              aria-invalid={touched && !title.trim()}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
              }}
              style={
                touched && !title.trim()
                  ? { borderColor: 'var(--danger)', boxShadow: '0 0 0 3px rgba(255,92,122,0.14)' }
                  : undefined
              }
            />
            {touched && !title.trim() && (
              <p className="mt-1.5 text-[12.5px] font-semibold" style={{ color: 'var(--danger)' }}>
                请填写任务名称
              </p>
            )}
          </div>

          <div>
            <Label>备注（可选）</Label>
            <textarea
              className="field min-h-[76px] resize-none"
              placeholder="补充说明、验收标准…"
              value={note}
              readOnly={readOnly}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div>
            <Label>分类</Label>
            <div className="flex flex-wrap gap-2">
              {categories.map((c) => {
                const on = c.id === categoryId
                return (
                  <button
                    key={c.id}
                    onClick={() => setCategoryId(c.id)}
                    disabled={readOnly}
                    aria-pressed={on}
                    className={cn(
                      'inline-flex min-h-[38px] items-center gap-2 rounded-xl border px-3 text-[13.5px] font-semibold transition-all disabled:cursor-default disabled:opacity-70',
                      on ? 't1' : 't2 hover:t1'
                    )}
                    style={{
                      borderColor: on ? c.color : 'var(--line)',
                      background: on ? `${c.color}22` : 'var(--surface)',
                    }}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />
                    {c.name}
                  </button>
                )
              })}
              {newCat ? (
                <span className="inline-flex items-center gap-1.5">
                  <input
                    autoFocus
                    disabled={readOnly}
                    className="field !min-h-[38px] w-[110px] !py-1 text-[13px]"
                    placeholder="分类名"
                    value={newCatName}
                    onChange={(e) => setNewCatName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newCatName.trim()) {
                        addCategory(newCatName, '#a78bfa')
                        setNewCatName('')
                        setNewCat(false)
                      }
                      if (e.key === 'Escape') setNewCat(false)
                    }}
                  />
                  <button
                    className="btn btn-primary !min-h-[38px] !rounded-xl !px-3 text-[13px]"
                    onClick={() => {
                      if (!newCatName.trim()) return
                      addCategory(newCatName, '#a78bfa')
                      setNewCatName('')
                      setNewCat(false)
                    }}
                  >
                    添加
                  </button>
                </span>
              ) : !readOnly ? (
                <button
                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-dashed border-line px-3 text-[13.5px] font-semibold t3 transition-colors hover:t1"
                  onClick={() => setNewCat(true)}
                >
                  <IconPlus size={14} />
                  新分类
                </button>
              ) : null}
            </div>
          </div>

          {/* 定时 */}
          <div className="rounded-2xl border border-line p-3.5" style={{ background: 'var(--surface)' }}>
            <div className="flex items-center justify-between gap-3">
              <Label noMargin>
                <IconClock size={13} className="mr-1 inline align-[-2px]" />
                任务时长
              </Label>
              <button
                role="switch"
                aria-checked={timed}
                disabled={readOnly}
                aria-label="任务时长开关"
                onClick={() => setTimed((t) => !t)}
                className={cn(
                  'relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 disabled:cursor-default disabled:opacity-70'
                )}
                style={{ background: timed ? 'var(--accent)' : 'var(--surface-2)', border: '1px solid var(--line)' }}
              >
                <span
                  className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-white shadow transition-all duration-200"
                  style={{ left: timed ? 24 : 3 }}
                />
              </button>
            </div>

            {timed && (
              <>
                <div className="mt-3 flex flex-wrap gap-2">
                  {DURATION_PRESETS.map((p) => {
                    const on = !customMode && durationMin === p.min
                    return (
                      <button
                        key={p.min}
                        onClick={() => {
                          setCustomMode(false)
                          setDurationMin(p.min)
                        }}
                        disabled={readOnly}
                        aria-pressed={on}
                        className={cn(
                          'min-h-[40px] rounded-xl border px-3.5 text-[13.5px] font-semibold transition-all disabled:cursor-default disabled:opacity-70',
                          on ? 't1' : 't2 hover:t1'
                        )}
                        style={{
                          borderColor: on ? 'var(--accent)' : 'var(--line)',
                          background: on ? 'var(--accent-soft)' : 'transparent',
                        }}
                      >
                        {p.label}
                      </button>
                    )
                  })}
                  <button
                    onClick={() => setCustomMode(true)}
                    disabled={readOnly}
                    aria-pressed={customMode}
                    className={cn(
                      'min-h-[40px] rounded-xl border px-3.5 text-[13.5px] font-semibold transition-all disabled:cursor-default disabled:opacity-70',
                      customMode ? 't1' : 't2 hover:t1'
                    )}
                    style={{
                      borderColor: customMode ? 'var(--accent)' : 'var(--line)',
                      background: customMode ? 'var(--accent-soft)' : 'transparent',
                    }}
                  >
                    自定义
                  </button>
                </div>

                {customMode && (
                  <div className="animate-fade-up mt-3 flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      readOnly={readOnly}
                      className="field !min-h-[40px] w-[110px] text-center"
                      value={customValue}
                      onChange={(e) => setCustomValue(e.target.value)}
                    />
                    <div className="flex overflow-hidden rounded-xl border border-line">
                      {(['min', 'hour'] as const).map((u) => (
                        <button
                          key={u}
                          onClick={() => setCustomUnit(u)}
                          disabled={readOnly}
                          className={cn('min-h-[40px] px-3.5 text-[13.5px] font-semibold transition-colors disabled:cursor-default disabled:opacity-70', customUnit === u ? 't1' : 't2')}
                          style={{ background: customUnit === u ? 'var(--accent-soft)' : 'transparent' }}
                        >
                          {u === 'min' ? '分钟' : '小时'}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {timed && effectiveDuration && duePreview && (
              <div
                className="mt-3.5 flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-semibold"
                style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
              >
                <IconSparkles size={14} />
                将在 {formatClock(duePreview)} 到期（{duePreviewLabel} 后）
              </div>
            )}
            {!timed && (
              <p className="mt-3 text-[12.5px] t3">未设定时长，任务不会触发到期提醒，可随时补设。</p>
            )}
          </div>

          {/* 提前提醒：独立成卡片，避免与"任务时长"混在同一区域产生歧义 */}
          {timed && (
            <div className="rounded-2xl border border-line p-3.5" style={{ background: 'var(--surface)' }}>
              <Label>提前提醒</Label>
              <div className="flex flex-wrap gap-2">
                {LEAD_PRESETS.map((l) => {
                  const on = !customLeadMode && leadMin === l
                  return (
                    <button
                      key={l}
                      onClick={() => {
                        setCustomLeadMode(false)
                        setLeadMin(l)
                      }}
                      disabled={readOnly}
                      aria-pressed={on}
                      className={cn(
                        'min-h-[40px] rounded-xl border px-3.5 text-[13.5px] font-semibold transition-all disabled:cursor-default disabled:opacity-70',
                        on ? 't1' : 't2 hover:t1'
                      )}
                      style={{
                        borderColor: on ? 'var(--warn)' : 'var(--line)',
                        background: on ? 'rgba(245,165,36,0.14)' : 'transparent',
                      }}
                    >
                      {l >= 60 ? `${l / 60} 小时` : `${l} 分钟`}
                    </button>
                  )
                })}
                <button
                  onClick={() => setCustomLeadMode(true)}
                  disabled={readOnly}
                  aria-pressed={customLeadMode}
                  className={cn(
                    'min-h-[40px] rounded-xl border px-3.5 text-[13.5px] font-semibold transition-all disabled:cursor-default disabled:opacity-70',
                    customLeadMode ? 't1' : 't2 hover:t1'
                  )}
                  style={{
                    borderColor: customLeadMode ? 'var(--warn)' : 'var(--line)',
                    background: customLeadMode ? 'rgba(245,165,36,0.14)' : 'transparent',
                  }}
                >
                  自定义
                </button>
              </div>

              {customLeadMode && (
                <div className="animate-fade-up mt-3 flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    readOnly={readOnly}
                    className="field !min-h-[40px] w-[110px] text-center"
                    value={customLeadValue}
                    onChange={(e) => setCustomLeadValue(e.target.value)}
                  />
                  <div className="flex overflow-hidden rounded-xl border border-line">
                    {(['min', 'hour'] as const).map((u) => (
                      <button
                        key={u}
                        onClick={() => setCustomLeadUnit(u)}
                        disabled={readOnly}
                        className={cn('min-h-[40px] px-3.5 text-[13.5px] font-semibold transition-colors disabled:cursor-default disabled:opacity-70', customLeadUnit === u ? 't1' : 't2')}
                        style={{ background: customLeadUnit === u ? 'rgba(245,165,36,0.14)' : 'transparent' }}
                      >
                        {u === 'min' ? '分钟' : '小时'}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <p className="mt-2.5 text-[12.5px] t3">
                到期前 {formatDurationLabel(effectiveLead)} 提醒你「即将到期」。
              </p>
            </div>
          )}

          {/* 子任务 */}
          <div
            ref={subtaskBlockRef}
            className="scroll-mt-4 rounded-2xl border border-line p-3.5"
            style={{ background: 'var(--surface)' }}
          >
            <div className="flex items-center justify-between gap-3">
              <Label noMargin>子任务（{subs.length}）</Label>
              {!readOnly && (
                <button
                  className="btn btn-ghost !min-h-[32px] !rounded-xl !px-3 text-[12.5px]"
                  onClick={addSub}
                >
                  <IconPlus size={14} />
                  添加子任务
                </button>
              )}
            </div>

            {subs.length === 0 ? (
              <p className="mt-2.5 text-[12.5px] leading-relaxed t3">
                可把大任务拆成多个子任务，每个子任务单独设定时长与日期时间；
                所有子任务的总时长不能超过任务总时长。
              </p>
            ) : (
              <div className="mt-2.5 max-h-[300px] space-y-2.5 overflow-y-auto pr-1">
                {subs.map((s) => (
                  <div
                    key={s.id}
                    className="rounded-xl border border-line p-2.5"
                    style={{ background: 'color-mix(in srgb, var(--ink-900) 45%, transparent)' }}
                  >
                    <div className="flex items-center gap-2">
                      <button
                        role="checkbox"
                        aria-checked={s.done}
                        aria-label={s.done ? '标记为未完成' : '标记为已完成'}
                        onClick={() => patchSub(s.id, { done: !s.done })}
                        disabled={readOnly}
                        className={cn(
                          'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border transition-all disabled:cursor-default',
                          s.done ? 'border-transparent' : 'border-line hover:border-[var(--ok)]'
                        )}
                        style={s.done ? { background: 'var(--ok)', color: 'white', opacity: readOnly ? 0.7 : 1 } : undefined}
                      >
                        {s.done && <IconCheck size={13} />}
                      </button>
                      <input
                        ref={(el) => titleRefs.current.set(s.id, el)}
                        readOnly={readOnly}
                        className="field min-w-0 flex-1 !min-h-[36px] !py-1.5 text-[13px]"
                        placeholder="子任务名称"
                        value={s.title}
                        onChange={(e) => patchSub(s.id, { title: e.target.value })}
                      />
                      {!readOnly && (
                        <button
                          className="btn-icon !min-h-[30px] !min-w-[30px] hover:!text-[var(--danger)]"
                          onClick={() => removeSub(s.id)}
                          aria-label="删除这个子任务"
                        >
                          <IconTrash size={14} />
                        </button>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 pl-[26px]">
                      <input
                        type="number"
                        min={1}
                        readOnly={readOnly}
                        className="field !min-h-[34px] !w-[120px] !px-2.5 text-[12.5px]"
                        placeholder="耗时（分钟）"
                        value={s.durStr}
                        onChange={(e) => patchSub(s.id, { durStr: e.target.value })}
                      />
                      <input
                        type="datetime-local"
                        readOnly={readOnly}
                        className="field !min-h-[34px] !px-2.5 text-[12.5px]"
                        value={s.timeStr}
                        onChange={(e) => patchSub(s.id, { timeStr: e.target.value })}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {subs.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] font-semibold">
                {budgetMin !== null ? (
                  overBudget ? (
                    <span style={{ color: 'var(--danger)' }}>
                      子任务总时长 {formatDurationLabel(subTotal)} 已超过任务总时长{' '}
                      {formatDurationLabel(budgetMin)}，请删减或缩短子任务
                    </span>
                  ) : (
                    <span className="t2">
                      <span style={{ color: 'var(--ok)' }}>已分配 {formatDurationLabel(subTotal)}</span>
                      <span className="t3"> / 总时长 {formatDurationLabel(budgetMin)}，剩</span>{' '}
                      {formatDurationLabel(budgetMin - subTotal)}
                    </span>
                  )
                ) : (
                  <span className="t3">子任务总时长 {formatDurationLabel(subTotal)}（未设任务时长则不限制）</span>
                )}
              </div>
            )}
          </div>

          <div>
            <Label>优先级</Label>
            <div className="flex gap-2">
              {PRIORITIES.map((p) => {
                const on = priority === p.key
                return (
                  <button
                    key={p.key}
                    onClick={() => setPriority(p.key)}
                    disabled={readOnly}
                    aria-pressed={on}
                    className={cn(
                      'min-h-[40px] flex-1 rounded-xl border text-[13.5px] font-semibold transition-all disabled:cursor-default disabled:opacity-70',
                      on ? 't1' : 't3 hover:t2'
                    )}
                    style={{
                      borderColor: on ? p.color : 'var(--line)',
                      background: on ? `${p.color}22` : 'transparent',
                    }}
                  >
                    {p.label}优先级
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* 固定底部操作区 */}
        <div className="relative flex shrink-0 items-center justify-end gap-2.5 border-t border-line px-5 py-4 sm:px-6">
          {readOnly ? (
            <button className="btn btn-primary !px-5" onClick={onClose}>
              关闭
            </button>
          ) : (
            <>
              <button className="btn btn-ghost" onClick={onClose}>
                取消
              </button>
              <button className="btn btn-primary !px-5" onClick={submit} disabled={overBudget}>
                {editing ? '保存修改' : '创建任务'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** 弹窗常驻挂载但不打开时，降低每秒时钟触发的无谓重渲染 */
export const TaskComposer = memo(TaskComposerBase)

function Label({ children, noMargin }: { children: React.ReactNode; noMargin?: boolean }) {
  return (
    <p
      className={cn(
        'text-[12px] font-bold uppercase tracking-[0.1em] t3',
        noMargin ? '' : 'mb-2'
      )}
    >
      {children}
    </p>
  )
}
