import { useEffect, useMemo, useState } from 'react'
import { useApp, useNow } from '../store/AppContext'
import { dayKey, urgencyOf } from '../lib/time'
import { cn } from '../lib/cn'
import { bridge } from '../lib/bridge'
import type { ViewKey } from '../types'
import {
  IconBell,
  IconBolt,
  IconCalendar,
  IconCalendarWeek,
  IconCheckCircle,
  IconFlame,
  IconInbox,
  IconMic,
  IconMoon,
  IconNote,
  IconPencil,
  IconPlus,
  IconRepeat,
  IconSun,
  IconTable,
  IconTrash,
  IconVolume,
  IconVolumeOff,
  IconX,
} from './Icons'

const NAV_META: Record<ViewKey, { label: string; icon: typeof IconInbox }> = {
  all: { label: '全部任务', icon: IconInbox },
  active: { label: '进行中', icon: IconBolt },
  soon: { label: '即将到期', icon: IconFlame },
  done: { label: '已完成', icon: IconCheckCircle },
  week: { label: '每周任务', icon: IconCalendarWeek },
  plan: { label: '未来计划', icon: IconCalendar },
  sheets: { label: '工作清单', icon: IconTable },
  speedrec: { label: '工作速录', icon: IconMic },
  habits: { label: '打卡', icon: IconRepeat },
  notes: { label: '轻笔记', icon: IconNote },
  trash: { label: '回收站', icon: IconTrash },
}

const GROUPS: { label: string; items: ViewKey[] }[] = [
  { label: '视图', items: ['all', 'active', 'soon', 'done'] },
  { label: 'Plan', items: ['week', 'plan'] },
  { label: '工作清单', items: ['sheets'] },
  { label: '工作速录', items: ['speedrec'] },
  { label: '个人成长', items: ['habits', 'notes'] },
]

const SWATCHES = ['#7c5cff', '#2ee6d6', '#5b9dff', '#f5a524', '#ff5c7a', '#34d399', '#a78bfa', '#fb923c']

interface Props {
  view: ViewKey
  onView: (v: ViewKey) => void
  activeCategory: string | null
  onCategory: (id: string | null) => void
  open: boolean
  onClose: () => void
}

export function Sidebar({ view, onView, activeCategory, onCategory, open, onClose }: Props) {
  const { tasks, categories, habits, notes, sheets, prefs, setPrefs, addCategory, renameCategory, removeCategory } = useApp()
  const now = useNow()
  const [adding, setAdding] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [draftColor, setDraftColor] = useState(SWATCHES[0])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [appVersion, setAppVersion] = useState('')

  useEffect(() => {
    void bridge.info().then((i) => {
      const v = typeof i?.version === 'string' ? i.version : ''
      // package.json 形如 2026.10.13-10 → 展示为 v20261013.10
      if (v) setAppVersion(formatAppVersion(v))
    })
  }, [])

  const counts = useMemo(() => {
    let all = 0
    let active = 0
    let soon = 0
    let done = 0
    let plan = 0
    let week = 0
    let trash = 0
    const mon = mondayOf(now)
    const weekEndMs = (() => {
      const x = new Date(mon)
      x.setDate(x.getDate() + 7)
      return x.getTime()
    })()
    for (const t of tasks) {
      // 回收站里的任务不参与任何常规统计
      if (t.trashedAt) {
        trash += 1
        continue
      }
      all += 1
      if (t.status === 'completed') {
        done += 1
        continue
      }
      active += 1
      const u = urgencyOf(t, now)
      if (u === 'soon' || u === 'overdue') soon += 1
      if (t.planned && t.dueAt !== null && t.dueAt > now) plan += 1
      // 周视图：当前周一 ~ 周日之间有到期待办的任务
      if (t.dueAt !== null && t.dueAt >= mon && t.dueAt < weekEndMs) week += 1
    }
    // 打卡：今日还未打卡的习惯数
    const today = dayKey(now)
    let habitPending = 0
    for (const h of habits) if (!h.checkins[today]) habitPending += 1
    return { all, active, soon, done, plan, week, trash, habits: habitPending, notes: notes.length, sheets: sheets.length, speedrec: 0 }
  }, [tasks, now, habits, notes, sheets])

  const byCategory = useMemo(() => {
    const map = new Map<string, number>()
    for (const t of tasks) {
      if (t.trashedAt) continue
      map.set(t.categoryId, (map.get(t.categoryId) ?? 0) + 1)
    }
    return map
  }, [tasks])

  function renderNav(k: ViewKey) {
    const v = NAV_META[k]
    const Icon = v.icon
    const active = view === k && !activeCategory
    const n = counts[k]
    return (
      <li key={k}>
        <button
          onClick={() => {
            onView(k)
            onCategory(null)
            onClose()
          }}
          aria-current={active ? 'page' : undefined}
          className={cn(
            'group relative flex w-full items-center gap-3 rounded-2xl px-3 text-left transition-all duration-200',
            'min-h-[46px]',
            active
              ? 'bg-[var(--accent-soft)] t1 shadow-[0_10px_30px_-18px_var(--accent-glow)]'
              : 't2 hover:bg-surface hover:t1'
          )}
        >
          {active && (
            <span
              className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full"
              style={{ background: 'linear-gradient(var(--accent), var(--cy))' }}
            />
          )}
          <span
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-xl border',
              active ? 'border-transparent' : 'border-line'
            )}
            style={{
              background: active ? 'var(--accent-soft)' : 'var(--surface)',
              color: active ? (k === 'trash' ? 'var(--danger)' : 'var(--accent)') : 'inherit',
            }}
          >
            <Icon size={17} />
          </span>
          <span className="flex-1 truncate text-[0.9375rem] font-semibold">{v.label}</span>
          {n > 0 && (
            <span
              className={cn(
                'tnum min-w-[24px] rounded-full px-2 text-center text-xs font-bold leading-6',
                k === 'soon' && 'text-[var(--warn)]',
                k === 'trash' && 'text-[var(--danger)]',
                k !== 'soon' && k !== 'trash' && 't3'
              )}
              style={{
                background:
                  k === 'soon'
                    ? 'rgba(245,165,36,0.14)'
                    : k === 'trash'
                      ? 'rgba(255,92,122,0.12)'
                      : 'var(--surface)',
              }}
            >
              {n}
            </span>
          )}
        </button>
      </li>
    )
  }

  function submitCategory() {
    if (!draftName.trim()) return
    addCategory(draftName, draftColor)
    setDraftName('')
    setDraftColor(SWATCHES[0])
    setAdding(false)
  }

  return (
    <>
      {open && (
        <button
          aria-label="关闭侧边栏"
          className="fixed inset-0 z-30 bg-black/55 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-[278px] shrink-0 flex-col border-r border-line',
          'transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
          'lg:static lg:z-auto lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
        style={{
          background: 'linear-gradient(180deg, color-mix(in srgb, var(--ink-900) 78%, transparent), color-mix(in srgb, var(--ink-950) 88%, transparent))',
          backdropFilter: 'blur(16px)',
        }}
      >
        <div className="flex items-center justify-between px-4 pb-1 pt-3 lg:hidden">
          <span className="text-sm font-semibold t2">导航</span>
          <button className="btn-icon" onClick={onClose} aria-label="关闭">
            <IconX size={18} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-4 pt-2">
          {GROUPS.map((g) => (
            <div key={g.label} className="mb-5">
              <GroupLabel>{g.label}</GroupLabel>
              <ul className="mt-2 space-y-1">{g.items.map((k) => renderNav(k))}</ul>
            </div>
          ))}

          <div className="mb-5">
            <GroupLabel>回收站</GroupLabel>
            <ul className="mt-2 space-y-1">{renderNav('trash')}</ul>
          </div>

          <div className="mt-1 flex items-center justify-between pl-3 pr-1">
            <GroupLabel noPad>分类</GroupLabel>
            <button
              className="btn-icon !min-h-[32px] !min-w-[32px] rounded-lg"
              onClick={() => setAdding((s) => !s)}
              aria-label="新建分类"
              title="新建分类"
            >
              <IconPlus size={16} />
            </button>
          </div>

          {adding && (
            <div className="animate-fade-up mt-2 rounded-2xl border border-line bg-surface p-3">
              <input
                autoFocus
                className="field !min-h-[40px] text-sm"
                placeholder="分类名称"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitCategory()
                  if (e.key === 'Escape') setAdding(false)
                }}
              />
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {SWATCHES.map((c) => (
                  <button
                    key={c}
                    aria-label={`颜色 ${c}`}
                    onClick={() => setDraftColor(c)}
                    className={cn(
                      'h-6 w-6 rounded-full border-2 transition-transform',
                      draftColor === c ? 'scale-110 border-[var(--text-1)]' : 'border-transparent'
                    )}
                    style={{ background: c }}
                  />
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <button className="btn btn-primary h-9 min-h-[36px] flex-1 text-sm" onClick={submitCategory}>
                  创建
                </button>
                <button className="btn btn-ghost h-9 min-h-[36px] text-sm" onClick={() => setAdding(false)}>
                  取消
                </button>
              </div>
            </div>
          )}

          <ul className="mt-2 space-y-1">
            {categories.map((c) => {
              const active = activeCategory === c.id
              const editing = editingId === c.id
              return (
                <li key={c.id}>
                  {editing ? (
                    <div className="flex items-center gap-2 rounded-2xl border border-line bg-surface px-2 py-1.5">
                      <input
                        autoFocus
                        className="field !min-h-[34px] flex-1 text-sm"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            renameCategory(c.id, editName)
                            setEditingId(null)
                          }
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                      />
                      <button
                        className="btn btn-primary h-8 min-h-[34px] px-2.5 text-xs"
                        onClick={() => {
                          renameCategory(c.id, editName)
                          setEditingId(null)
                        }}
                      >
                        保存
                      </button>
                    </div>
                  ) : (
                    <div
                      className={cn(
                        'group flex min-h-[44px] items-center gap-3 rounded-2xl px-3 transition-all duration-200',
                        active ? 'bg-[var(--accent-soft)] t1' : 't2 hover:bg-surface hover:t1'
                      )}
                    >
                      <button
                        className="flex min-h-[44px] flex-1 items-center gap-3 text-left"
                        onClick={() => {
                          onCategory(active ? null : c.id)
                          onView('all')
                          onClose()
                        }}
                      >
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ background: c.color, boxShadow: `0 0 12px ${c.color}88` }}
                        />
                        <span className="flex-1 truncate text-[0.9375rem] font-medium">{c.name}</span>
                        <span className="tnum t3 text-xs font-semibold">{byCategory.get(c.id) ?? 0}</span>
                      </button>
                      {!c.builtin && (
                        <span className="flex items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                          <button
                            className="btn-icon !min-h-[34px] !min-w-[34px]"
                            aria-label="重命名分类"
                            onClick={() => {
                              setEditingId(c.id)
                              setEditName(c.name)
                            }}
                          >
                            <IconPencil size={15} />
                          </button>
                          <button
                            className="btn-icon !min-h-[34px] !min-w-[34px] hover:!text-[var(--danger)]"
                            aria-label="删除分类"
                            onClick={() => removeCategory(c.id)}
                          >
                            <IconTrash size={15} />
                          </button>
                        </span>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </nav>

        {/* 底部：偏好与状态 */}
        <div className="border-t border-line px-3 py-3">
          <div className="mb-3 rounded-2xl border border-line bg-surface px-3 py-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="t3 font-semibold">进行中 / 已完成</span>
              <span className="tnum t2 font-bold">
                {counts.active} <span className="t3">/</span> {counts.done}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--surface-2)' }}>
              <div
                className="h-full rounded-full transition-[width] duration-700 ease-out"
                style={{
                  width: `${counts.all ? Math.round((counts.done / counts.all) * 100) : 0}%`,
                  background: 'linear-gradient(90deg, var(--accent), var(--cy))',
                }}
              />
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              className="btn-ghost btn flex-1 !min-h-[40px] text-xs"
              onClick={() => setPrefs({ theme: prefs.theme === 'dark' ? 'light' : 'dark' })}
              aria-label="切换主题"
            >
              {prefs.theme === 'dark' ? <IconSun size={16} /> : <IconMoon size={16} />}
              {prefs.theme === 'dark' ? '浅色' : '深色'}
            </button>
            <button
              className={cn('btn btn-ghost !min-h-[40px] !min-w-[44px] !px-0', !prefs.sound && '!t3 opacity-60')}
              onClick={() => setPrefs({ sound: !prefs.sound })}
              aria-pressed={prefs.sound}
              aria-label={prefs.sound ? '关闭提示音' : '开启提示音'}
              title={prefs.sound ? '提示音已开启' : '提示音已关闭'}
            >
              {prefs.sound ? <IconVolume size={16} /> : <IconVolumeOff size={16} />}
            </button>
            <button
              className={cn('btn btn-ghost !min-h-[40px] !min-w-[44px] !px-0', !prefs.nativeNotify && 'opacity-60')}
              onClick={() => setPrefs({ nativeNotify: !prefs.nativeNotify })}
              aria-pressed={prefs.nativeNotify}
              aria-label={prefs.nativeNotify ? '关闭系统通知' : '开启系统通知'}
              title={prefs.nativeNotify ? '系统通知已开启' : '系统通知已关闭'}
            >
              <IconBell size={16} />
            </button>
          </div>

          <button
            className="mt-2 w-full text-center text-[11px] t3 transition-colors hover:t2"
            onClick={() => void bridge.revealData()}
            title="在 Finder 中显示本地数据文件"
          >
            {`Sloth ${appVersion || 'v20261022.1'} · 数据存于本地`}
          </button>
        </div>
      </aside>
    </>
  )
}

function GroupLabel({ children, noPad }: { children: React.ReactNode; noPad?: boolean }) {
  return (
    <p
      className={cn(
        'text-[11px] font-bold uppercase tracking-[0.16em] t3',
        noPad ? '' : 'pl-3'
      )}
    >
      {children}
    </p>
  )
}

/** 该时刻所在周的周一（0 点）；按日历天回退，避免夏令时把周一起点推错一天 */
function mondayOf(ts: number): number {
  const d = new Date(ts)
  const wd = (d.getDay() + 6) % 7 // 周一 = 0
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - wd)
  return d.getTime()
}

/** package.json 版本（如 2026.10.13-10）→ 展示为 v20261013.10；不符合格式时原样加 v */
function formatAppVersion(v: string): string {
  const m = /^(\d{4})\.(\d{1,2})\.(\d{1,2})-(\d+)$/.exec(v)
  if (!m) return `v${v}`
  const [, y, mo, d, build] = m
  return `v${y}${mo.padStart(2, '0')}${d.padStart(2, '0')}.${build}`
}
