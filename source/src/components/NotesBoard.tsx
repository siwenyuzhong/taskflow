import { useEffect, useMemo, useRef, useState } from 'react'
import { NOTE_COLORS, useApp } from '../store/AppContext'
import { fileToDataUrl, imageFromClipboard, imageToDataUrl } from '../lib/image'
import { Markdown } from '../lib/markdown'
import { hasImage, noteSummary, noteTitle } from '../lib/notes'
import { formatDate } from '../lib/time'
import { cn } from '../lib/cn'
import type { Note } from '../types'
import { IconNote, IconPencil, IconPin, IconPlus, IconTrash, IconX } from './Icons'

export function NotesBoard({ query = '' }: { now: number; query?: string }) {
  const { notes, addNote, removeNote, togglePinNote } = useApp()
  const [draft, setDraft] = useState('')
  const [draftColor, setDraftColor] = useState(NOTE_COLORS[0])
  const [viewingId, setViewingId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Note | null>(null)
  const draftRef = useRef<HTMLTextAreaElement>(null)

  const q = query.trim().toLowerCase()
  const list = useMemo(() => {
    const filtered = q
      ? notes.filter((n) => n.content.toLowerCase().includes(q) || n.title.toLowerCase().includes(q))
      : notes
    return [...filtered].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return b.updatedAt - a.updatedAt
    })
  }, [notes, q])

  // 用 id 实时取数，置顶/编辑后视图保持最新
  const viewing = viewingId ? notes.find((n) => n.id === viewingId) ?? null : null

  async function pasteIntoDraft(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const file = imageFromClipboard(e)
    if (!file) return
    e.preventDefault()
    const md = await imageMarkdown(file)
    setDraft((c) => `${c}${c && !c.endsWith('\n') ? '\n' : ''}${md}\n`)
  }

  function submit() {
    if (!draft.trim()) return
    addNote(draft.trim(), draftColor)
    setDraft('')
    setDraftColor(NOTE_COLORS[0])
  }

  return (
    <div className="space-y-6">
      <section className="glass sheen relative overflow-hidden rounded-[24px] p-5 sm:p-6">
        <div
          className="pointer-events-none absolute -right-10 -top-14 h-48 w-48 rounded-full blur-3xl"
          style={{ background: 'radial-gradient(circle, rgba(46,230,214,0.35), transparent 70%)' }}
        />
        <div className="relative flex items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-[24px] font-bold t1">轻笔记</h1>
            <p className="mt-1 text-[13.5px] t2">
              支持 Markdown · 图片可直接粘贴 · 共
              <span className="tnum mx-1 font-bold" style={{ color: 'var(--cy)' }}>{notes.length}</span>条
            </p>
          </div>
          <span
            className="hidden h-12 w-12 items-center justify-center rounded-2xl sm:flex"
            style={{ background: 'rgba(46,230,214,0.14)', color: 'var(--cy)' }}
          >
            <IconNote size={24} />
          </span>
        </div>

        <div className="relative mt-4 rounded-2xl border border-line p-3" style={{ background: 'var(--surface)' }}>
          <textarea
            ref={draftRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onPaste={pasteIntoDraft}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                submit()
              }
            }}
            placeholder="写点什么… 支持 # 标题、**加粗**、- 列表，图片可直接粘贴（⌘/Ctrl + Enter 保存）"
            rows={4}
            className="field !min-h-[96px] resize-y font-mono text-[13.5px] leading-relaxed"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {NOTE_COLORS.map((c) => (
              <button
                key={c}
                aria-label={`颜色 ${c}`}
                onClick={() => setDraftColor(c)}
                className={cn(
                  'h-6 w-6 rounded-full border-2 transition-transform',
                  draftColor === c ? 'scale-110 border-[var(--text-1)]' : 'border-transparent'
                )}
                style={{ background: c }}
              />
            ))}
            <button
              className="btn btn-primary ml-auto !min-h-[38px] !rounded-xl text-sm"
              onClick={submit}
              disabled={!draft.trim()}
            >
              <IconPlus size={15} />
              添加笔记
            </button>
          </div>
        </div>
      </section>

      {list.length === 0 ? (
        <div className="glass sheen flex flex-col items-center gap-3 rounded-[22px] px-6 py-14 text-center">
          <span
            className="flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{ background: 'rgba(46,230,214,0.14)', color: 'var(--cy)' }}
          >
            <IconNote size={26} />
          </span>
          <p className="font-display text-[16px] font-bold t1">{q ? '没有匹配的笔记' : '还没有笔记'}</p>
          <p className="max-w-[340px] text-[13.5px] t2">
            {q
              ? '换个关键词试试，或清空搜索框。'
              : '在上方输入框写下第一条笔记；也可以用右下角的悬浮速记随时记录，支持 Markdown 与图片粘贴。'}
          </p>
        </div>
      ) : (
        <div className="gap-3.5 [column-gap:0.875rem] sm:columns-2 xl:columns-3">
          {list.map((n, i) => (
            <NoteCard
              key={n.id}
              note={n}
              index={i}
              onOpen={() => setViewingId(n.id)}
              onEdit={() => setEditing(n)}
              onPin={() => togglePinNote(n.id)}
              onRemove={() => removeNote(n.id)}
            />
          ))}
        </div>
      )}

      {viewing && (
        <NoteView
          note={viewing}
          onEdit={() => {
            setEditing(viewing)
            setViewingId(null)
          }}
          onPin={() => togglePinNote(viewing.id)}
          onRemove={() => {
            removeNote(viewing.id)
            setViewingId(null)
          }}
          onClose={() => setViewingId(null)}
        />
      )}

      {editing && <NoteEditor note={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function NoteCard({
  note,
  index,
  onOpen,
  onEdit,
  onPin,
  onRemove,
}: {
  note: Note
  index: number
  onOpen: () => void
  onEdit: () => void
  onPin: () => void
  onRemove: () => void
}) {
  const title = noteTitle(note)
  const summary = noteSummary(note.content)
  const showSummary = summary && summary !== title
  const withImage = hasImage(note.content)

  return (
    <article
      onClick={onOpen}
      className="glass sheen group relative mb-3.5 block break-inside-avoid animate-fade-up cursor-pointer overflow-hidden rounded-[20px] p-4 transition-all duration-300 hover:-translate-y-0.5"
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
    >
      <span className="absolute inset-y-3 left-0 w-[3px] rounded-full" style={{ background: note.color }} />

      <div className="flex items-start gap-2 pl-2.5">
        <h3 className="min-w-0 flex-1 break-words font-display text-[15.5px] font-semibold leading-snug t1">
          {title}
        </h3>
        <div className="flex shrink-0 items-center gap-1">
          {withImage && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-1.5 py-[1px] text-[10px] font-bold"
              style={{ background: `color-mix(in srgb, ${note.color} 16%, transparent)`, color: note.color }}
            >
              图片
            </span>
          )}
          {note.pinned && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-1.5 py-[1px] text-[10px] font-bold"
              style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
            >
              <IconPin size={10} />
              置顶
            </span>
          )}
        </div>
      </div>

      {showSummary && (
        <p className="mt-1.5 line-clamp-1 pl-2.5 text-[13px] leading-relaxed t2">{summary}</p>
      )}

      <div className="mt-3 flex items-center gap-1 pl-2.5 text-[11.5px] t3">
        <span>创建于 {formatDate(note.createdAt)}</span>
        <div className="ml-auto flex items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <button
            className="btn-icon !min-h-[30px] !min-w-[30px]"
            aria-label={note.pinned ? '取消置顶' : '置顶'}
            onClick={(e) => {
              e.stopPropagation()
              onPin()
            }}
          >
            <IconPin size={14} />
          </button>
          <button
            className="btn-icon !min-h-[30px] !min-w-[30px]"
            aria-label="编辑笔记"
            onClick={(e) => {
              e.stopPropagation()
              onEdit()
            }}
          >
            <IconPencil size={14} />
          </button>
          <button
            className="btn-icon !min-h-[30px] !min-w-[30px] hover:!text-[var(--danger)]"
            aria-label="删除笔记"
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
            }}
          >
            <IconTrash size={14} />
          </button>
        </div>
      </div>
    </article>
  )
}

async function imageMarkdown(file: File): Promise<string> {
  try {
    const url = await imageToDataUrl(file)
    return `![图片](${url})`
  } catch {
    const url = await fileToDataUrl(file)
    return `![图片](${url})`
  }
}

function NoteView({
  note,
  onEdit,
  onPin,
  onRemove,
  onClose,
}: {
  note: Note
  onEdit: () => void
  onPin: () => void
  onRemove: () => void
  onClose: () => void
}) {
  const title = noteTitle(note)
  const edited = note.updatedAt - note.createdAt > 60_000

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="animate-pop-in flex max-h-[88vh] w-full max-w-[720px] flex-col overflow-hidden rounded-[24px] border border-line shadow-lift"
        style={{ background: 'var(--ink-800)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2.5 border-b border-line px-5 py-4">
          <span className="h-9 w-1 shrink-0 rounded-full" style={{ background: note.color }} />
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-display text-[18px] font-bold t1">{title}</h3>
            <p className="mt-0.5 truncate text-[11.5px] t3">
              创建于 {formatDate(note.createdAt)}
              {edited ? ` · 更新于 ${formatDate(note.updatedAt)}` : ''}
            </p>
          </div>
          <button
            className={cn('btn-icon', note.pinned && '!text-[var(--accent)]')}
            aria-label={note.pinned ? '取消置顶' : '置顶'}
            title={note.pinned ? '取消置顶' : '置顶'}
            onClick={onPin}
          >
            <IconPin size={16} />
          </button>
          <button
            className="btn-icon hover:!text-[var(--danger)]"
            aria-label="删除笔记"
            title="删除"
            onClick={onRemove}
          >
            <IconTrash size={16} />
          </button>
          <button className="btn-icon" aria-label="关闭" onClick={onClose}>
            <IconX size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7">
          {note.content.trim() ? (
            <Markdown text={note.content} />
          ) : (
            <p className="text-[13.5px] t3">（这篇笔记还没有内容）</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-line px-5 py-3.5">
          <span className="text-[11.5px] t3">{hasImage(note.content) ? '含图片' : '纯文本'}</span>
          <button
            className="btn btn-primary ml-auto !min-h-[38px] !rounded-[13px] text-sm"
            onClick={onEdit}
          >
            <IconPencil size={15} />
            编辑
          </button>
        </div>
      </div>
    </div>
  )
}

function NoteEditor({ note, onClose }: { note: Note; onClose: () => void }) {
  const { updateNote, removeNote, togglePinNote } = useApp()
  const [title, setTitle] = useState(note.title)
  const [content, setContent] = useState(note.content)
  const [color, setColor] = useState(note.color)
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function insertAtCursor(text: string) {
    const ta = taRef.current
    const start = ta?.selectionStart ?? content.length
    const end = ta?.selectionEnd ?? content.length
    const next = content.slice(0, start) + text + content.slice(end)
    setContent(next)
    const pos = start + text.length
    requestAnimationFrame(() => {
      ta?.focus()
      ta?.setSelectionRange(pos, pos)
    })
  }

  async function addImage(file: File) {
    const md = await imageMarkdown(file)
    insertAtCursor(`\n${md}\n`)
  }

  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const file = imageFromClipboard(e)
    if (!file) return
    e.preventDefault()
    void addImage(file)
  }

  function save() {
    updateNote(note.id, { title: title.trim(), content: content.trim(), color })
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="animate-pop-in flex h-[80vh] max-h-[900px] w-full max-w-[680px] flex-col overflow-hidden rounded-[24px] border border-line p-5 shadow-lift"
        style={{ background: 'var(--ink-800)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex shrink-0 items-center gap-2">
          <h3 className="font-display text-[17px] font-bold t1">编辑笔记</h3>
          <button
            className={cn('btn-icon !min-h-[32px] !min-w-[32px]', note.pinned && '!text-[var(--accent)]')}
            aria-label={note.pinned ? '取消置顶' : '置顶'}
            title={note.pinned ? '取消置顶' : '置顶'}
            onClick={() => {
              togglePinNote(note.id)
              onClose()
            }}
          >
            <IconPin size={16} />
          </button>
          <div className="ml-auto flex items-center gap-1 rounded-xl border border-line p-0.5">
            {(['edit', 'preview'] as const).map((m) => (
              <button
                key={m}
                className={cn(
                  'rounded-lg px-2.5 py-1 text-[12.5px] font-semibold transition-colors',
                  mode === m ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 't3 hover:t1'
                )}
                onClick={() => setMode(m)}
              >
                {m === 'edit' ? '编辑' : '预览'}
              </button>
            ))}
          </div>
          <button className="btn-icon" aria-label="关闭" onClick={onClose}>
            <IconX size={18} />
          </button>
        </div>

        <input
          className="field shrink-0 !min-h-[42px] text-[15px] font-semibold"
          placeholder="笔记名称（留空则自动取正文首行）"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        <div className="mt-2.5 flex min-h-0 flex-1 flex-col">
          {mode === 'edit' ? (
            <textarea
              ref={taRef}
              autoFocus
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onPaste={onPaste}
              placeholder="支持 Markdown：# 标题、**加粗**、*斜体*、- 列表项；图片可直接粘贴"
              className="field min-h-0 flex-1 resize-none font-mono text-[13.5px] leading-relaxed"
            />
          ) : (
            <div
              className="min-h-0 flex-1 overflow-y-auto rounded-[13px] border border-line p-4"
              style={{ background: 'color-mix(in srgb, var(--ink-900) 55%, transparent)' }}
            >
              {content.trim() ? (
                <Markdown text={content} />
              ) : (
                <p className="text-[13.5px] t3">（还没有内容）</p>
              )}
            </div>
          )}
        </div>

        <div className="mt-3 flex shrink-0 flex-wrap items-center gap-2">
          {NOTE_COLORS.map((c) => (
            <button
              key={c}
              aria-label={`颜色 ${c}`}
              onClick={() => setColor(c)}
              className={cn(
                'h-6 w-6 rounded-full border-2 transition-transform',
                color === c ? 'scale-110 border-[var(--text-1)]' : 'border-transparent'
              )}
              style={{ background: c }}
            />
          ))}
          <button
            className="chip-btn ml-1"
            onClick={() => fileRef.current?.click()}
            title="选择图片插入"
          >
            <IconPlus size={13} />
            插入图片
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void addImage(f)
              e.target.value = ''
            }}
          />
        </div>

        <div className="mt-4 flex shrink-0 items-center gap-2">
          <button
            className="btn btn-ghost !min-h-[40px] !rounded-[13px] hover:!text-[var(--danger)]"
            onClick={() => {
              removeNote(note.id)
              onClose()
            }}
          >
            <IconTrash size={15} />
            删除
          </button>
          <button className="btn btn-primary ml-auto !min-h-[40px] !rounded-[13px]" onClick={save}>
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
