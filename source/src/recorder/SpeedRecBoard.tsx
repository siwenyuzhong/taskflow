import { useEffect, useState } from 'react'
import { loadDevices } from '@renderer/audio/controller'
import { openRecording } from '@renderer/editing/controller'
import { initTranscriptBridge, initFileTranscribeBridge } from '@renderer/transcript/bridge'
import { initWindowsBridge } from '@renderer/windows/bridge'
import { useLibraryStore } from '@renderer/state/library'
import { useEditorStore } from '@renderer/state/editor'
import { useUiStore } from '@renderer/state/ui'
import { LibraryIcon } from '@renderer/components/Icons'
import { RecorderPage } from '@renderer/features/recorder/RecorderPage'
import { LibraryPage } from '@renderer/features/library/LibraryPage'
import { EditorPage } from '@renderer/features/editor/EditorPage'
import { cn } from './lib/cn'

type Tab = 'recorder' | 'library' | 'editor'

const TABS: { key: Tab; label: string }[] = [
  { key: 'recorder', label: '速录' },
  { key: 'library', label: '资料库' },
  { key: 'editor', label: '编辑器' }
]

/**
 * 「工作速录」顶层容器：在 Sloth 的顶栏 / 侧栏之下提供 录音 / 资料库 / 编辑器 三个内部页签。
 *
 * 初始化逻辑移植自 autoRec 的 App.tsx：
 *  - 采集设备枚举、资料库刷新、配色监听、转写事件订阅、设备热插拔。
 */
export function SpeedRecBoard() {
  const [tab, setTab] = useState<Tab>('recorder')
  const refresh = useLibraryStore((s) => s.refresh)
  // 编辑器当前打开的录音 id（null 表示尚未打开 / 已被删除）
  const editorId = useEditorStore((s) => s.id)

  useEffect(() => {
    useUiStore.getState().init()
    void loadDevices()
    void refresh().catch((e) => console.error('资料库刷新失败', e))
    void useLibraryStore.getState().syncJobs()
  }, [refresh])

  // 转写事件全局只订阅一次
  useEffect(() => initTranscriptBridge(), [])

  // 资料库离线转写进度：全局只订阅一次
  useEffect(() => initFileTranscribeBridge(), [])

  // 悬浮球 / 字幕窗桥接：全局只订阅一次
  useEffect(() => initWindowsBridge(), [])

  // 设备热插拔
  useEffect(() => {
    const md = navigator.mediaDevices
    if (!md) return
    const handler = (): void => void loadDevices()
    md.addEventListener('devicechange', handler)
    return () => md.removeEventListener('devicechange', handler)
  }, [])

  const handleEdit = (id: string): void => {
    setTab('editor')
    void openRecording(id)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 内部页签 */}
      <div className="flex shrink-0 items-center gap-2 px-4 pt-3 sm:px-6">
        <div className="glass inline-flex items-center gap-1 rounded-2xl p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              aria-current={tab === t.key ? 'page' : undefined}
              className={cn(
                'min-h-[36px] rounded-xl px-4 text-[13px] font-semibold transition-all duration-200',
                tab === t.key
                  ? 'bg-[var(--accent-soft)] t1 shadow-[0_10px_30px_-18px_var(--accent-glow)]'
                  : 't2 hover:t1'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* 页面内容 */}
      <div className="relative min-h-0 flex-1">
        {tab === 'recorder' && <RecorderPage />}
        {tab === 'library' && <LibraryPage onEdit={handleEdit} />}
        {tab === 'editor' &&
          (editorId ? (
            <EditorPage
              onBack={() => {
                setTab('library')
                void refresh().catch((e) => console.error('资料库刷新失败', e))
              }}
            />
          ) : (
            <EditorEmpty onGoLibrary={() => setTab('library')} />
          ))}
      </div>
    </div>
  )
}

/** 未打开任何录音时的编辑器占位：避免对着空工程操作已不存在的录音。 */
function EditorEmpty({ onGoLibrary }: { onGoLibrary: () => void }): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-2xl border border-sr-line bg-sr-surface text-sr-ink-faint">
        <LibraryIcon width={26} height={26} />
      </span>
      <div>
        <p className="text-[15px] text-sr-ink">还没有打开速录</p>
        <p className="mt-1 text-[12.5px] text-sr-ink-faint">
          去「资料库」选择一条速录，或先录制一条新的。
        </p>
      </div>
      <button
        onClick={onGoLibrary}
        className="rounded-xl border border-sr-line px-4 py-2 text-[13px] text-sr-ink-muted transition-colors hover:text-sr-ink"
      >
        前往资料库
      </button>
    </div>
  )
}
