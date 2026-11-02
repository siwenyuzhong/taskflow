import { useRecorderStore } from '@renderer/state/recorder'
import { cn } from '@renderer/lib/cn'

/** 实时电平条：直观判断「到底录上没」「声音大小合不合适」。 */
export function LevelMeter(): JSX.Element {
  const { rms, peak } = useRecorderStore((s) => s.level)
  const state = useRecorderStore((s) => s.state)
  const recording = state === 'RECORDING'

  // 近似 dB 映射，视觉更线性
  const toPct = (v: number): number => {
    if (v <= 0.0001) return 0
    const db = 20 * Math.log10(v)
    const norm = (db + 60) / 60
    return Math.max(0, Math.min(1, norm)) * 100
  }

  const rmsPct = toPct(rms)
  const peakPct = toPct(peak)
  const clipping = peak >= 0.99

  return (
    <div className="flex items-center gap-3">
      <span className="w-8 text-[11px] text-sr-ink-faint">电平</span>
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-sr-elevated">
        <div
          className={cn(
            'absolute inset-y-0 left-0 rounded-full transition-[width] duration-75',
            clipping ? 'bg-sr-rec' : recording ? 'bg-sr-accent' : 'bg-sr-ink-faint'
          )}
          style={{ width: `${rmsPct}%` }}
        />
        <div
          className="absolute inset-y-0 w-[2px] bg-sr-ink/70"
          style={{ left: `calc(${peakPct}% - 1px)`, opacity: peakPct > 0 ? 1 : 0 }}
        />
      </div>
      <span className={cn('w-10 text-right text-[11px] tabular', clipping ? 'text-sr-rec' : 'text-sr-ink-faint')}>
        {clipping ? '过载' : `${Math.round(peakPct)}%`}
      </span>
    </div>
  )
}
