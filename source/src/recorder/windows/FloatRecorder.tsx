import { useEffect, useState } from 'react'
import { formatTimer } from '@renderer/lib/format'
import { ChevronIcon, ExpandIcon, MinusIcon, PauseIcon, PlayIcon, StopIcon } from '@renderer/components/Icons'
import type { FloatCommand, FloatState } from '@shared/ipc'

/** 窗口拖动区 / 交互区（Electron 无边框窗口：drag 区域收不到 click，按钮必须 no-drag）。 */
const drag = { WebkitAppRegion: 'drag' } as unknown as React.CSSProperties
const noDrag = { WebkitAppRegion: 'no-drag' } as unknown as React.CSSProperties

// 悬浮球底色已近不透明，backdrop-blur 只会白白增加置顶透明窗的合成开销
const SHELL =
  'border border-white/10 bg-[#0b0b14]/95 shadow-2xl'

/**
 * 「后台录制」悬浮球：贴在屏幕右缘，默认收起成一个小标签，点击展开成长条控制面。
 * 录音引擎仍在主窗口渲染层运行，这里只做控制与计时显示。
 * 每次点「后台录制」都以收起形态出现，不占右下角。
 */
export function FloatRecorder(): JSX.Element {
  const [s, setS] = useState<FloatState>({ state: 'RECORDING', elapsedMs: 0, expanded: false })

  useEffect(
    () =>
      window.api.windows.onFloatState((next) =>
        setS({ ...next, expanded: next.expanded ?? false })
      ),
    []
  )

  const cmd = (c: FloatCommand): void => window.api.windows.sendFloatCommand(c)
  const recording = s.state === 'RECORDING'
  const paused = s.state === 'PAUSED'
  const dot = recording ? 'animate-pulse bg-red-500' : paused ? 'bg-amber-400' : 'bg-white/40'

  // ---- 收起态：屏幕右缘的小标签（顶部可拖动，点其余处展开） ----
  if (!s.expanded) {
    return (
      <div style={drag} className={`flex h-screen w-screen flex-col ${SHELL} rounded-l-2xl`}>
        <button
          type="button"
          title="展开录制控制"
          style={noDrag}
          onClick={() => cmd('expand')}
          className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-l-2xl text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} />
          <span className="text-[10px] leading-tight tracking-wide">
            {recording ? '录制' : paused ? '暂停' : '停止'}
          </span>
          <ChevronIcon width={15} height={15} className="rotate-180" />
        </button>
      </div>
    )
  }

  // ---- 展开态：长条控制面 ----
  return (
    <div className="flex h-screen w-screen items-center justify-center p-1.5">
      <div style={drag} className={`flex h-full w-full items-center gap-1.5 rounded-2xl px-2.5 ${SHELL}`}>
        <FloatBtn title="收起贴到屏幕右缘" onClick={() => cmd('collapse')}>
          <MinusIcon width={16} height={16} />
        </FloatBtn>
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} />
        <span className="shrink-0 text-[15px] font-medium tabular-nums text-white">
          {formatTimer(s.elapsedMs)}
        </span>
        <span className="mr-auto shrink-0 whitespace-nowrap pl-1 text-[11px] text-white/45">
          {recording ? '录制中' : paused ? '已暂停' : '已停止'}
        </span>

        {recording && (
          <FloatBtn title="暂停" onClick={() => cmd('pause')}>
            <PauseIcon width={16} height={16} />
          </FloatBtn>
        )}
        {paused && (
          <FloatBtn title="继续" onClick={() => cmd('resume')} accent>
            <PlayIcon width={16} height={16} />
          </FloatBtn>
        )}
        <FloatBtn title="停止并保存" onClick={() => cmd('stop')} danger>
          <StopIcon width={15} height={15} />
        </FloatBtn>
        <FloatBtn title="回到主窗口" onClick={() => cmd('restore')}>
          <ExpandIcon width={15} height={15} />
        </FloatBtn>
      </div>
    </div>
  )
}

function FloatBtn({
  title,
  onClick,
  children,
  danger,
  accent
}: {
  title: string
  onClick: () => void
  children: React.ReactNode
  danger?: boolean
  accent?: boolean
}): JSX.Element {
  return (
    <button
      type="button"
      title={title}
      style={noDrag}
      onClick={onClick}
      className={
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white transition-colors ' +
        (danger
          ? 'hover:bg-red-500/80'
          : accent
            ? 'bg-emerald-500/80 hover:bg-emerald-500'
            : 'hover:bg-white/15')
      }
    >
      {children}
    </button>
  )
}
