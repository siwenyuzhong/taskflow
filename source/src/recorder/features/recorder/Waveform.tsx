import { useEffect, useRef } from 'react'
import { useRecorderStore, LEVEL_BARS } from '@renderer/state/recorder'
import { themeColor, useUiStore } from '@renderer/state/ui'

/** 滚动实时波形：从左到右填充最近的电平峰值。 */
export function Waveform({ height = 168 }: { height?: number }): JSX.Element {
  const levels = useRecorderStore((s) => s.levels)
  const state = useRecorderStore((s) => s.state)
  const scheme = useUiStore((s) => s.scheme)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement
    if (!parent) return

    const dpr = window.devicePixelRatio || 1
    const w = parent.clientWidth
    const h = parent.clientHeight
    canvas.width = w * dpr
    canvas.height = h * dpr
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    const mid = h / 2
    const barW = w / LEVEL_BARS
    const gap = Math.min(2, barW * 0.35)
    const active =
      state === 'RECORDING'
        ? themeColor('--c-rec')
        : state === 'PAUSED'
          ? themeColor('--c-accent-strong')
          : themeColor('--c-accent')

    // 中线（用 ink 的低透明度，明暗主题都有对比）
    ctx.fillStyle = themeColor('--c-ink', 0.07)
    ctx.fillRect(0, mid - 0.5, w, 1)

    ctx.fillStyle = active
    for (let i = 0; i < levels.length; i++) {
      const x = i * barW
      const peak = Math.min(1, levels[i] * 1.15)
      const bh = Math.max(2, peak * (h - 12))
      const y = mid - bh / 2
      const r = Math.min(barW - gap, bh) / 2
      const bw = Math.max(1, barW - gap)
      roundRect(ctx, x + gap / 2, y, bw, bh, r)
    }
  }, [levels, state, scheme, height])

  return (
    <div
      className="relative w-full overflow-hidden rounded-2xl border border-sr-line/70 bg-sr-canvas"
      style={{ height }}
    >
      <div className="pointer-events-none absolute inset-0 [background:radial-gradient(120%_100%_at_50%_0%,rgb(var(--c-accent)/0.07),transparent_60%)]" />
      <canvas ref={canvasRef} className="block" />
      {levels.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-[13px] text-sr-ink-faint">
          点击按钮开始速录，这里会显示实时波形
        </div>
      )}
    </div>
  )
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
  ctx.fill()
}
