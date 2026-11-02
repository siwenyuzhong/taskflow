import { useEffect, useState } from 'react'
import { LogoMark } from './Backdrop'

/**
 * 轻量模式的「飘过提醒」（路由 #lightfly）。
 *
 * 主进程在轻量模式下开的屏幕顶部透明窗（transparent + focusable:false），
 * 通过 URL query 传入待办清单（`tasks` 用 base64 编码，避免中文逐条过 URL）：
 * **一条任务 = 一个飘条**，多条按 1.6s 错峰依次从右到左飘过 —— 有几条任务就飘几条。
 *
 * 鼠标悬停在某个飘条上 → 暂停它的滑动（方便慢慢看清、再决定点不点）；移开 →
 * 从暂停处继续滑完（Web Animations API 的 pause/play，不重启动画）。
 * 点击飘条 → 主进程唤回主窗口并退出轻量模式；飘窗由主进程兜底定时销毁。
 *
 * 说明：飘窗是整屏宽的置顶窗，默认对鼠标「穿透」（否则会挡住屏幕最上方的操作）。
 * 悬停/点击由主进程轮询全局鼠标位置后决定是否收回穿透（与字幕窗同一套做法）。
 *
 * 动画只在这里挂一次：pause 只切 class，不重写 `style.animation` —— 后者会让
 * 重渲染把动画从头开始，表现为「悬停后仍然在动」。
 */

/** 字段分隔：\u001f 分隔任务，\u001e 分隔字段 */
const ROW_SEP = '\u001f'
const COL_SEP = '\u001e'
/** 每条之间的错峰与动画总时长（30s 滑完全屏 ≈ 96px/s，看得清、跟得上） */
const STAGGER_MS = 1600
const GLIDE_MS = 30000

interface FlyItem {
  title: string
  label: string
  overdue: boolean
}

/** 主进程用 base64（base64url）传待办清单：中文直接走 query 会被 loadFile 二次编码搞坏 */
function decodeItems(raw: string): FlyItem[] {
  if (!raw) return []
  let text = ''
  try {
    const b64 = raw.replace(/-/g, '+').replace(/_/g, '/')
    const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : ''
    const bin = window.atob(b64 + pad)
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    text = new TextDecoder('utf-8').decode(bytes)
  } catch {
    return []
  }
  if (!text) return []
  return text
    .split(ROW_SEP)
    .map((row) => {
      const [overdue, title, label] = row.split(COL_SEP)
      return { overdue: overdue === '1', title: title ?? '', label: label ?? '' }
    })
    .filter((it) => it.title)
}

export function LightFly() {
  const params = new URLSearchParams(window.location.search)
  const items = decodeItems(params.get('tasks') ?? '')
  const count = Math.max(0, Number(params.get('count') || 0) || 0)

  /** 悬停下标（主进程推送），null = 没悬停 */
  const [pausedIndex, setPausedIndex] = useState<number | null>(null)

  // 挂动画 + 上报命中框；只在条数变化时跑一次
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('.lf-pill'))
    // 每条固定 12s 滑完全屏、只错峰起点：与主进程关窗时长
    // （GLIDE + (n-1)*STAGGER + TAIL）严格对齐，最后一条也能完整飘出左缘
    nodes.forEach((el, i) => {
      el.style.animation = `lf-glide ${GLIDE_MS}ms linear ${i * STAGGER_MS}ms forwards`
    })
    // 强制一次样式计算，保证 getAnimations() 能抓到刚挂上的动画
    void nodes[0]?.offsetWidth

    // 药丸一直在动，命中框得跟着走：每帧把各条矩形上报给主进程
    let raf = 0
    const report = () => {
      const rects = Array.from(document.querySelectorAll<HTMLElement>('.lf-pill')).map((el) => {
        const r = el.getBoundingClientRect()
        return { x: r.left, y: r.top, w: r.width, h: r.height }
      })
      window.taskflow?.lightmodeHit?.(rects)
      raf = window.requestAnimationFrame(report)
    }
    raf = window.requestAnimationFrame(report)

    return () => window.cancelAnimationFrame(raf)
  }, [items.length])

  // 主进程轮询出的悬停下标：只停对应的那一条，其余照常飘。
  // 用 CSS 的 `animation-play-state: paused`（挂在 .lf-paused 上）来暂停：
  // 对 CSS 动画调 WAAPI 的 pause() 会被样式重算按 `animation-play-state` 顶回去，
  // 表现为「加了暂停样式但还在动」。
  useEffect(() => {
    const off = window.taskflow?.onLightmodeHover?.((index) => setPausedIndex(index))
    return () => off?.()
  }, [])

  return (
    <div className="lf-track">
      {items.map((it, i) => (
        <button
          key={`${it.title}-${i}`}
          type="button"
          className={pausedIndex === i ? 'lf-pill lf-paused' : 'lf-pill'}
          data-index={i}
          style={pausedIndex === i ? { animationPlayState: 'paused' } : undefined}
          onClick={() => window.taskflow?.lightmodeOpen()}
          title="点击打开 Sloth"
        >
          <LogoMark size={20} />
          <span className="lf-badge">{count} 项待完成</span>
          <span className={it.overdue ? 'lf-msg lf-overdue' : 'lf-msg'}>{it.title}</span>
          {it.label ? <span className="lf-when">{it.label}</span> : null}
          <span className="lf-cta">{pausedIndex === i ? '已暂停 · 点击打开' : '点击打开'}</span>
        </button>
      ))}
    </div>
  )
}
