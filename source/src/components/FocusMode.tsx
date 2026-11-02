import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../store/AppContext'
import { MINUTE, formatDateTime, splitCountdown } from '../lib/time'
import { playChime } from '../lib/sound'
import { cn } from '../lib/cn'
import { bridge } from '../lib/bridge'
import type { Task } from '../types'
import {
  IconCheck,
  IconClock,
  IconLayers,
  IconPause,
  IconPlay,
  IconTarget,
  IconX,
} from './Icons'

type Stage = 'ready' | 'running' | 'paused' | 'done'

const PRESETS = [25, 45, 60]

export function FocusMode({
  task,
  onExit,
}: {
  task: Task
  onExit: () => void
}) {
  const { categoryById, completeTask, toggleSubtask, prefs } = useApp()
  const category = categoryById(task.categoryId)
  /** macOS 左上角红绿灯是原生窗口控件，悬浮在所有内容之上，标题需右移避开 */
  const isMac = bridge.platform === 'darwin'

  const taskMin = task.durationMin && task.durationMin > 0 ? Math.round(task.durationMin) : 25
  const [totalMs, setTotalMs] = useState(taskMin * MINUTE)
  const [remaining, setRemaining] = useState(taskMin * MINUTE)
  const [stage, setStage] = useState<Stage>('ready')
  const endAtRef = useRef(0)

  // 进入专注：锁定背景滚动
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  // Esc 退出
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onExit])

  // 走时
  useEffect(() => {
    if (stage !== 'running') return
    const tick = () => {
      const left = Math.max(0, endAtRef.current - Date.now())
      setRemaining(left)
      if (left <= 0) {
        setStage('done')
        if (prefs.sound) playChime('overdue', true)
      }
    }
    tick()
    const id = window.setInterval(tick, 250)
    return () => window.clearInterval(id)
  }, [stage, prefs.sound])

  const progress = totalMs > 0 ? Math.max(0, Math.min(1, remaining / totalMs)) : 0
  const radius = 118
  const circ = 2 * Math.PI * radius
  const dash = circ * progress

  const subs = task.subtasks ?? []
  const subsDone = subs.filter((s) => s.done).length

  const ringColor = stage === 'done' ? 'var(--ok)' : stage === 'paused' ? 'var(--warn)' : 'var(--cy)'

  function start(ms: number) {
    setTotalMs(ms)
    setRemaining(ms)
    endAtRef.current = Date.now() + ms
    setStage('running')
  }

  function togglePause() {
    if (stage === 'running') {
      setStage('paused')
    } else if (stage === 'paused') {
      endAtRef.current = Date.now() + remaining
      setStage('running')
    }
  }

  function addFive() {
    const extra = 5 * MINUTE
    setTotalMs((t) => t + extra)
    setRemaining((r) => r + extra)
    if (stage === 'running') endAtRef.current += extra
    if (stage === 'done') {
      endAtRef.current = Date.now() + extra
      setRemaining(extra)
      setTotalMs(extra)
      setStage('running')
    }
  }

  function finish() {
    completeTask(task.id)
    onExit()
  }

  const presets = useMemo(() => {
    const set = new Set<number>([taskMin, ...PRESETS])
    return [...set].sort((a, b) => a - b)
  }, [taskMin])

  const subClock = splitCountdown(remaining)

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col overflow-hidden"
      style={{
        background:
          'radial-gradient(circle at 50% 0%, color-mix(in srgb, var(--accent) 22%, var(--ink-950)) 0%, var(--ink-950) 55%)',
      }}
    >
      {/* 顶部 */}
      <header
        className={cn(
          'flex shrink-0 items-center justify-between py-4 pr-5 sm:pr-8',
          isMac ? 'pl-[88px]' : 'pl-5 sm:pl-8'
        )}
      >
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-xl"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
          >
            <IconTarget size={18} />
          </span>
          <div className="leading-tight">
            <p className="text-[13px] font-bold t1">专注模式</p>
            <p className="text-[11.5px] t3">暂时只做这一件事</p>
          </div>
        </div>
        <button className="btn btn-ghost !min-h-[40px] !rounded-[13px]" onClick={onExit}>
          <IconX size={16} />
          退出专注
        </button>
      </header>

      {/* 主体 */}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 overflow-y-auto px-5 pb-8">
        <div className="max-w-[560px] text-center">
          <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold t2">
            <span className="h-2 w-2 rounded-full" style={{ background: category.color }} />
            {category.name}
          </span>
          <h1 className="mt-2 break-words font-display text-[26px] font-bold leading-snug t1 sm:text-[32px]">
            {task.title}
          </h1>
          {task.note && <p className="mt-2 text-[14px] leading-relaxed t2">{task.note}</p>}
          {task.planned && task.dueAt !== null && (
            <p className="mt-1.5 inline-flex items-center gap-1 text-[12.5px] t3">
              <IconClock size={13} />
              {formatDateTime(task.dueAt)}
            </p>
          )}
        </div>

        {/* 计时环 */}
        <div className="relative flex h-[280px] w-[280px] items-center justify-center">
          <svg width={280} height={280} viewBox="0 0 280 280" className="-rotate-90">
            <circle cx={140} cy={140} r={radius} fill="none" stroke="var(--surface-2)" strokeWidth={12} />
            <circle
              cx={140}
              cy={140}
              r={radius}
              fill="none"
              stroke={ringColor}
              strokeWidth={12}
              strokeLinecap="round"
              strokeDasharray={circ}
              strokeDashoffset={circ - dash}
              style={{ transition: 'stroke-dashoffset 0.3s linear, stroke 0.4s ease' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {stage === 'done' ? (
              <>
                <span className="text-[44px]">🎉</span>
                <p className="mt-1 font-display text-[20px] font-bold" style={{ color: 'var(--ok)' }}>
                  时间到
                </p>
              </>
            ) : (
              <>
                {subClock.days > 0 && (
                  <span
                    className="tnum font-mono text-[24px] font-bold leading-none t2"
                    style={{ letterSpacing: '0.02em' }}
                  >
                    {subClock.days}天
                  </span>
                )}
                <span
                  className="tnum font-mono font-bold leading-none t1"
                  style={{ letterSpacing: '0.02em', fontSize: subClock.clock.length > 5 ? 42 : 54 }}
                >
                  {subClock.clock}
                </span>
                <span className="mt-2 text-[12.5px] font-semibold t3">
                  {stage === 'running' ? '专注中…' : stage === 'paused' ? '已暂停' : '准备开始'}
                </span>
              </>
            )}
          </div>
        </div>

        {/* 控制区 */}
        {stage === 'ready' && (
          <div className="flex flex-col items-center gap-4">
            <div className="flex flex-wrap items-center justify-center gap-2">
              {presets.map((m) => (
                <button
                  key={m}
                  className={cn('chip-btn', totalMs === m * MINUTE && 'chip-btn-on')}
                  onClick={() => {
                    setTotalMs(m * MINUTE)
                    setRemaining(m * MINUTE)
                  }}
                >
                  {m === taskMin ? `任务时长 ${m} 分钟` : `${m} 分钟`}
                </button>
              ))}
            </div>
            <button
              className="btn btn-primary !min-h-[54px] !rounded-[18px] !px-10 text-[16px]"
              onClick={() => start(totalMs)}
            >
              <IconPlay size={20} />
              开始专注
            </button>
          </div>
        )}

        {(stage === 'running' || stage === 'paused') && (
          <div className="flex flex-wrap items-center justify-center gap-2.5">
            <button className="btn btn-ghost !min-h-[48px] !rounded-[15px]" onClick={togglePause}>
              {stage === 'running' ? <IconPause size={17} /> : <IconPlay size={17} />}
              {stage === 'running' ? '暂停' : '继续'}
            </button>
            <button className="btn btn-ghost !min-h-[48px] !rounded-[15px]" onClick={addFive}>
              +5 分钟
            </button>
            <button className="btn btn-primary !min-h-[48px] !rounded-[15px]" onClick={finish}>
              <IconCheck size={17} />
              完成任务
            </button>
          </div>
        )}

        {stage === 'done' && (
          <div className="flex flex-wrap items-center justify-center gap-2.5">
            <button className="btn btn-primary !min-h-[48px] !rounded-[15px]" onClick={finish}>
              <IconCheck size={17} />
              完成任务
            </button>
            <button className="btn btn-ghost !min-h-[48px] !rounded-[15px]" onClick={addFive}>
              再来 5 分钟
            </button>
            <button className="btn btn-ghost !min-h-[48px] !rounded-[15px]" onClick={onExit}>
              退出
            </button>
          </div>
        )}

        {/* 子任务 */}
        {subs.length > 0 && (
          <div className="w-full max-w-[560px] rounded-[20px] border border-line p-4" style={{ background: 'var(--surface)' }}>
            <div className="mb-2 flex items-center gap-2 text-[13px] font-bold t2">
              <IconLayers size={15} />
              子任务
              <span className="tnum ml-auto t3">
                {subsDone} / {subs.length}
              </span>
            </div>
            <div className="max-h-[240px] space-y-1.5 overflow-y-auto pr-1">
              {subs.map((s) => (
                <button
                  key={s.id}
                  onClick={() => toggleSubtask(task.id, s.id)}
                  className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-surface2"
                >
                  <span
                    className={cn(
                      'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px] border transition-all',
                      s.done ? 'border-transparent' : 'border-line'
                    )}
                    style={s.done ? { background: 'var(--ok)', color: '#fff' } : undefined}
                  >
                    {s.done && <IconCheck size={13} />}
                  </span>
                  <span className={cn('flex-1 text-[14px]', s.done ? 't3 line-through' : 't1')}>
                    {s.title}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
