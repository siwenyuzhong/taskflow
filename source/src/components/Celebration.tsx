import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '../lib/cn'

type Burst = { id: string; x: number; y: number }

type Listener = (x: number, y: number) => void
const listeners = new Set<Listener>()

/** 完成任务时从点击位置撒出的一把粒子——纯 CSS 关键帧，无第三方依赖 */
export function celebrate(x: number, y: number) {
  listeners.forEach((l) => l(x, y))
}

const COLORS = ['#7c5cff', '#2ee6d6', '#f5a524', '#34d399', '#ff5c7a', '#ffffff']

export function CelebrationLayer() {
  const [bursts, setBursts] = useState<Burst[]>([])
  const seq = useRef(0)

  useEffect(() => {
    const listener: Listener = (x, y) => {
      const id = `b${(seq.current += 1)}`
      setBursts((prev) => [...prev.slice(-4), { id, x, y }])
      window.setTimeout(() => setBursts((prev) => prev.filter((b) => b.id !== id)), 900)
    }
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])

  const particles = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => ({
        angle: (360 / 14) * i + Math.random() * 12,
        delay: Math.random() * 60,
        color: COLORS[i % COLORS.length],
        size: 5 + Math.random() * 4,
      })),
    []
  )

  return (
    <div className="pointer-events-none fixed inset-0 z-[80] overflow-hidden" aria-hidden="true">
      {bursts.map((b) => (
        <span key={b.id} className="absolute" style={{ left: b.x, top: b.y }}>
          <span
            className="absolute block h-1.5 w-1.5 rounded-full"
            style={{
              boxShadow: '0 0 14px 2px var(--accent-glow)',
              animation: 'none',
            }}
          />
          {particles.map((p, i) => (
            <span
              key={i}
              className="absolute block animate-burst rounded-full"
              style={
                {
                  width: p.size,
                  height: p.size,
                  background: p.color,
                  left: 0,
                  top: 0,
                  animationDelay: `${p.delay}ms`,
                  '--a': `${p.angle}deg`,
                } as React.CSSProperties
              }
            />
          ))}
        </span>
      ))}
    </div>
  )
}

/** 完成时的对号描边动画 */
export function CheckDraw({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn('h-3.5 w-3.5', className)} fill="none" aria-hidden="true">
      <path
        d="M4.5 12.5 9.5 17.5 19.5 6.5"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="30"
        strokeDashoffset="30"
        className="animate-check-draw"
      />
    </svg>
  )
}
