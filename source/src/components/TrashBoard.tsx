import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../store/AppContext'
import { formatDateTime, formatRelative } from '../lib/time'
import { shatterElement, shatterScreen, prefersReducedMotion } from '../lib/shatter'
import { cn } from '../lib/cn'
import type { Task } from '../types'
import { IconCheckCircle, IconInbox, IconTrash } from './Icons'

interface Props {
  now: number
  query: string
}

/**
 * 回收站：已完成的任务被删除后先落到这里。
 * 在这里点「彻底删除」才是真的删除（带碎片飘散动效），且不支持恢复。
 */
export function TrashBoard({ now, query }: Props) {
  const { tasks, emptyTrash } = useApp()
  const [confirming, setConfirming] = useState(false)
  const confirmTimer = useRef(0)

  const trashed = useMemo(
    () =>
      tasks
        .filter((t) => t.trashedAt)
        .sort((a, b) => (b.trashedAt as number) - (a.trashedAt as number)),
    [tasks]
  )

  const q = query.trim().toLowerCase()
  const list = useMemo(
    () =>
      q
        ? trashed.filter(
            (t) => t.title.toLowerCase().includes(q) || t.note.toLowerCase().includes(q)
          )
        : trashed,
    [trashed, q]
  )

  useEffect(() => () => window.clearTimeout(confirmTimer.current), [])

  // 二次确认：避免误触把回收站一次清空（不可恢复）
  function handleEmptyAll() {
    if (!trashed.length) return
    window.clearTimeout(confirmTimer.current)
    if (confirming) {
      setConfirming(false)
      if (!prefersReducedMotion()) shatterScreen() // 碎片铺满整个应用页面，再慢慢消失
      emptyTrash()
      return
    }
    setConfirming(true)
    confirmTimer.current = window.setTimeout(() => setConfirming(false), 4500)
  }

  return (
    <section className="animate-fade-up space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <h2 className="font-display text-[19px] font-bold t1">回收站</h2>
          <span className="tnum text-[13px] font-semibold t3">
            {trashed.length} 个已删除任务
            {q && list.length !== trashed.length && ` · 匹配 ${list.length} 个`}
          </span>
        </div>

        {trashed.length > 0 && (
          <button
            className={cn(
              'btn !min-h-[38px] !rounded-xl text-[13px]',
              confirming ? 'btn-primary' : 'btn-ghost hover:!text-[var(--danger)]'
            )}
            style={confirming ? { background: 'var(--danger)', boxShadow: '0 14px 34px -16px rgba(255,92,122,.6)' } : undefined}
            onClick={handleEmptyAll}
          >
            <IconTrash size={15} />
            {confirming ? `再点一次彻底清空（${trashed.length}）` : '清空回收站'}
          </button>
        )}
      </div>

      <p className="flex items-start gap-1.5 text-[12.5px] leading-relaxed t3">
        <IconInbox size={14} className="mt-[3px] shrink-0" />
        <span>
          已完成的任务点「删除」后会先送到这里；在回收站里删除将<b className="font-bold t2">永久移除</b>，
          碎片飘散后即消失，不支持恢复。
        </span>
      </p>

      {list.length === 0 ? (
        <div className="glass animate-fade-up flex flex-col items-center justify-center rounded-[24px] px-6 py-16 text-center">
          <span
            className="flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{ background: 'rgba(255,92,122,0.12)', color: 'var(--danger)' }}
          >
            <IconTrash size={24} />
          </span>
          <h3 className="mt-4 font-display text-[19px] font-bold t1">
            {q ? '回收站里没有匹配的任务' : '回收站是空的'}
          </h3>
          <p className="mt-1.5 max-w-sm text-[14px] t2">
            {q
              ? `没有找到包含「${query.trim()}」的已删除任务。`
              : '已完成的任务被删除后，会先出现在这里。'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-2 2xl:grid-cols-3">
          {list.map((t, i) => (
            <TrashCard key={t.id} task={t} now={now} index={i} />
          ))}
        </div>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ 回收站卡片 */

function TrashCard({ task, now, index }: { task: Task; now: number; index: number }) {
  const { categoryById, purgeTask } = useApp()
  const [shattering, setShattering] = useState(false)
  const cardRef = useRef<HTMLElement>(null)
  const purgeTimer = useRef(0)

  const category = categoryById(task.categoryId)
  const trashedAt = task.trashedAt as number

  useEffect(() => () => window.clearTimeout(purgeTimer.current), [])

  /** 彻底删除：先让卡片碎成碎片飘散，再真正移除数据 */
  function handlePurge() {
    const el = cardRef.current
    if (!el || prefersReducedMotion()) {
      purgeTask(task.id)
      return
    }
    setShattering(true) // 原卡片立刻隐形（保留占位，避免列表瞬间塌陷）
    shatterElement(el)
    // 碎片要飘 2 秒左右：占位先留着，1.45s 后列表再收拢
    purgeTimer.current = window.setTimeout(() => purgeTask(task.id), 1450)
  }

  return (
    <div className="relative">
      <article
        ref={cardRef}
        data-task-id={task.id}
        data-trashed="1"
        style={{
          animationDelay: `${Math.min(index, 8) * 45}ms`,
          // 碎片接管视觉：立刻隐藏原卡片（transition-all 会让 visibility 滞后 300ms，
          // 所以这里同时把过渡关掉），但保留占位避免列表瞬间塌陷
          ...(shattering ? { visibility: 'hidden' as const, transition: 'none', pointerEvents: 'none' as const } : null),
        }}
        className={cn(
          'glass sheen group relative animate-fade-up overflow-hidden rounded-[22px] p-4 transition-all duration-300',
          'hover:-translate-y-0.5 hover:border-[color-mix(in_srgb,var(--danger)_32%,transparent)]'
        )}
      >
        {/* 左侧条：回收站里的任务统一用危险色，弱化表示已删除 */}
        <span
          className="absolute inset-y-3 left-0 w-[3px] rounded-full"
          style={{ background: 'var(--danger)', opacity: 0.32 }}
        />

        <div className="flex items-start gap-3 pl-2.5">
          <span
            className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-line"
            style={{ background: 'var(--surface)', color: 'var(--danger)', opacity: 0.85 }}
          >
            <IconTrash size={18} />
          </span>

          <div className="min-w-0 flex-1">
            <h3 className="break-words font-display text-[16px] font-semibold leading-snug t3 line-through decoration-1">
              {task.title}
            </h3>

            {task.note && (
              <p className="mt-1 line-clamp-1 text-[13px] t3">{task.note}</p>
            )}

            <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[12.5px]">
              <span className="inline-flex items-center gap-1.5 t2">
                <span className="h-2 w-2 rounded-full" style={{ background: category.color }} />
                {category.name}
              </span>
              {task.completedAt && (
                <>
                  <span className="t3">·</span>
                  <span className="inline-flex items-center gap-1 t3">
                    <IconCheckCircle size={12} />
                    {formatDateTime(task.completedAt)} 完成
                  </span>
                </>
              )}
              <span className="t3">·</span>
              <span className="t3">{formatRelative(trashedAt, now)}移入</span>
            </div>
          </div>
        </div>

        <div className="mt-3.5 flex items-center justify-between gap-2 pl-2.5">
          <span
            className="chip"
            style={{ background: 'rgba(255,92,122,0.12)', color: 'var(--danger)' }}
          >
            已删除
          </span>
          <button
            className="btn btn-ghost !min-h-[40px] !rounded-xl !px-3.5 text-[13.5px] hover:!border-[color-mix(in_srgb,var(--danger)_45%,transparent)] hover:!text-[var(--danger)]"
            onClick={handlePurge}
            data-action="purge"
            title="永久删除，无法恢复"
          >
            <IconTrash size={15} />
            彻底删除
          </button>
        </div>
      </article>
    </div>
  )
}
