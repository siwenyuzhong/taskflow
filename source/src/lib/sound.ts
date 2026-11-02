/**
 * 用 WebAudio 合成提示音——无需任何音频资源文件，保持安装包干净。
 * 三段式音色：即将到期（上行两音）、已到期（急促三连）、完成（明亮三和弦）。
 */

let ctx: AudioContext | null = null

function audio(): AudioContext | null {
  try {
    if (!ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return null
      ctx = new Ctor()
    }
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

function tone(
  ac: AudioContext,
  freq: number,
  startAt: number,
  duration: number,
  peak: number,
  type: OscillatorType = 'sine'
) {
  const osc = ac.createOscillator()
  const gain = ac.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, startAt)
  gain.gain.setValueAtTime(0.0001, startAt)
  gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration)
  osc.connect(gain)
  gain.connect(ac.destination)
  osc.start(startAt)
  osc.stop(startAt + duration + 0.05)
}

export type ChimeKind = 'soon' | 'overdue' | 'done' | 'tick'

export function playChime(kind: ChimeKind, enabled = true) {
  if (!enabled) return
  const ac = audio()
  if (!ac) return
  const t = ac.currentTime + 0.02

  if (kind === 'soon') {
    tone(ac, 880, t, 0.28, 0.11)
    tone(ac, 1318.5, t + 0.16, 0.42, 0.09)
    return
  }
  if (kind === 'overdue') {
    tone(ac, 660, t, 0.18, 0.13, 'triangle')
    tone(ac, 587.3, t + 0.2, 0.18, 0.13, 'triangle')
    tone(ac, 493.9, t + 0.4, 0.5, 0.12, 'triangle')
    return
  }
  if (kind === 'done') {
    tone(ac, 587.3, t, 0.26, 0.09)
    tone(ac, 784, t + 0.09, 0.3, 0.085)
    tone(ac, 1174.7, t + 0.19, 0.55, 0.075)
    return
  }
  tone(ac, 1200, t, 0.06, 0.045, 'square')
}
