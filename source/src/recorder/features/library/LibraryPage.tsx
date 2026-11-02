import { useEffect, useMemo, useRef, useState } from 'react'
import { useLibraryStore } from '@renderer/state/library'
import type { FileJob } from '@renderer/state/library'
import { formatBytes, formatDateTime, formatDuration } from '@renderer/lib/format'
import { speakerColor, speakerLabel } from '@renderer/lib/speakers'
import { cn } from '@renderer/lib/cn'
import {
  ChevronIcon,
  FolderIcon,
  LibraryIcon,
  MicIcon,
  SearchIcon,
  TextIcon,
  TrashIcon,
  WaveIcon
} from '@renderer/components/Icons'

export function LibraryPage({ onEdit }: { onEdit: (id: string) => void }): JSX.Element {
  const items = useLibraryStore((s) => s.items)
  const loading = useLibraryStore((s) => s.loading)
  const refresh = useLibraryStore((s) => s.refresh)
  const remove = useLibraryStore((s) => s.remove)
  const rename = useLibraryStore((s) => s.rename)
  const reveal = useLibraryStore((s) => s.reveal)
  const jobs = useLibraryStore((s) => s.jobs)
  const transcribe = useLibraryStore((s) => s.transcribe)
  const cancelTranscribe = useLibraryStore((s) => s.cancelTranscribe)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  /** IPC 操作统一入口：失败时显示错误横幅，而不是被 void 吞掉 */
  const run = (fn: () => Promise<unknown>): void => {
    void fn().catch((e: unknown) => setActionError(e instanceof Error ? e.message : String(e)))
  }

  useEffect(() => {
    run(refresh)
    void useLibraryStore.getState().syncJobs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh])

  // 某条录音转写完成：自动展开它的转写内容，接着刚才的实时文本看
  const runningRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const now = new Set(
      Object.entries(jobs)
        .filter(([, j]) => j.phase === 'queued' || j.phase === 'running')
        .map(([id]) => id)
    )
    for (const id of runningRef.current) {
      if (now.has(id)) continue
      if (useLibraryStore.getState().items.find((i) => i.id === id)?.hasTranscript) {
        setExpandedId(id)
      }
    }
    runningRef.current = now
  }, [jobs])

  /** 文本检索：匹配名称或转写内容。 */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter(
      (it) =>
        it.name.toLowerCase().includes(q) || (it.transcript?.text ?? '').toLowerCase().includes(q)
    )
  }, [items, query])

  const commitRename = async (id: string): Promise<void> => {
    const name = draft.trim()
    setEditingId(null)
    if (name) run(() => rename(id, name))
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto px-8 py-7 max-md:px-4 max-md:py-5">
      <div className="flex items-center justify-between gap-4 max-md:flex-col max-md:items-stretch max-md:gap-3">
        <div>
          <h1 className="text-[19px] font-semibold text-sr-ink">资料库</h1>
          <p className="mt-0.5 text-[12px] text-sr-ink-faint">
            {query.trim() ? `匹配 ${filtered.length} / ${items.length} 条` : `共 ${items.length} 条速录`}
            {' · '}存储于本机
          </p>
        </div>
        <div className="flex items-center gap-2 max-md:flex-wrap">
          <div className="relative max-md:min-w-0 max-md:flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sr-ink-faint">
              <SearchIcon width={15} height={15} />
            </span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索名称或转写内容"
              className="h-9 w-60 rounded-xl border border-sr-line bg-sr-surface pl-9 pr-3 text-[12.5px] text-sr-ink outline-none transition-colors placeholder:text-sr-ink-faint focus:border-sr-accent/50 max-md:w-full"
            />
          </div>
          <button
            onClick={() => run(refresh)}
            className="h-9 rounded-xl border border-sr-line px-3.5 text-[12px] text-sr-ink-muted transition-colors hover:text-sr-ink"
          >
            刷新
          </button>
        </div>
      </div>

      {actionError && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-sr-rec/40 bg-sr-rec/10 px-3 py-2 text-[12px] text-sr-rec">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="shrink-0 text-sr-ink-muted">
            关闭
          </button>
        </div>
      )}

      {items.length === 0 && !loading && (
        <div className="mt-16 flex flex-col items-center gap-3 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-sr-line bg-sr-surface text-sr-ink-faint">
            <LibraryIcon width={22} height={22} />
          </span>
          <p className="text-[13px] text-sr-ink-faint">还没有速录。去「速录」页开始第一条吧。</p>
        </div>
      )}

      {items.length > 0 && filtered.length === 0 && (
        <div className="mt-16 flex flex-col items-center gap-3 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-sr-line bg-sr-surface text-sr-ink-faint">
            <SearchIcon width={22} height={22} />
          </span>
          <p className="text-[13px] text-sr-ink-faint">没有匹配「{query.trim()}」的速录或转写内容。</p>
        </div>
      )}

      <ul className="mt-5 flex flex-col gap-2">
        {filtered.map((item) => (
          <li
            key={item.id}
            className="rounded-xl border border-sr-line/70 bg-sr-surface/60 px-4 py-3 transition-colors hover:border-sr-line hover:bg-sr-surface"
          >
            <div className="group flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sr-accent-soft text-sr-accent">
                <MicIcon width={18} height={18} />
              </span>

              <div className="min-w-0 flex-1">
                {editingId === item.id ? (
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => void commitRename(item.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void commitRename(item.id)
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                    className="h-7 w-full rounded-md border border-sr-accent/40 bg-sr-elevated px-2 text-[13px] text-sr-ink outline-none"
                  />
                ) : (
                  <button
                    onDoubleClick={() => {
                      setEditingId(item.id)
                      setDraft(item.name)
                    }}
                    className="block max-w-full truncate text-left text-[13px] text-sr-ink"
                    title="双击重命名"
                  >
                    {item.name}
                  </button>
                )}
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-sr-ink-faint">
                  <span className="tabular">{formatDuration(item.durationMs)}</span>
                  <span>·</span>
                  <span>{formatBytes(item.bytes)}</span>
                  <span>·</span>
                  <span>{formatDateTime(item.createdAt)}</span>
                  {item.tracks && item.tracks.length > 1 && (
                    <span
                      className="rounded bg-sr-elevated px-1.5 py-0.5 text-sr-ink-muted"
                      title={item.tracks.map((t) => `${t.name} · ${formatBytes(t.bytes)}`).join('\n')}
                    >
                      {item.tracks.length} 轨
                    </span>
                  )}
                  <TranscribeChips
                    hasTranscript={!!item.hasTranscript}
                    job={jobs[item.id]}
                    expanded={expandedId === item.id}
                    onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
                    onRun={() => void transcribe(item.id)}
                    onCancel={() => run(() => cancelTranscribe(item.id))}
                  />
                  {item.tags.includes('recovered') && (
                    <span className="rounded bg-sr-warn-soft px-1.5 py-0.5 text-sr-warn">
                      已恢复
                    </span>
                  )}
                  {item.hasDenoised && (
                    <span className="rounded bg-sr-accent-soft px-1.5 py-0.5 text-sr-accent">已降噪</span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 max-md:opacity-100">
                <IconButton label="编辑" onClick={() => onEdit(item.id)}>
                  <WaveIcon width={16} height={16} />
                </IconButton>
                <IconButton label="在文件夹中显示" onClick={() => run(() => reveal(item.id))}>
                  <FolderIcon width={16} height={16} />
                </IconButton>
                {confirmId === item.id ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        run(() => remove(item.id))
                        setConfirmId(null)
                      }}
                      className="rounded-lg bg-sr-rec px-2.5 py-1.5 text-[11px] text-white"
                    >
                      确认删除
                    </button>
                    <button
                      onClick={() => setConfirmId(null)}
                      className="rounded-lg border border-sr-line px-2.5 py-1.5 text-[11px] text-sr-ink-muted"
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <IconButton label="删除" danger onClick={() => setConfirmId(item.id)}>
                    <TrashIcon width={16} height={16} />
                  </IconButton>
                )}
              </div>
            </div>

            {/* 转写进行中：识别多少就显示多少，不等全部完成 */}
            <LiveTranscript job={jobs[item.id]} />

            {expandedId === item.id && item.transcript?.text && (
              <div className="mt-3 border-t border-sr-line/60 pt-3">
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-sr-ink-muted">
                  {item.transcript.text}
                </p>
                {item.transcript.segments.length > 0 && (
                  <ul className="mt-3 flex flex-col gap-1.5">
                    {item.transcript.segments.map((seg, i, arr) => {
                      const sp = typeof seg.speaker === 'number' ? seg.speaker : null
                      const showSpeaker = sp !== null && sp !== arr[i - 1]?.speaker
                      return (
                        <li key={`${seg.startMs}-${i}`} className="flex gap-2 text-[12px]">
                          <span className="tabular shrink-0 text-sr-ink-faint">
                            {formatDuration(seg.startMs)}
                          </span>
                          {showSpeaker && (
                            <span
                              className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
                              style={{ background: speakerColor(sp) }}
                            >
                              {speakerLabel(sp)}
                            </span>
                          )}
                          <span className="text-sr-ink-muted">{seg.text}</span>
                        </li>
                      )
                    })}
                  </ul>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-sr-ink-faint">
                  <span>模型 {item.transcript.model}</span>
                  {item.transcript.silences.length > 0 && (
                    <span>· 静音 {item.transcript.silences.length} 段</span>
                  )}
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function IconButton({
  children,
  onClick,
  label,
  danger
}: {
  children: React.ReactNode
  onClick: () => void
  label: string
  danger?: boolean
}): JSX.Element {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-lg text-sr-ink-muted transition-colors',
        danger ? 'hover:bg-sr-rec-soft hover:text-sr-rec' : 'hover:bg-sr-elevated hover:text-sr-ink'
      )}
    >
      {children}
    </button>
  )
}

/**
 * 转写行内控件：
 *  - 已有转写结果 → 「转写」展开开关；
 *  - 还没有结果 → 「语音转文字」，点击后在后台排队 / 并发转写；
 *  - 正在转写 → 进度与取消；
 *  - 失败 → 带上原因的「重试」。
 */
function TranscribeChips({
  hasTranscript,
  job,
  expanded,
  onToggle,
  onRun,
  onCancel
}: {
  hasTranscript: boolean
  job?: FileJob
  expanded: boolean
  onToggle: () => void
  onRun: () => void
  onCancel: () => void
}): JSX.Element {
  if (job && (job.phase === 'queued' || job.phase === 'running')) {
    return (
      <>
        <span className="flex items-center gap-1.5 rounded bg-sr-accent-soft px-1.5 py-0.5 text-sr-accent">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sr-accent" />
          {job.phase === 'queued' ? '排队中' : `转写中${progressLabel(job)}`}
        </span>
        <button
          onClick={onCancel}
          className="rounded px-1.5 py-0.5 text-sr-ink-muted transition-colors hover:bg-sr-elevated hover:text-sr-ink"
        >
          取消
        </button>
      </>
    )
  }

  if (job?.phase === 'error') {
    return (
      <button
        onClick={onRun}
        title={job.error}
        className="rounded bg-sr-warn-soft px-1.5 py-0.5 text-sr-warn transition-opacity hover:opacity-80"
      >
        转写失败 · 重试
      </button>
    )
  }

  return (
    <>
      {job?.phase === 'empty' && (
        <span className="rounded bg-sr-elevated px-1.5 py-0.5 text-sr-ink-faint">未识别到文字</span>
      )}
      {hasTranscript ? (
        <button
          onClick={onToggle}
          className={cn(
            'flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors',
            expanded ? 'bg-sr-accent-soft text-sr-accent' : 'bg-sr-elevated text-sr-ink-muted hover:text-sr-ink'
          )}
        >
          <TextIcon width={12} height={12} />
          转写
          <ChevronIcon width={11} height={11} className={cn('transition-transform', expanded ? 'rotate-90' : '')} />
        </button>
      ) : (
        <button
          onClick={onRun}
          title="在后台把这条速录转成文字，可以和其他速录同时转"
          className="flex items-center gap-1 rounded bg-sr-elevated px-1.5 py-0.5 text-sr-ink-muted transition-colors hover:bg-sr-accent-soft hover:text-sr-accent"
        >
          <TextIcon width={12} height={12} />
          语音转文字
        </button>
      )}
    </>
  )
}

/** 转写进行中的实时文本。 */
function LiveTranscript({ job }: { job?: FileJob }): JSX.Element | null {
  if (!job || (job.phase !== 'queued' && job.phase !== 'running')) return null
  const shown = `${job.text}${job.pending}`
  const pct = job.durationMs > 0 ? Math.min(99, Math.round((job.progressMs / job.durationMs) * 100)) : null
  return (
    <div className="mt-3 border-t border-sr-line/60 pt-3">
      <p className="text-[11px] text-sr-ink-faint">
        {job.phase === 'queued' ? '排队等待转写…' : '正在转写…'}
        {pct !== null && <span className="tabular"> · {pct}%</span>}
        <span> · 已识别 {shown.length} 字</span>
      </p>
      {pct !== null && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-sr-elevated">
          <div
            className="h-full rounded-full bg-sr-accent transition-[width] duration-200"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-sr-ink-muted">
        {shown || <span className="text-sr-ink-faint">还没听到内容…</span>}
        <span className="ml-0.5 inline-block h-[13px] w-[2px] translate-y-[2px] animate-pulse bg-sr-accent align-middle" />
      </p>
    </div>
  )
}

function progressLabel(job: FileJob): string {
  if (job.durationMs <= 0) return ''
  return ` ${Math.min(99, Math.round((job.progressMs / job.durationMs) * 100))}%`
}
