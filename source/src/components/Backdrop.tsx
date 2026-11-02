import { cn } from '../lib/cn'
import logoUrl from '../assets/app-logo.png'

/** 氛围层：极光光晕 + 细网格 + 噪点，为玻璃拟态提供"纵深"而非纯色背景 */
export function Backdrop() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0" style={{ background: 'var(--ink-950)' }} />

      {/* 光晕：用径向渐变本身做柔化，避免大半径 blur() 滤镜在动画时每帧重算（非常吃 GPU） */}
      <div
        className="absolute -left-[18%] -top-[28%] h-[62vw] w-[62vw] rounded-full"
        style={{ background: 'radial-gradient(circle at 40% 40%, var(--orb-a), transparent 80%)' }}
      />
      <div
        className="absolute -right-[14%] top-[6%] h-[46vw] w-[46vw] rounded-full"
        style={{
          background: 'radial-gradient(circle at 50% 50%, var(--orb-b), transparent 82%)',
        }}
      />
      <div
        className="absolute bottom-[-30%] left-[26%] h-[52vw] w-[52vw] rounded-full"
        style={{
          background: 'radial-gradient(circle at 50% 50%, var(--orb-c), transparent 84%)',
        }}
      />

      {/* 细网格 */}
      <div
        className="absolute inset-0 opacity-[0.16]"
        style={{
          backgroundImage:
            'linear-gradient(to right, color-mix(in srgb, var(--text-3) 40%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in srgb, var(--text-3) 40%, transparent) 1px, transparent 1px)',
          backgroundSize: '56px 56px',
          maskImage: 'radial-gradient(ellipse 90% 70% at 50% 0%, #000 20%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse 90% 70% at 50% 0%, #000 20%, transparent 75%)',
        }}
      />

      {/* 噪点 */}
      <div
        className="absolute inset-0 mix-blend-overlay"
        style={{
          opacity: 'var(--noise-opacity)',
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />
    </div>
  )
}

/** 品牌标识：与应用图标一致的时钟图（来自用户提供的 logo） */
export function LogoMark({ size = 30, className }: { size?: number; className?: string }) {
  return (
    <img
      src={logoUrl}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn('shrink-0 select-none rounded-[22.5%]', className)}
      style={{ width: size, height: size }}
    />
  )
}
