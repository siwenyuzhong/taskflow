import { useEffect, useState } from 'react'
import { useRecorderStore, TRACK_GAINS } from '@renderer/state/recorder'
import {
  startRecording,
  pauseRecording,
  resumeRecording,
  stopRecording,
  resetRecorder
} from '@renderer/audio/controller'
import { useLibraryStore } from '@renderer/state/library'
import { formatBytes, formatTimer } from '@renderer/lib/format'
import { cn } from '@renderer/lib/cn'
import { MicIcon, PauseIcon, PlayIcon, StopIcon, TextIcon, TrashIcon, WaveIcon, CollapseIcon } from '@renderer/components/Icons'
import type { RecorderState } from '@shared/recorder-state'
import type { AsrAvailability } from '@shared/ipc'
import { Waveform } from './Waveform'
import { LevelMeter } from './LevelMeter'
import { TranscriptPanel } from '../transcript/TranscriptPanel'

const STATE_LABEL: Record<RecorderState, { text: string; tone: 'idle' | 'live' | 'warn' }> = {
  IDLE: { text: '待速录', tone: 'idle' },
  PREPARING: { text: '准备中', tone: 'warn' },
  RECORDING: { text: '录制中', tone: 'live' },
  PAUSED: { text: '已暂停', tone: 'warn' },
  STOPPING: { text: '保存中', tone: 'warn' },
  FINISHED: { text: '已完成', tone: 'idle' },
  ERROR: { text: '出错了', tone: 'warn' }
}

export function RecorderPage(): JSX.Element {
  const state = useRecorderStore((s) => s.state)
  const elapsedMs = useRecorderStore((s) => s.elapsedMs)
  const error = useRecorderStore((s) => s.error)
  const lastMeta = useRecorderStore((s) => s.lastMeta)
  const markers = useRecorderStore((s) => s.markers)
  const addMarker = useRecorderStore((s) => s.addMarker)
  const tracks = useRecorderStore((s) => s.tracks)
  const source = useRecorderStore((s) => s.source)
  const setSource = useRecorderStore((s) => s.setSource)
  const transcribe = useRecorderStore((s) => s.transcribe)
  const setTranscribe = useRecorderStore((s) => s.setTranscribe)
  const subtitleOn = useRecorderStore((s) => s.subtitleOn)
  const setSubtitleOn = useRecorderStore((s) => s.setSubtitleOn)
  const subtitleClickThrough = useRecorderStore((s) => s.subtitleClickThrough)
  const setSubtitleClickThrough = useRecorderStore((s) => s.setSubtitleClickThrough)
  const screenAccess = useRecorderStore((s) => s.screenAccess)
  const setScreenAccess = useRecorderStore((s) => s.setScreenAccess)

  const label = STATE_LABEL[state]
  const recording = state === 'RECORDING'
  const busy = state === 'PREPARING' || state === 'STOPPING'
  // 实时转写可用性：模型缺失时开关置灰并给出说明
  const [asrAvail, setAsrAvail] = useState<AsrAvailability | null>(null)
  useEffect(() => {
    void window.api.asr
      .availability()
      .then(setAsrAvail)
      .catch(() => {})
  }, [])
  const asrOff = asrAvail != null && !asrAvail.available
  // 转写不可用时若残留「已开启」状态，强制关闭，避免录制时反复报错且开关被置灰无法关闭
  useEffect(() => {
    if (asrOff && transcribe) setTranscribe(false)
  }, [asrOff, transcribe, setTranscribe])

  // 系统内录授权状态缓存：进入需要系统声音的音源时刷新（首次授权后需重启，界面只做提示）
  useEffect(() => {
    void window.api.windows
      .systemAudioStatus()
      .then(setScreenAccess)
      .catch(() => undefined)
  }, [source, setScreenAccess])

  return (
    <div className="flex h-full min-h-0">
      {/* 主区 */}
      <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-8 py-7 max-md:gap-4 max-md:px-4 max-md:py-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[19px] font-semibold text-sr-ink">速录</h1>
            <p className="mt-0.5 text-[12px] text-sr-ink-faint">
              {source === 'microphone' ? '麦克风输入' : source === 'system' ? '系统内录' : '混合输入'}
              {source === 'system'
                ? ' · 单一路 · 48 kHz'
                : source === 'mixed'
                  ? ' · 麦克风 + 系统 · 48 kHz'
                  : tracks.length > 1
                    ? ` · ${tracks.length} 轨同时 · 48 kHz`
                    : ' · 单轨 · 48 kHz'}
            </p>
          </div>
          <span
            className={cn(
              'flex items-center gap-2 rounded-full border px-3 py-1 text-[12px]',
              label.tone === 'live' && 'border-sr-rec/40 bg-sr-rec-soft text-sr-rec',
              label.tone === 'warn' && 'border-sr-warn/30 bg-sr-warn-soft text-sr-warn',
              label.tone === 'idle' && 'border-sr-line bg-sr-elevated text-sr-ink-muted'
            )}
          >
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                label.tone === 'live' ? 'animate-pulse bg-sr-rec' : 'bg-current'
              )}
            />
            {label.text}
          </span>
        </div>

        {/* 计时 */}
        <div className="flex items-baseline gap-3">
          <span className="tabular text-[46px] font-light leading-none text-sr-ink max-md:text-[40px]">
            {formatTimer(elapsedMs)}
          </span>
          {markers.length > 0 && (
            <span className="text-[12px] text-sr-accent">已标记 {markers.length} 处</span>
          )}
        </div>

        <Waveform />

        <LevelMeter />

        {/* 传输控制 */}
        <div
          className={cn(
            'mt-1 flex flex-wrap items-center gap-3',
            // 非录制 / 暂停状态（仅「开始录音」等单个主操作）时居中显示
            !recording && state !== 'PAUSED' && 'justify-center'
          )}
        >
          {(state === 'IDLE' || state === 'FINISHED' || state === 'ERROR') && (
            <button
              onClick={() => void startRecording()}
              className="group flex h-14 items-center gap-3 rounded-2xl bg-sr-rec px-7 text-[15px] font-medium text-white transition-all hover:brightness-110 active:scale-[0.99]"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20">
                <MicIcon width={17} height={17} />
              </span>
              开始速录
            </button>
          )}

          {recording && (
            <button
              onClick={pauseRecording}
              className="flex h-14 items-center gap-3 rounded-2xl border border-sr-line bg-sr-elevated px-6 text-[15px] text-sr-ink transition-colors hover:bg-sr-surface"
            >
              <PauseIcon width={17} height={17} />
              暂停
            </button>
          )}

          {state === 'PAUSED' && (
            <button
              onClick={resumeRecording}
              className="flex h-14 items-center gap-3 rounded-2xl bg-sr-accent px-6 text-[15px] font-medium text-white transition-all hover:brightness-110"
            >
              <PlayIcon width={17} height={17} />
              继续
            </button>
          )}

          {(recording || state === 'PAUSED') && (
            <>
              <button
                onClick={() => void stopRecording()}
                className="flex h-14 items-center gap-3 rounded-2xl bg-sr-elevated px-6 text-[15px] text-sr-ink transition-colors hover:bg-sr-surface"
              >
                <StopIcon width={17} height={17} />
                停止
              </button>
              <button
                onClick={() => void window.api.windows.float('show')}
                title="收起主窗口继续后台录制：控制条贴在屏幕右缘，点标签可展开 / 收起"
                className="flex h-14 items-center gap-3 rounded-2xl border border-sr-line bg-sr-elevated px-6 text-[15px] text-sr-ink transition-colors hover:bg-sr-surface"
              >
                <CollapseIcon width={17} height={17} />
                后台录制
              </button>
              {recording && (
                <button
                  onClick={() => addMarker(elapsedMs)}
                  className="ml-auto flex h-11 items-center gap-2 rounded-xl border border-sr-line px-4 text-[13px] text-sr-ink-muted transition-colors hover:border-sr-accent/40 hover:text-sr-accent"
                >
                  <span className="h-2 w-2 rounded-sm bg-current" />
                  插入标记点
                </button>
              )}
            </>
          )}

          {state === 'FINISHED' && (
            <button
              onClick={resetRecorder}
              className="h-14 rounded-2xl border border-sr-line px-6 text-[15px] text-sr-ink-muted transition-colors hover:text-sr-ink"
            >
              新速录
            </button>
          )}

          {busy && (
            <span className="text-[13px] text-sr-ink-faint">
              {state === 'PREPARING' ? '正在打开设备…' : '正在保存…'}
            </span>
          )}
        </div>

        {/* 参数 */}
        <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
          <Field label="音源">
            <select
              value={source}
              onChange={(e) => setSource(e.target.value as typeof source)}
              disabled={recording || state === 'PAUSED'}
              className="field"
            >
              <option value="microphone">麦克风</option>
              <option value="system">系统内录（电脑播放的声音）</option>
              <option value="mixed">麦克风 + 系统</option>
            </select>
          </Field>
          <Field label="格式">
            <div className="field flex items-center justify-between text-[13px] text-sr-ink-muted">
              <span>48 kHz · 单声道</span>
              <span>每轨</span>
            </div>
          </Field>
        </div>

        {/* 系统内录授权提示 */}
        {(source === 'system' || source === 'mixed') &&
          (screenAccess === 'denied' || screenAccess === 'restricted') && (
            <div className="flex items-center gap-3 rounded-xl border border-sr-warn/30 bg-sr-warn-soft px-4 py-3">
              <span className="text-[12px] leading-relaxed text-sr-warn">
                系统内录未授权：请在「系统设置 → 隐私与安全性 → 屏幕录制」中勾选 Sloth，重启后再试；否则将无法采集电脑声音。
              </span>
              <button
                type="button"
                onClick={() => void window.api.windows.openScreenSettings()}
                className="ml-auto shrink-0 rounded-lg bg-sr-warn px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90"
              >
                打开设置
              </button>
            </div>
          )}

        <TrackLanes />

        {/* 实时转写开关 */}
        <div className="flex items-center gap-3 rounded-xl border border-sr-line bg-sr-surface/50 px-4 py-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sr-accent-soft text-sr-accent">
            <TextIcon width={16} height={16} />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-[13px] text-sr-ink">实时转写</span>
            <span className={cn('text-[11px] text-sr-ink-faint', !asrOff && 'truncate')}>
              {asrOff
                ? asrAvail?.message ?? '当前平台暂不支持实时转写'
                : '离线识别（Zipformer2 中文 · 2025-06）· 边录边出字幕'}
            </span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={transcribe}
            disabled={recording || state === 'PAUSED' || asrOff}
            onClick={() => setTranscribe(!transcribe)}
            className={cn(
              'relative ml-auto h-6 w-11 shrink-0 rounded-full border transition-colors disabled:opacity-50',
              transcribe ? 'border-sr-accent/60 bg-sr-accent' : 'border-sr-line bg-sr-elevated'
            )}
          >
            <span
              className={cn(
                'absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-all',
                transcribe ? 'left-[23px]' : 'left-[3px]'
              )}
            />
          </button>
        </div>

        {/* 字幕悬浮窗 */}
        <div className="flex items-center gap-3 rounded-xl border border-sr-line bg-sr-surface/50 px-4 py-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sr-accent-soft text-sr-accent">
            <WaveIcon width={16} height={16} />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-[13px] text-sr-ink">字幕悬浮窗</span>
            <span className="text-[11px] text-sr-ink-faint">
              透明置顶小窗，看视频时可当字幕用
            </span>
          </span>
          {subtitleOn && (
            <button
              type="button"
              onClick={() => setSubtitleClickThrough(!subtitleClickThrough)}
              title="开启后字幕窗不拦截鼠标，可直接操作底下的视频"
              className={cn(
                'ml-auto shrink-0 rounded-lg border px-2.5 py-1 text-[11px] transition-colors',
                subtitleClickThrough
                  ? 'border-sr-line text-sr-ink-muted hover:text-sr-ink'
                  : 'border-sr-accent/50 text-sr-accent'
              )}
            >
              鼠标穿透{subtitleClickThrough ? '：开' : '：关'}
            </button>
          )}
          <button
            type="button"
            role="switch"
            aria-checked={subtitleOn}
            onClick={() => setSubtitleOn(!subtitleOn)}
            className={cn(
              'relative h-6 w-11 shrink-0 rounded-full border transition-colors',
              subtitleOn ? 'border-sr-accent/60 bg-sr-accent' : 'border-sr-line bg-sr-elevated',
              !subtitleOn && 'ml-auto'
            )}
          >
            <span
              className={cn(
                'absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-all',
                subtitleOn ? 'left-[23px]' : 'left-[3px]'
              )}
            />
          </button>
        </div>

        {error && (
          <div className="rounded-xl border border-sr-warn/25 bg-sr-warn-soft px-4 py-3 text-[13px] text-sr-warn">
            {error}
          </div>
        )}

        {lastMeta && state === 'FINISHED' && (
          <div className="flex items-center gap-3 rounded-xl border border-sr-line bg-sr-surface/70 px-4 py-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sr-accent-soft text-sr-accent">
              <WaveIcon width={17} height={17} />
            </span>
            <div className="min-w-0">
              <div className="truncate text-[13px] text-sr-ink">{lastMeta.name}</div>
              <div className="text-[11px] text-sr-ink-faint">
                已保存 · {formatTimer(lastMeta.durationMs)} · {formatBytes(lastMeta.bytes)}
              </div>
            </div>
            <button
              onClick={() => void useLibraryStore.getState().reveal(lastMeta.id)}
              className="ml-auto rounded-lg border border-sr-line px-3 py-1.5 text-[12px] text-sr-ink-muted transition-colors hover:text-sr-ink"
            >
              在文件夹中显示
            </button>
          </div>
        )}

        {/* 窄屏：转写 / 标记内联面板（桌面在右侧 aside 常驻；开启转写或有标记点时出现） */}
        {(transcribe || markers.length > 0) && (
          <div className="flex h-[42vh] min-h-[200px] flex-col overflow-hidden rounded-2xl border border-sr-line/70 bg-sr-surface/40 md:hidden">
            <div className="flex items-center gap-2 border-b border-sr-line/70 px-4 py-2.5 text-[12.5px] text-sr-ink">
              <TextIcon width={15} height={15} className="text-sr-ink-muted" />
              实时转写
              <span className="ml-auto rounded-md bg-sr-elevated px-2 py-0.5 text-[10px] text-sr-ink-faint">
                M3
              </span>
            </div>
            <TranscriptPanel />
          </div>
        )}

        <p className="mt-auto pt-2 text-[11px] leading-relaxed text-sr-ink-faint">
          速录全程在本机完成，不会上传。关闭窗口可继续后台录制。
        </p>
      </div>

      {/* 右侧转写 / 标记面板（窄屏隐藏，转写为 M-B 功能） */}
      <aside className="flex w-[340px] shrink-0 flex-col border-l border-sr-line/70 bg-sr-surface/40 max-md:hidden">
        <div className="flex items-center gap-2 border-b border-sr-line/70 px-5 py-3.5 text-[13px] text-sr-ink">
          <TextIcon width={16} height={16} className="text-sr-ink-muted" />
          实时转写
          <span className="ml-auto rounded-md bg-sr-elevated px-2 py-0.5 text-[10px] text-sr-ink-faint">
            M3
          </span>
        </div>
        <TranscriptPanel />
      </aside>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] text-sr-ink-faint">{label}</span>
      {children}
    </label>
  )
}

/**
 * 采集轨道面板：多路同时录音的每一路的设备、输入增益与实时电平。
 * 第一路为主轨（实时转写与主波形取它）。
 */
function TrackLanes(): JSX.Element {
  const tracks = useRecorderStore((s) => s.tracks)
  const devices = useRecorderStore((s) => s.devices)
  const peaks = useRecorderStore((s) => s.trackPeaks)
  const state = useRecorderStore((s) => s.state)
  const source = useRecorderStore((s) => s.source)
  const addTrack = useRecorderStore((s) => s.addTrack)
  const removeTrack = useRecorderStore((s) => s.removeTrack)
  const setTrackDevice = useRecorderStore((s) => s.setTrackDevice)
  const setTrackGain = useRecorderStore((s) => s.setTrackGain)

  const locked = state === 'RECORDING' || state === 'PAUSED'
  const live = state === 'RECORDING'
  const hasSystem = source === 'system' || source === 'mixed'

  return (
    <div className="rounded-2xl border border-sr-line/70 bg-sr-surface/50 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-wider text-sr-ink-faint">
          速录轨道 ·{' '}
          {source === 'system'
            ? '系统声音'
            : source === 'mixed'
              ? `${tracks.length} + 系统声音`
              : tracks.length}
        </span>
        {source !== 'system' && (
          <button
            onClick={addTrack}
            disabled={locked}
            className="ml-auto rounded-lg border border-sr-line px-2.5 py-1 text-[12px] text-sr-ink-muted transition-colors hover:border-sr-accent/40 hover:text-sr-ink disabled:opacity-40"
          >
            + 添加一路
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {source !== 'system' &&
          tracks.map((t, i) => (
            <div key={t.key} className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  'w-14 shrink-0 truncate text-[12px]',
                  i === 0 ? 'text-sr-ink' : 'text-sr-ink-muted'
                )}
              >
                {t.name}
              </span>
              <select
                value={t.deviceId ?? ''}
                onChange={(e) => setTrackDevice(t.key, e.target.value || null)}
                disabled={locked}
                className="field min-w-0 flex-1"
                title="输入设备"
              >
                <option value="">{devices.length === 0 ? '默认设备' : '系统默认输入'}</option>
                {devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </select>
              <select
                value={String(t.gain)}
                onChange={(e) => setTrackGain(t.key, Number(e.target.value))}
                disabled={locked}
                className="field w-[88px] shrink-0"
                title="输入增益：只作用于该轨落盘音频；备份轨压低可避免与主轨同时削波"
              >
                {TRACK_GAINS.map((g) => (
                  <option key={g.value} value={String(g.value)}>
                    {g.label}
                  </option>
                ))}
              </select>
              <LaneMeter peak={peaks[t.key] ?? 0} live={live} />
              <button
                onClick={() => removeTrack(t.key)}
                disabled={locked || tracks.length <= 1}
                title={tracks.length <= 1 ? '至少保留一路' : '删除该轨道'}
                className="rounded-md p-1.5 text-sr-ink-faint transition-colors hover:text-sr-rec disabled:opacity-30"
              >
                <TrashIcon width={14} height={14} />
              </button>
            </div>
          ))}

        {hasSystem && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-14 shrink-0 truncate text-[12px] text-sr-ink">系统声音</span>
            <span className="min-w-0 flex-1 truncate rounded-[10px] border border-sr-line/70 bg-sr-elevated/40 px-3 py-1.5 text-[12px] text-sr-ink-faint">
              捕获电脑正在播放的声音（视频 / 会议 / 网页）
            </span>
            <LaneMeter peak={peaks['sys0'] ?? 0} live={live} />
          </div>
        )}
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-sr-ink-faint">
        {source === 'system'
          ? '首次使用系统内录需在「系统设置 → 隐私与安全性 → 屏幕录制」中授权 Sloth 并重启；录制时菜单栏会出现录制指示。'
          : source === 'mixed'
            ? '第一路麦克风为主轨（实时转写取它），并叠加系统声音；各轨独立落盘，可在编辑页混音。'
            : '多路同时采集、各轨独立落盘，停止后可在编辑页直接混音。电平为设备原始电平，增益只作用于该轨速录。'}
        {source === 'microphone' && tracks.length > 1 && '实时转写仅针对主轨。'}
      </p>
    </div>
  )
}

/** 单路实时峰值条（近似 -60..0 dB）。 */
function LaneMeter({ peak, live }: { peak: number; live: boolean }): JSX.Element {
  const pct =
    peak <= 0.0001 ? 0 : Math.max(0, Math.min(1, (20 * Math.log10(peak) + 60) / 60)) * 100
  const clipping = peak >= 0.99
  return (
    <span
      title={clipping ? '该轨过载' : undefined}
      className="relative h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-sr-elevated"
    >
      <span
        className={cn(
          'absolute inset-y-0 left-0 rounded-full transition-[width] duration-75',
          clipping ? 'bg-sr-rec' : live ? 'bg-sr-accent' : 'bg-sr-ink-faint/40'
        )}
        style={{ width: `${pct}%` }}
      />
    </span>
  )
}
