import { useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin, { type Region } from 'wavesurfer.js/dist/plugins/regions.js'
import { useEditorStore } from '@renderer/state/editor'
import { useLibraryStore } from '@renderer/state/library'
import { editorPlayer } from '@renderer/editing/player'
import { disposeEditor, editorOps, exportProject } from '@renderer/editing/controller'
import type { LoudnessTarget } from '@shared/ipc'
import type { Project, Track } from '@renderer/editing/project'
import {
  DEFAULT_COMPRESSOR,
  DEFAULT_EQ,
  DEFAULT_REVERB,
  hasEffects,
  type TrackEffects
} from '@renderer/editing/effects'
import { formatDuration, formatTimer } from '@renderer/lib/format'
import { cn } from '@renderer/lib/cn'
import { themeColor, useUiStore } from '@renderer/state/ui'
import { PauseIcon, PlayIcon, TrashIcon } from '@renderer/components/Icons'

const RATES = [0.5, 1, 1.25, 1.5, 2]

export function EditorPage({ onBack }: { onBack: () => void }): JSX.Element {
  const meta = useEditorStore((s) => s.meta)
  const status = useEditorStore((s) => s.status)
  const error = useEditorStore((s) => s.error)
  const renderedUrl = useEditorStore((s) => s.renderedUrl)
  const selection = useEditorStore((s) => s.selection)
  const playing = useEditorStore((s) => s.playing)
  const rate = useEditorStore((s) => s.rate)
  const duration = useEditorStore((s) => s.duration)
  const canUndo = useEditorStore((s) => s.past.length > 0)
  const canRedo = useEditorStore((s) => s.future.length > 0)
  const exporting = useEditorStore((s) => s.exporting)
  const denoiseBusy = useEditorStore((s) => s.denoiseBusy)
  const repairCount = useEditorStore((s) => s.repairCount)
  const project = useEditorStore((s) => s.project)
  const activeTrackId = useEditorStore((s) => s.activeTrackId)

  const containerRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WaveSurfer | null>(null)
  const regionsRef = useRef<RegionsPlugin | null>(null)
  const [time, setTime] = useState(0)
  const [denoiseMsg, setDenoiseMsg] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [effectsTrackId, setEffectsTrackId] = useState<string | null>(null)
  const [loudness, setLoudness] = useState<LoudnessTarget>('off')

  // 降噪状态（首次会加载模型，给出明确反馈）
  useEffect(
    () =>
      window.api.denoise.onStatus((e) => {
        if (e.state === 'loading') setDenoiseMsg('加载降噪模型…')
        else if (e.state === 'working') setDenoiseMsg('正在降噪…')
        else if (e.state === 'error') setDenoiseMsg(e.message ?? '降噪失败')
        else setDenoiseMsg(null)
      }),
    []
  )

  // 主题切换时同步 WaveSurfer 配色
  const scheme = useUiStore((s) => s.scheme)
  useEffect(() => {
    wsRef.current?.setOptions({
      waveColor: themeColor('--ws-wave'),
      progressColor: themeColor('--c-accent'),
      cursorColor: themeColor('--c-ink')
    })
  }, [scheme])

  // 创建 WaveSurfer（仅一次）；颜色取当前主题令牌，主题切换时由上方 effect 同步
  useEffect(() => {
    if (!containerRef.current) return
    const regions = RegionsPlugin.create()
    const ws = WaveSurfer.create({
      container: containerRef.current,
      height: 136,
      waveColor: themeColor('--ws-wave'),
      progressColor: themeColor('--c-accent'),
      cursorColor: themeColor('--c-ink'),
      cursorWidth: 2,
      normalize: true,
      barWidth: 2,
      barGap: 1,
      barRadius: 2
    })
    ws.registerPlugin(regions)
    regions.enableDragSelection({ color: themeColor('--c-accent', 0.16) })
    wsRef.current = ws
    regionsRef.current = regions

    regions.on('region-created', (region: Region) => {
      regions.getRegions().forEach((r) => {
        if (r.id !== region.id) r.remove()
      })
      useEditorStore.getState().setSelection([region.start, region.end])
    })
    ws.on('play', () => useEditorStore.getState().setPlaying(true))
    ws.on('pause', () => useEditorStore.getState().setPlaying(false))
    ws.on('finish', () => useEditorStore.getState().setPlaying(false))
    ws.on('timeupdate', (t) => setTime(t))
    ws.on('ready', () => ws.setPlaybackRate(useEditorStore.getState().rate))

    editorPlayer.play = () => void ws.play()
    editorPlayer.pause = () => ws.pause()
    editorPlayer.toggle = () => void ws.playPause()
    editorPlayer.setRate = (r) => ws.setPlaybackRate(r)
    editorPlayer.seek = (t) => ws.setTime(t)
    editorPlayer.getTime = () => ws.getCurrentTime()

    return () => {
      ws.destroy()
      // 卸载时回收渲染 Blob 与解码缓存，避免大 WAV 常驻内存
      disposeEditor()
      wsRef.current = null
      regionsRef.current = null
      editorPlayer.play = () => undefined
      editorPlayer.pause = () => undefined
      editorPlayer.toggle = () => undefined
      editorPlayer.setRate = () => undefined
      editorPlayer.seek = () => undefined
      editorPlayer.getTime = () => 0
    }
  }, [])

  // 渲染结果变化时载入波形
  useEffect(() => {
    const ws = wsRef.current
    if (!ws || !renderedUrl) return
    regionsRef.current?.clearRegions()
    useEditorStore.getState().setSelection(null)
    ws.load(renderedUrl).catch((e: unknown) => {
      // URL 可能已被延后回收，失败时提示而不是静默
      useEditorStore.getState().setError(`波形加载失败：${(e as Error)?.message ?? e}`)
    })
  }, [renderedUrl])

  const changeRate = (r: number): void => {
    useEditorStore.getState().setRate(r)
    editorPlayer.setRate(r)
  }

  const busy = status === 'loading' || status === 'rendering' || denoiseBusy
  /** 多轨录音（一次会话多路同时采集）：仅首轨可降噪，故整体禁用 */
  const multiTrack = !!meta?.tracks && meta.tracks.length > 1

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 px-8 pt-6 pb-4 max-md:flex-wrap max-md:gap-2 max-md:px-4 max-md:pt-4">
        <button
          onClick={onBack}
          className="rounded-lg border border-sr-line px-3 py-1.5 text-[12px] text-sr-ink-muted transition-colors hover:text-sr-ink"
        >
          ← 资料库
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-[15px] font-medium text-sr-ink">{meta?.name ?? '编辑'}</h1>
          <p className="text-[11px] text-sr-ink-faint">
            {busy
              ? '处理中…'
              : `${multiTrack ? `多轨 ${project?.tracks.length ?? 0} · ` : ''}时长 ${formatTimer(
                  duration * 1000
                )} · 非破坏性编辑${project?.repair ? ` · 已修复 ${repairCount} 处爆音` : ''}`}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2 max-md:ml-0 max-md:w-full max-md:flex-wrap">
          {/* 修复爆音开关（工程级，开启即重渲染） */}
          <button
            onClick={() => void editorOps.setRepair(!project?.repair)}
            disabled={busy || exporting}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-[12px] transition-colors disabled:opacity-50',
              project?.repair
                ? 'border-sr-accent/50 bg-sr-accent/15 text-sr-ink hover:bg-sr-accent/20'
                : 'border-sr-line text-sr-ink-muted hover:text-sr-ink'
            )}
            title="检测并修复咔哒 / 爆音（对最终混音逐声道插值修复，不改动原始素材）"
          >
            修复爆音
          </button>
          {/* 导出响度标准化（EBU R128 两段式 loudnorm，依赖 ffmpeg） */}
          <label className="flex items-center gap-1.5 text-[11px] text-sr-ink-faint">
            响度
            <select
              value={loudness}
              onChange={(e) => setLoudness(e.target.value as LoudnessTarget)}
              disabled={busy || exporting}
              className="rounded-md border border-sr-line bg-sr-surface px-2 py-1.5 text-[12px] text-sr-ink-muted outline-none transition-colors hover:text-sr-ink disabled:opacity-50"
              title="导出时把整体响度标准化到目标 LUFS（ podcast 常用 -16，流媒体常用 -14）"
            >
              <option value="off">不处理</option>
              <option value="-16">-16 LUFS</option>
              <option value="-14">-14 LUFS</option>
            </select>
          </label>
          <button
            onClick={() => void exportProject('wav', loudness)}
            disabled={busy || exporting}
            className="rounded-lg border border-sr-line px-3 py-1.5 text-[12px] text-sr-ink-muted transition-colors hover:text-sr-ink disabled:opacity-50"
          >
            导出 WAV
          </button>
          <button
            onClick={() => void exportProject('mp3', loudness)}
            disabled={busy || exporting}
            className="rounded-lg bg-sr-accent px-3.5 py-1.5 text-[12px] font-medium text-white transition-all hover:brightness-110 disabled:opacity-50"
          >
            导出 MP3
          </button>
        </div>
      </header>

      {error && (
        <div className="mx-8 mb-3 rounded-xl border border-sr-warn/25 bg-sr-warn-soft px-4 py-3 text-[13px] text-sr-warn max-md:mx-4">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8 max-md:px-4 max-md:pb-6">
        {/* 轨道 */}
        {project && (
          <div className="mb-4 rounded-2xl border border-sr-line/70 bg-sr-surface/40 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wider text-sr-ink-faint">
                轨道 · {project.tracks.length}
              </span>
              <button
                onClick={() => setPickerOpen(true)}
                disabled={busy}
                className="rounded-lg border border-sr-line px-2.5 py-1 text-[12px] text-sr-ink-muted transition-colors hover:text-sr-ink disabled:opacity-50"
              >
                + 添加轨道
              </button>
            </div>
            <div className="flex flex-col gap-1.5">
              {project.tracks.map((t) => (
                <TrackRow
                  key={t.id}
                  track={t}
                  active={t.id === activeTrackId}
                  canRemove={project.tracks.length > 1}
                  onSelect={() => editorOps.setActiveTrack(t.id)}
                  onMute={() => void editorOps.toggleMute(t.id)}
                  onSolo={() => void editorOps.toggleSolo(t.id)}
                  onRemove={() => void editorOps.removeTrack(t.id)}
                  onEffects={() => setEffectsTrackId(t.id)}
                  onGainLive={(id, g) => void editorOps.setTrackGainLive(id, g)}
                  onNudge={(id, d) => void editorOps.nudgeOffset(id, d)}
                  onCommit={(prev) => editorOps.commitHistory(prev)}
                />
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-sr-ink-faint">
              编辑操作（裁剪 / 分割 / 增益 / 淡入淡出）作用于
              <b className="text-sr-ink-muted">选中轨道</b>；存在独奏轨道时只播放独奏轨道。
              {project.tracks.length > 1 &&
                '「起点」用于微调各轨开始时间（多设备同时速录存在时钟差，长时间录制可能出现毫秒级错位）。'}
            </p>
          </div>
        )}

        {/* 波形 */}
        <div className="rounded-2xl border border-sr-line/70 bg-sr-canvas p-3">
          <div ref={containerRef} className="w-full" />
          {!renderedUrl && busy && (
            <div className="flex h-[136px] items-center justify-center text-[13px] text-sr-ink-faint">
              正在加载波形…
            </div>
          )}
        </div>

        {/* 播放控制 */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={() => editorPlayer.toggle()}
            disabled={busy}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-sr-accent text-white transition-transform hover:brightness-110 active:scale-95 disabled:opacity-50"
          >
            {playing ? <PauseIcon width={18} height={18} /> : <PlayIcon width={18} height={18} />}
          </button>
          <span className="tabular text-[13px] text-sr-ink-muted">
            {formatTimer(time * 1000)} / {formatTimer(duration * 1000)}
          </span>
          <div className="ml-4 flex items-center gap-1 max-md:ml-0">
            <span className="mr-1 text-[11px] text-sr-ink-faint">倍速</span>
            {RATES.map((r) => (
              <button
                key={r}
                onClick={() => changeRate(r)}
                className={cn(
                  'rounded-md px-2 py-1 text-[12px] transition-colors',
                  rate === r ? 'bg-sr-accent-soft text-sr-accent' : 'text-sr-ink-muted hover:text-sr-ink'
                )}
              >
                {r}×
              </button>
            ))}
          </div>
        </div>

        {/* 编辑工具栏 */}
        <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-4">
          <ToolGroup title="选区">
            <ToolButton disabled={!selection || busy} onClick={() => void editorOps.trimToSelection()}>
              裁剪到选区
            </ToolButton>
            <ToolButton
              variant="danger"
              disabled={!selection || busy}
              onClick={() => void editorOps.deleteSelection()}
            >
              删除选区
            </ToolButton>
          </ToolGroup>

          <ToolGroup title="分割">
            <ToolButton disabled={busy} onClick={() => void editorOps.splitAtPlayhead()}>
              在播放头分割
            </ToolButton>
          </ToolGroup>

          <ToolGroup title="包络">
            <ToolButton disabled={busy} onClick={() => void editorOps.fadeIn(1)}>
              淡入 1s
            </ToolButton>
            <ToolButton disabled={busy} onClick={() => void editorOps.fadeOut(1)}>
              淡出 1s
            </ToolButton>
          </ToolGroup>

          <ToolGroup title="音量">
            <ToolButton disabled={busy} onClick={() => void editorOps.gain(1.25)}>
              +25%
            </ToolButton>
            <ToolButton disabled={busy} onClick={() => void editorOps.gain(0.8)}>
              -20%
            </ToolButton>
          </ToolGroup>

          <ToolGroup title="语音增强">
            {multiTrack ? (
              <ToolButton
                disabled
                onClick={() => void editorOps.denoise()}
                title="多轨速录暂不支持整体降噪（只降噪一路会破坏各轨对齐）；可导出单轨后逐轨处理，或使用「修复爆音」"
              >
                离线降噪（多轨不支持）
              </ToolButton>
            ) : meta?.hasDenoised ? (
              <ToolButton disabled={busy} onClick={() => void editorOps.revertDenoise()}>
                还原原声
              </ToolButton>
            ) : (
              <ToolButton disabled={busy} onClick={() => void editorOps.denoise()}>
                {denoiseBusy ? denoiseMsg ?? '降噪中…' : '离线降噪'}
              </ToolButton>
            )}
          </ToolGroup>
        </div>

        {meta?.hasDenoised && (
          <p className="mt-3 flex items-center gap-1.5 text-[12px] text-sr-accent">
            <span className="h-1.5 w-1.5 rounded-full bg-sr-accent" />
            当前使用降噪版本（原始文件已保留，可随时「还原原声」）
          </p>
        )}

        {/* 历史 */}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <ToolButton disabled={!canUndo || busy} onClick={() => void editorOps.undo()}>
            撤销
          </ToolButton>
          <ToolButton disabled={!canRedo || busy} onClick={() => void editorOps.redo()}>
            重做
          </ToolButton>
          <ToolButton disabled={busy} onClick={() => void editorOps.restore()}>
            还原全部
          </ToolButton>
          {selection && (
            <span className="ml-auto text-[12px] text-sr-accent">
              已选 {formatTimer(selection[0] * 1000)} – {formatTimer(selection[1] * 1000)}
            </span>
          )}
        </div>

        <p className="mt-6 text-[11px] leading-relaxed text-sr-ink-faint">
          原始速录不会被修改；所有操作仅作用于工程，导出时才生成新文件。
          在波形上拖动即可创建选区。
        </p>
      </div>

      {pickerOpen && <AddTrackDialog onClose={() => setPickerOpen(false)} />}
      {effectsTrackId && project && (
        <EffectsDialog
          track={project.tracks.find((t) => t.id === effectsTrackId) ?? null}
          onClose={() => setEffectsTrackId(null)}
        />
      )}
    </div>
  )
}

function ToolGroup({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="rounded-xl border border-sr-line/70 bg-sr-surface/50 p-3">
      <div className="mb-2 text-[11px] uppercase tracking-wider text-sr-ink-faint">{title}</div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  )
}

function ToolButton({
  children,
  onClick,
  disabled,
  variant,
  title
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  variant?: 'danger'
  title?: string
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'rounded-lg border px-3 py-1.5 text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        variant === 'danger'
          ? 'border-sr-rec/30 text-sr-rec hover:bg-sr-rec-soft'
          : 'border-sr-line text-sr-ink-muted hover:border-sr-accent/40 hover:text-sr-ink'
      )}
    >
      {children}
    </button>
  )
}

function TrackRow({
  track,
  active,
  canRemove,
  onSelect,
  onMute,
  onSolo,
  onRemove,
  onEffects,
  onGainLive,
  onNudge,
  onCommit
}: {
  track: Track
  active: boolean
  canRemove: boolean
  onSelect: () => void
  onMute: () => void
  onSolo: () => void
  onRemove: () => void
  onEffects: () => void
  onGainLive: (id: string, gain: number) => void
  onNudge: (id: string, deltaSeconds: number) => void
  onCommit: (prev: Project) => void
}): JSX.Element {
  const [gain, setGain] = useState(track.gain ?? 1)
  useEffect(() => setGain(track.gain ?? 1), [track.gain])

  const dragBase = useRef<Project | null>(null)
  const timer = useRef<number | null>(null)
  const pending = useRef<number | null>(null)

  const flush = (): void => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
    if (pending.current !== null) {
      const v = pending.current
      pending.current = null
      onGainLive(track.id, v)
    }
  }

  // 拖动时按 150ms 尾随节流重渲染，避免每帧都做整段混音
  const slide = (v: number): void => {
    setGain(v)
    pending.current = v
    if (timer.current === null) {
      timer.current = window.setTimeout(() => {
        timer.current = null
        flush()
      }, 150)
    }
  }

  const release = (): void => {
    flush()
    if (dragBase.current) {
      onCommit(dragBase.current)
      dragBase.current = null
    }
  }

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    []
  )

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-xl border px-2.5 py-2 transition-colors max-md:flex-wrap',
        active ? 'border-sr-accent/50 bg-sr-accent-soft' : 'border-sr-line/60 hover:border-sr-line'
      )}
    >
      <button onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <span className={cn('h-2 w-2 shrink-0 rounded-full', active ? 'bg-sr-accent' : 'bg-sr-ink-faint/50')} />
        <span className="truncate text-[13px] text-sr-ink">{track.name}</span>
      </button>

      <button
        onClick={onMute}
        title="静音"
        className={cn(
          'rounded-md px-2 py-0.5 text-[11px] transition-colors',
          track.muted ? 'bg-sr-rec-soft text-sr-rec' : 'text-sr-ink-faint hover:text-sr-ink'
        )}
      >
        静音
      </button>
      <button
        onClick={onSolo}
        title="独奏"
        className={cn(
          'rounded-md px-2 py-0.5 text-[11px] transition-colors',
          track.solo ? 'bg-sr-accent-soft text-sr-accent' : 'text-sr-ink-faint hover:text-sr-ink'
        )}
      >
        独奏
      </button>

      <button
        onClick={onEffects}
        title="效果（EQ / 压缩 / 混响）"
        className={cn(
          'flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] transition-colors',
          hasEffects(track.effects) ? 'bg-sr-accent-soft text-sr-accent' : 'text-sr-ink-faint hover:text-sr-ink'
        )}
      >
        效果
        {hasEffects(track.effects) && <span className="h-1.5 w-1.5 rounded-full bg-sr-accent" />}
      </button>

      <input
        type="range"
        min={0}
        max={2}
        step={0.05}
        value={gain}
        onPointerDown={() => {
          dragBase.current = useEditorStore.getState().project
        }}
        onChange={(e) => slide(Number(e.target.value))}
        onPointerUp={release}
        className="h-1 w-24 cursor-pointer accent-[rgb(var(--c-accent))]"
      />
      <span className="tabular w-9 text-right text-[11px] text-sr-ink-faint">
        {Math.round(gain * 100)}%
      </span>

      {/* 起点对齐：整条轨道延后参与混音（修正多设备同时采集的时钟差 / 启动延迟） */}
      <div
        className="flex shrink-0 items-center gap-1"
        title="起点对齐：整条轨道延后这么久参与混音，用于修正多设备同时速录的毫秒级错位"
      >
        <span className="text-[11px] text-sr-ink-faint">起点</span>
        <button
          onClick={() => onNudge(track.id, -0.01)}
          disabled={(track.offset ?? 0) <= 0}
          className="rounded-md px-1.5 py-0.5 text-[11px] text-sr-ink-faint transition-colors hover:text-sr-ink disabled:opacity-30"
        >
          −
        </button>
        <span className="tabular w-11 text-right text-[11px] text-sr-ink-faint">
          {(track.offset ?? 0) > 0 ? `+${Math.round((track.offset ?? 0) * 1000)}ms` : '0 ms'}
        </span>
        <button
          onClick={() => onNudge(track.id, 0.01)}
          disabled={(track.offset ?? 0) >= 10}
          className="rounded-md px-1.5 py-0.5 text-[11px] text-sr-ink-faint transition-colors hover:text-sr-ink disabled:opacity-30"
        >
          +
        </button>
      </div>

      <button
        onClick={onRemove}
        disabled={!canRemove}
        title="删除轨道"
        className="rounded-md p-1 text-sr-ink-faint transition-colors hover:text-sr-rec disabled:opacity-30"
      >
        <TrashIcon width={14} height={14} />
      </button>
    </div>
  )
}

function AddTrackDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const items = useLibraryStore((s) => s.items)
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      onMouseDown={onClose}
    >
      <div
        className="max-h-[70vh] w-full max-w-[420px] overflow-y-auto rounded-2xl border border-sr-line bg-sr-base p-5 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="text-[15px] font-semibold text-sr-ink">添加轨道</h2>
        <p className="mt-1 text-[12px] text-sr-ink-faint">
          从资料库选择一条速录作为新轨道（多轨速录会把它的各路一并加入）
        </p>
        <div className="mt-4 flex flex-col gap-1.5">
          {items.length === 0 && <p className="text-[12px] text-sr-ink-faint">资料库暂无速录</p>}
          {items.map((m) => (
            <button
              key={m.id}
              onClick={() => {
                void editorOps.addTrack(m.id)
                onClose()
              }}
              className="flex items-center justify-between rounded-xl border border-sr-line/70 px-3 py-2 text-left text-[13px] text-sr-ink-muted transition-colors hover:border-sr-accent/40 hover:text-sr-ink"
            >
              <span className="truncate">{m.name}</span>
              <span className="ml-3 shrink-0 text-[11px] text-sr-ink-faint">
                {m.tracks && m.tracks.length > 1 ? `${m.tracks.length} 轨 · ` : ''}
                {formatDuration(m.durationMs)}
              </span>
            </button>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg border border-sr-line px-3.5 py-1.5 text-[12px] text-sr-ink-muted transition-colors hover:text-sr-ink"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * 轨道效果面板：EQ / 压缩 / 混响。
 * 调整实时（150ms 节流）重渲染预览；关闭面板时按一次「撤销」历史落账。
 */
function EffectsDialog({
  track,
  onClose
}: {
  track: Track | null
  onClose: () => void
}): JSX.Element | null {
  const initial = (): TrackEffects => {
    if (!track?.effects) return {}
    return {
      eq: track.effects.eq ? { ...track.effects.eq } : undefined,
      compressor: track.effects.compressor ? { ...track.effects.compressor } : undefined,
      reverb: track.effects.reverb ? { ...track.effects.reverb } : undefined
    }
  }

  const [fx, setFx] = useState<TrackEffects>(initial)
  const fxRef = useRef<TrackEffects>(initial())
  const base = useRef<Project | null>(useEditorStore.getState().project)
  const timer = useRef<number | null>(null)
  const pending = useRef<boolean>(false)

  const apply = (next: TrackEffects): void => {
    fxRef.current = next
    setFx(next)
    if (track) {
      pending.current = true
      if (timer.current === null) {
        timer.current = window.setTimeout(() => {
          timer.current = null
          if (track) {
            pending.current = false
            void editorOps.setTrackEffectsLive(track.id, fxRef.current)
          }
        }, 150)
      }
    }
  }

  const toggleSection = (name: 'eq' | 'compressor' | 'reverb', on: boolean): void => {
    const cur = fxRef.current
    const next: TrackEffects = { ...cur }
    if (on) {
      if (name === 'eq') next.eq = { ...DEFAULT_EQ }
      else if (name === 'compressor') next.compressor = { ...DEFAULT_COMPRESSOR }
      else next.reverb = { ...DEFAULT_REVERB }
    } else {
      if (name === 'eq') next.eq = undefined
      else if (name === 'compressor') next.compressor = undefined
      else next.reverb = undefined
    }
    apply(next)
  }

  const patch = <K extends 'eq' | 'compressor' | 'reverb'>(
    section: K,
    partial: Partial<NonNullable<TrackEffects[K]>>
  ): void => {
    const cur = fxRef.current
    const currentSection = cur[section]
    if (!currentSection) return
    apply({ ...cur, [section]: { ...currentSection, ...partial } })
  }

  const close = (): void => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
    if (pending.current && track) {
      void editorOps.setTrackEffectsLive(track.id, fxRef.current)
    }
    if (base.current) editorOps.commitHistory(base.current)
    onClose()
  }

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    []
  )

  const eqOn = !!fx.eq
  const compOn = !!fx.compressor
  const reverbOn = !!fx.reverb

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      onMouseDown={close}
    >
      <div
        className="max-h-[80vh] w-full max-w-[440px] overflow-y-auto rounded-2xl border border-sr-line bg-sr-base p-5 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[15px] font-semibold text-sr-ink">轨道效果</h2>
            <p className="mt-0.5 text-[12px] text-sr-ink-faint">
              {track?.name ?? ''} · 仅影响渲染结果，原始素材不变
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-4">
          {/* EQ */}
          <section className="rounded-xl border border-sr-line/70 bg-sr-surface/40 p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-[12px] font-medium text-sr-ink">均衡器 EQ</h3>
              <button
                onClick={() => toggleSection('eq', !eqOn)}
                className={cn(
                  'rounded-md px-2 py-0.5 text-[11px] transition-colors',
                  eqOn ? 'bg-sr-accent-soft text-sr-accent' : 'bg-sr-elevated text-sr-ink-faint hover:text-sr-ink'
                )}
              >
                {eqOn ? '已启用' : '已关闭'}
              </button>
            </div>
            {eqOn && fx.eq && (
              <div className="mt-3 flex flex-col gap-2">
                <Slider label="低频" value={fx.eq.lowGain} min={-12} max={12} step={0.5} unit="dB" onChange={(v) => patch('eq', { lowGain: v })} />
                <Slider label="中频" value={fx.eq.midGain} min={-12} max={12} step={0.5} unit="dB" onChange={(v) => patch('eq', { midGain: v })} />
                <Slider label="高频" value={fx.eq.highGain} min={-12} max={12} step={0.5} unit="dB" onChange={(v) => patch('eq', { highGain: v })} />
              </div>
            )}
          </section>

          {/* 压缩 */}
          <section className="rounded-xl border border-sr-line/70 bg-sr-surface/40 p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-[12px] font-medium text-sr-ink">动态压缩</h3>
              <button
                onClick={() => toggleSection('compressor', !compOn)}
                className={cn(
                  'rounded-md px-2 py-0.5 text-[11px] transition-colors',
                  compOn ? 'bg-sr-accent-soft text-sr-accent' : 'bg-sr-elevated text-sr-ink-faint hover:text-sr-ink'
                )}
              >
                {compOn ? '已启用' : '已关闭'}
              </button>
            </div>
            {compOn && fx.compressor && (
              <div className="mt-3 flex flex-col gap-2">
                <Slider label="阈值" value={fx.compressor.threshold} min={-60} max={0} step={0.5} unit="dB" onChange={(v) => patch('compressor', { threshold: v })} />
                <Slider label="压缩比" value={fx.compressor.ratio} min={1} max={20} step={0.5} unit=":1" onChange={(v) => patch('compressor', { ratio: v })} />
                <Slider label="启动" value={fx.compressor.attack} min={0.001} max={0.3} step={0.001} unit="s" onChange={(v) => patch('compressor', { attack: v })} />
                <Slider label="释放" value={fx.compressor.release} min={0.05} max={1} step={0.01} unit="s" onChange={(v) => patch('compressor', { release: v })} />
                <Slider label="补偿" value={fx.compressor.makeup} min={0} max={24} step={0.5} unit="dB" onChange={(v) => patch('compressor', { makeup: v })} />
              </div>
            )}
          </section>

          {/* 混响 */}
          <section className="rounded-xl border border-sr-line/70 bg-sr-surface/40 p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-[12px] font-medium text-sr-ink">混响</h3>
              <button
                onClick={() => toggleSection('reverb', !reverbOn)}
                className={cn(
                  'rounded-md px-2 py-0.5 text-[11px] transition-colors',
                  reverbOn ? 'bg-sr-accent-soft text-sr-accent' : 'bg-sr-elevated text-sr-ink-faint hover:text-sr-ink'
                )}
              >
                {reverbOn ? '已启用' : '已关闭'}
              </button>
            </div>
            {reverbOn && fx.reverb && (
              <div className="mt-3 flex flex-col gap-2">
                <Slider label="干湿比" value={fx.reverb.mix} min={0} max={1} step={0.01} onChange={(v) => patch('reverb', { mix: v })} />
                <Slider label="衰减" value={fx.reverb.decay} min={0.2} max={4} step={0.05} unit="s" onChange={(v) => patch('reverb', { decay: v })} />
              </div>
            )}
          </section>
        </div>

        <div className="mt-5 flex items-center justify-between">
          <button
            onClick={() => apply({})}
            className="rounded-lg border border-sr-rec/30 px-3.5 py-1.5 text-[12px] text-sr-rec transition-colors hover:bg-sr-rec-soft"
          >
            清除全部效果
          </button>
          <button
            onClick={close}
            className="rounded-lg bg-sr-accent px-4 py-1.5 text-[12px] font-medium text-white transition-all hover:brightness-110"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  unit = '',
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  onChange: (v: number) => void
}): JSX.Element {
  return (
    <label className="flex items-center gap-3">
      <span className="w-14 shrink-0 text-[12px] text-sr-ink-muted">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 flex-1 cursor-pointer accent-[rgb(var(--c-accent))]"
      />
      <span className="tabular w-16 shrink-0 text-right text-[11px] text-sr-ink-faint">
        {Number.isInteger(value) ? value : Number(value.toFixed(3))}
        {unit}
      </span>
    </label>
  )
}
