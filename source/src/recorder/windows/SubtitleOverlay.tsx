import { useEffect, useRef, useState } from 'react'
import { cn } from '@renderer/lib/cn'
import { CloseIcon } from '@renderer/components/Icons'
import { speakerColor, speakerLabel } from '@renderer/lib/speakers'
import type { SubtitlePayload } from '@shared/ipc'

const drag = { WebkitAppRegion: 'drag' } as unknown as React.CSSProperties
const noDrag = { WebkitAppRegion: 'no-drag' } as unknown as React.CSSProperties

// 底板用纯色半透明（不再 backdrop-blur：透明置顶窗上的实时模糊在截图/合成时最吃 GPU）；
// 靠文字描边式阴影保证在亮色背景上也能看清
const MAIN_SHADOW: React.CSSProperties = {
  textShadow: '0 1px 2px rgba(0,0,0,.85), 0 0 10px rgba(0,0,0,.7), 0 0 26px rgba(0,0,0,.55)'
}

/** 逐字显示的节拍：约 18 字/秒，比中文语速快，落后过多时自动加速追赶 */
const TYPE_MS = 55

/**
 * 悬停状态：以主进程为准。
 * 透明窗在「鼠标穿透」态下收不到任何 DOM 鼠标事件（forward 仅 Windows 支持），
 * 所以由主进程轮询全局鼠标位置判定悬停并推送结果；本页只负责：
 *  - 订阅悬停态（true=显示阴影底板与关闭按钮，false=沉浸，仅留文字描边）；
 *  - 上报字幕本体矩形（随逐字打印 / 换句变化），供主进程精确命中；
 *  - 上报按下拖动状态，拖动期间锁定悬停，防止中途重新穿透丢窗。
 */
function useSubtitleHover(boxRef: React.RefObject<HTMLDivElement | null>): boolean {
  const [hover, setHover] = useState(false)

  useEffect(() => window.api.windows.onSubtitleHoverState(setHover), [])

  // 上报本体矩形：ResizeObserver 覆盖宽高变化（位置由底部居中布局推导，随之固定）
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const report = () => {
      const r = el.getBoundingClientRect()
      window.api.windows.subtitleHit({
        x: Math.round(r.left),
        y: Math.round(r.top),
        w: Math.round(r.width),
        h: Math.round(r.height)
      })
    }
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => ro.disconnect()
  }, [boxRef])

  // 拖动锁：按下即锁悬停；主进程另有兜底超时，偶发丢失 mouseup 也不会焊死
  useEffect(() => {
    const down = () => window.api.windows.subtitleDrag(true)
    const up = () => window.api.windows.subtitleDrag(false)
    window.addEventListener('mousedown', down)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousedown', down)
      window.removeEventListener('mouseup', up)
    }
  }, [])

  return hover
}

/**
 * 打印机式逐字显示：目标文本变长时按节拍补字，被整体改写（换句 / 重新识别）时从头打。
 * 用「是否以前缀延续」判断，避免每次增量推送都闪一下整行。
 */
function useTypewriter(target: string): { text: string; typing: boolean } {
  const [text, setText] = useState('')
  const shown = useRef('')

  useEffect(() => {
    const cur = shown.current
    // 目标变短（尾部识别被修正）：直接截到目标长度，别把整行重新打一遍
    if (cur.startsWith(target)) {
      if (cur !== target) {
        shown.current = target
        setText(target)
      }
      return
    }
    // 不是延续关系（换句 / 中途改写）：从头打
    let i = target.startsWith(cur) ? cur.length : 0
    if (i === 0 && cur !== '') {
      shown.current = ''
      setText('')
    }
    if (i >= target.length) return

    const timer = window.setInterval(() => {
      const lag = target.length - i
      if (lag <= 0) {
        window.clearInterval(timer)
        return
      }
      i = Math.min(target.length, i + Math.max(1, Math.ceil(lag / 6)))
      const next = target.slice(0, i)
      shown.current = next
      setText(next)
      if (i >= target.length) window.clearInterval(timer)
    }, TYPE_MS)

    return () => window.clearInterval(timer)
  }, [target])

  return { text, typing: text.length < target.length }
}

/** 按句末标点把定稿内容切成一条条字幕行（逗号不断行，避免切得太碎）。 */
function cueLines(segments: SubtitlePayload['segments']): string[] {
  const lines: string[] = []
  for (const s of segments) {
    const raw = String(s.text || '').trim()
    if (!raw) continue
    const parts = raw
      .split(/(?<=[。！？；!?;:])/)
      .map((t) => t.trim())
      .filter(Boolean)
    lines.push(...(parts.length ? parts : [raw]))
  }
  return lines
}

/**
 * 字幕悬浮窗：屏幕底部居中的透明置顶窗，实时显示转写文本。
 *
 *  - 只显示「当前这一句」（逐字打印）；定稿前的尾巴持续打印，定稿后进入下一句；
 *  - 悬停检测由主进程完成（见 useSubtitleHover）：鼠标移入字幕立即显示阴影底板与
 *    关闭按钮并可交互；移出后自动回到沉浸态（仅保留文字描边）并放行鼠标穿透；
 *    主窗口的「鼠标穿透」开关可强制常穿；
 *  - 检测到多个说话人时，在字幕旁标注「说话人 N」。
 */
export function SubtitleOverlay(): JSX.Element {
  const [p, setP] = useState<SubtitlePayload>({ text: '', segments: [], pending: '', speaker: null })
  const boxRef = useRef<HTMLDivElement>(null)
  // 主进程下发的悬停态：不在字幕上（移出 / 开启后静置）即沉浸
  const hover = useSubtitleHover(boxRef)

  useEffect(() => window.api.windows.onSubtitle((next) => setP(next)), [])

  const done = cueLines(p.segments)
  const pending = p.pending.trim()
  // 只保留当前一行：有未定稿尾巴时为「正在说的这句」，否则为最后一句定稿
  const main = pending || done[done.length - 1] || ''
  const typed = useTypewriter(main)
  const immersive = !hover

  // 是否出现了多个说话人：只有一个时不显示标签，避免冗余
  const speakers = new Set<number>()
  for (const seg of p.segments) if (typeof seg.speaker === 'number') speakers.add(seg.speaker)
  if (typeof p.speaker === 'number') speakers.add(p.speaker)
  const showSpeaker = speakers.size >= 2 && typeof p.speaker === 'number'

  return (
    <div className="flex h-screen w-screen flex-col justify-end">
      <div
        ref={boxRef}
        style={drag}
        className={cn(
          'relative mx-auto mb-3 w-fit max-w-[94%] rounded-2xl px-7 py-3 text-center transition-all duration-150',
          immersive ? 'bg-transparent' : 'bg-black/45 shadow-2xl ring-1 ring-white/10'
        )}
      >
        {/* 关闭按钮：鼠标在字幕上才出现（关闭仅在「关闭鼠标穿透」后可用） */}
        <button
          type="button"
          title="关闭字幕窗"
          style={noDrag}
          onClick={() => window.api.windows.sendSubtitleCommand('hide')}
          className={cn(
            'absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white/80 transition-opacity duration-150 hover:bg-white/25 hover:text-white',
            immersive ? 'pointer-events-none opacity-0' : 'opacity-100'
          )}
        >
          <CloseIcon width={12} height={12} />
        </button>

        {showSpeaker && (
          <span
            className="absolute -left-1 -top-2 rounded-full px-2 py-0.5 text-[11px] font-semibold text-white shadow"
            style={{ background: speakerColor(p.speaker as number) }}
          >
            {speakerLabel(p.speaker as number)}
          </span>
        )}

        {main ? (
          <p className="text-[26px] font-medium leading-snug text-white" style={MAIN_SHADOW}>
            {typed.text}
            {typed.typing && <span className="sr-caret" />}
          </p>
        ) : (
          <p className={cn('text-[15px] leading-snug', immersive ? 'text-white/40' : 'text-white/55')}>
            开启「实时转写」后，这里会显示实时字幕
          </p>
        )}
      </div>
    </div>
  )
}
