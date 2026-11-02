import { memo } from 'react'
import type { SortKey } from '../types'
import { cn } from '../lib/cn'
import { IconChevronDown, IconFilter, IconMinimize, IconPlus, IconRepeat, IconSearch, IconTable } from './Icons'

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'urgency', label: '按到期时间' },
  { key: 'created', label: '按创建时间' },
  { key: 'priority', label: '按优先级' },
  { key: 'title', label: '按名称' },
]

interface Props {
  query: string
  onQuery: (q: string) => void
  sort: SortKey
  onSort: (s: SortKey) => void
  onNew: () => void
  onMenu: () => void
  searchRef: React.RefObject<HTMLInputElement>
  /** Windows：窗口按钮在系统标题栏里，顶栏左侧无需留位，logo 与搜索框尽量靠左 */
  isWin?: boolean
  /** 轻量模式：收起主窗口到 Dock，屏幕顶部周期性飘过「今天/快到期」提醒 */
  lightmode?: boolean
  onLightmode?: () => void
  /** 浏览器预览没有 Dock，隐藏该按钮 */
  canLightmode?: boolean
  /** 快速打卡：把「打卡」页里今天还没打卡的习惯一次全打卡 */
  onQuickCheckin?: () => void
  /** 今天还没打卡的习惯数（按钮角标；0 表示已全部完成） */
  pendingCheckins?: number
  /** 打卡习惯总数（没有习惯时按钮置灰） */
  habitTotal?: number
  /** 工作清单：切到电子表格视图 */
  onOpenSheets?: () => void
  /** 工作清单视图是否正在显示 */
  sheetsActive?: boolean
}

function TopBarBase({
  query,
  onQuery,
  sort,
  onSort,
  onNew,
  onMenu,
  searchRef,
  isWin,
  lightmode,
  onLightmode,
  canLightmode,
  onQuickCheckin,
  pendingCheckins = 0,
  habitTotal = 0,
  onOpenSheets,
  sheetsActive,
}: Props) {
  return (
    <header
      className={cn(
        'drag-region flex h-[60px] shrink-0 items-center gap-2.5 pr-4 sm:gap-3',
        isWin ? 'pl-2' : 'pl-[88px]'
      )}
    >
      <button className="no-drag btn-icon lg:hidden" onClick={onMenu} aria-label="打开导航">
        <IconFilter size={19} />
      </button>

      <div className="no-drag relative w-full min-w-0 max-w-[320px]">
        <IconSearch
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 t3"
        />
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="搜索任务…"
          aria-label="搜索任务"
          className="field !min-h-[40px] !min-w-0 !pl-9 !pr-8 text-sm"
        />
        {query ? (
          <button
            aria-label="清空搜索"
            className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg t3 transition-colors hover:t1"
            onClick={() => onQuery('')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        ) : (
            <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-md border border-line px-1.5 py-0.5 text-[10px] font-bold t3 md:block">
              {isWin ? 'Ctrl K' : '⌘K'}
            </kbd>
        )}
      </div>

      <div className="no-drag ml-auto flex shrink-0 items-center gap-2">
        {onQuickCheckin && (
          <button
            className="btn btn-ghost !min-h-[40px] !rounded-[13px]"
            onClick={onQuickCheckin}
            title={
              habitTotal === 0
                ? '还没有打卡习惯：先去「打卡」页新建一个'
                : pendingCheckins > 0
                  ? `快速打卡：把今天还没打卡的 ${pendingCheckins} 个习惯一次全部打卡`
                  : '今天的习惯都已经打过卡了'
            }
          >
            <IconRepeat size={16} />
            <span className="hidden md:inline">快速打卡</span>
            {pendingCheckins > 0 && (
              <span
                className="tnum ml-0.5 min-w-[20px] rounded-full px-1.5 text-[11px] font-bold leading-[20px]"
                style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
              >
                {pendingCheckins}
              </span>
            )}
          </button>
        )}

        {onOpenSheets && (
          <button
            className={cn(
              'btn !min-h-[40px] !rounded-[13px]',
              sheetsActive ? 'btn-primary' : 'btn-ghost'
            )}
            aria-pressed={!!sheetsActive}
            onClick={onOpenSheets}
            title="工作清单：电子表格视图，可建多个工作表"
          >
            <IconTable size={16} />
            <span className="hidden md:inline">工作清单</span>
          </button>
        )}

        {canLightmode && (
          <button
            className={cn(
              'btn !min-h-[40px] !rounded-[13px]',
              lightmode ? 'btn-primary' : 'btn-ghost'
            )}
            aria-pressed={!!lightmode}
            onClick={onLightmode}
            title={
              lightmode
                ? '轻量模式进行中：点击退出并恢复主窗口（点 Dock 图标同样可回来）'
                : '轻量模式：窗口收起到 Dock；有今天/快到期的任务时，在屏幕顶部从右到左飘过提醒'
            }
          >
            <IconMinimize size={16} />
            <span className="hidden md:inline">{lightmode ? '退出轻量模式' : '轻量模式'}</span>
          </button>
        )}

        <div className="relative hidden sm:block">
          <select
            aria-label="排序方式"
            value={sort}
            onChange={(e) => onSort(e.target.value as SortKey)}
            className="field !min-h-[40px] cursor-pointer appearance-none !pr-8 text-sm font-semibold t2"
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key} className="bg-[var(--ink-800)] t1">
                {s.label}
              </option>
            ))}
          </select>
          <IconChevronDown
            size={15}
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 t3"
          />
        </div>

        <button
          className="btn btn-ghost !min-h-[40px] !rounded-[13px]"
          onClick={onNew}
          title="打开完整表单：备注、提醒提前量、精确时长"
        >
          <IconPlus size={17} />
          <span className="hidden md:inline">详细创建</span>
        </button>
      </div>
    </header>
  )
}

export const TopBar = memo(TopBarBase)
