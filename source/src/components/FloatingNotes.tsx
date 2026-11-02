import { useCallback, useEffect, useRef, useState } from 'react'
import { NOTE_COLORS, useApp } from '../store/AppContext'
import { cn } from '../lib/cn'
import { IconNote, IconPlus, IconX } from './Icons'

const POS_KEY = 'sloth-quicknote-pos'
const BALL = 56
const PANEL_W = 320
const MARGIN = 24

interface Pos {
  x: number
  y: number
}

/** 右下角默认位置 */
function cornerPos(): Pos {
  if (typeof window === 'undefined') return { x: 0, y: 0 }
  return {
    x: window.innerWidth - BALL - MARGIN,
    y: window.innerHeight - BALL - MARGIN,
  }
}

function clampPos(p: Pos): Pos {
  if (typeof window === 'undefined') return p
  const maxX = window.innerWidth - BALL - 4
  const maxY = window.innerHeight - BALL - 4
  return {
    x: Math.min(Math.max(4, p.x), Math.max(4, maxX)),
    y: Math.min(Math.max(4, p.y), Math.max(4, maxY)),
  }
}

/** 只在用户手动拖动过之后才有记录；否则返回 null（保持贴右下角） */
function loadPos(): Pos | null {
  try {
    const raw = localStorage.getItem(POS_KEY)
    if (raw) {
      const p = JSON.parse(raw) as Pos
      if (typeof p.x === 'number' && typeof p.y === 'number') return clampPos(p)
    }
  } catch {
    /* ignore */
  }
  return null
}

export function FloatingNotes() {
  const { addNote, pushToast, requestView } = useApp()
  const [pos, setPos] = useState<Pos>(cornerPos)
  /** 是否被用户手动拖动过（拖动后才持久化坐标） */
  const [custom, setCustom] = useState(false)
  const [open, setOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [text, setText] = useState('')
  const [color, setColor] = useState(NOTE_COLORS[0])
  const dragRef = useRef<{ dx: number; dy: number; moved: boolean } | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // 首帧后应用历史拖动位置（若有）
  useEffect(() => {
    const saved = loadPos()
    if (saved) {
      setPos(saved)
      setCustom(true)
    }
  }, [])

  // 全局快捷键：⌘/Ctrl + Shift + N 唤起速记
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 窗口尺寸变化：未拖动过则始终贴右下角，拖动过则仅拉回可视区
  useEffect(() => {
    const onResize = () => setPos((p) => (custom ? clampPos(p) : cornerPos()))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [custom])

  useEffect(() => {
    try {
      if (custom) localStorage.setItem(POS_KEY, JSON.stringify(pos))
      else localStorage.removeItem(POS_KEY)
    } catch {
      /* ignore */
    }
  }, [pos, custom])

  useEffect(() => {
    if (open) {
      const id = window.setTimeout(() => inputRef.current?.focus(), 30)
      return () => window.clearTimeout(id)
    }
  }, [open])

  const save = useCallback(() => {
    const trimmed = text.trim()
    if (!trimmed) return
    addNote(trimmed, color)
    setText('')
    setColor(NOTE_COLORS[0])
    setOpen(false)
    pushToast({ tone: 'ok', title: '已存入轻笔记', ttl: 1000 })
  }, [text, color, addNote, pushToast])

  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y, moved: false }
    setDragging(true)
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current
    if (!d) return
    const x = e.clientX - d.dx
    const y = e.clientY - d.dy
    if (Math.abs(x - pos.x) + Math.abs(y - pos.y) > 4) {
      d.moved = true
      setCustom(true)
    }
    setPos(clampPos({ x, y }))
  }

  function onPointerUp(e: React.PointerEvent) {
    const moved = dragRef.current?.moved ?? false
    dragRef.current = null
    setDragging(false)
    try {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    if (!moved) setOpen((o) => !o)
  }

  const anchorLeft = pos.x < PANEL_W + 8
  const below = pos.y < 260

  return (
    <div className="fixed z-[60]" style={{ left: pos.x, top: pos.y }}>
      {open && (
        <div
          className={cn(
            'animate-pop-in absolute w-[320px] max-w-[calc(100vw-1.5rem)] rounded-[20px] border border-line p-3.5 shadow-lift',
            anchorLeft ? 'left-0' : 'right-0'
          )}
          style={{
            ...(below ? { top: BALL + 12 } : { bottom: BALL + 12 }),
            background: 'var(--ink-800)',
            backdropFilter: 'blur(20px)',
          }}
        >
          <div className="mb-2 flex items-center gap-2">
            <span
              className="flex h-7 w-7 items-center justify-center rounded-lg"
              style={{ background: 'rgba(46,230,214,0.16)', color: 'var(--cy)' }}
            >
              <IconNote size={15} />
            </span>
            <span className="text-[13px] font-bold t1">速记</span>
            <button
              className="btn-icon ml-auto !min-h-[28px] !min-w-[28px]"
              aria-label="关闭"
              onClick={() => setOpen(false)}
            >
              <IconX size={15} />
            </button>
          </div>

          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false)
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                save()
              }
            }}
            rows={4}
            placeholder="随手记一句…（⌘/Ctrl + Enter 保存）"
            className="field !min-h-[92px] resize-y leading-relaxed"
          />

          <div className="mt-2.5 flex items-center gap-1.5">
            {NOTE_COLORS.map((c) => (
              <button
                key={c}
                aria-label={`颜色 ${c}`}
                onClick={() => setColor(c)}
                className={cn(
                  'h-5 w-5 rounded-full border-2 transition-transform',
                  color === c ? 'scale-110 border-[var(--text-1)]' : 'border-transparent'
                )}
                style={{ background: c }}
              />
            ))}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button
              className="text-[12px] font-semibold t3 transition-colors hover:t1"
              onClick={() => {
                requestView('notes')
                setOpen(false)
              }}
            >
              全部笔记
            </button>
            <button
              className="btn btn-primary ml-auto !min-h-[38px] !rounded-xl text-[13px]"
              onClick={save}
              disabled={!text.trim()}
            >
              保存
            </button>
          </div>
        </div>
      )}

      <button
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        aria-label="打开速记"
        title="速记（⌘/Ctrl + Shift + N）· 可拖动"
        className={cn(
          'flex items-center justify-center rounded-full text-white shadow-[0_16px_38px_-14px_var(--accent-glow)]',
          'transition-transform duration-200 hover:scale-105 active:scale-95',
          dragging ? 'cursor-grabbing' : 'cursor-grab'
        )}
        style={{
          width: BALL,
          height: BALL,
          background: 'linear-gradient(135deg, var(--accent) 0%, color-mix(in srgb, var(--accent) 60%, var(--cy)) 100%)',
          touchAction: 'none',
        }}
      >
        {open ? <IconX size={22} /> : <IconPlus size={22} />}
      </button>
    </div>
  )
}
