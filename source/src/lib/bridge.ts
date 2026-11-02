import type { AppData } from '../types'

export interface NotifyPayload {
  title: string
  subtitle?: string
  body?: string
  taskId?: string
  silent?: boolean
  urgency?: 'normal' | 'critical' | 'low'
}

/** 轻量模式飘过提醒里的一条任务 */
export interface LightFlyTask {
  title: string
  /** 「今天 18:00」「明天 09:00」「已过期」 */
  label: string
  overdue: boolean
}

/** 轻量模式飘过提醒的待办清单（tasks 为空表示没有需要提醒的任务） */
export interface LightFlyPayload {
  tasks: LightFlyTask[]
  count: number
  taskId?: string | null
}

/** 飘条在飘窗内的矩形（悬停命中用） */
export interface LightFlyHitRect {
  x: number
  y: number
  w: number
  h: number
}

export interface Bridge {
  isNative: boolean
  /** 'darwin' | 'win32' | 'linux' | 'browser'（浏览器预览） */
  platform: string
  read(): Promise<AppData | null>
  write(data: AppData): Promise<boolean>
  notify(payload: NotifyPayload): Promise<boolean>
  badge(text: string): Promise<boolean>
  info(): Promise<Record<string, unknown> | null>
  revealData(): Promise<boolean>
  /** 保存文件（Excel 传 base64，CSV 传文本）。返回保存路径，取消返回 null */
  saveFile(payload: { defaultName?: string; content: string; format?: 'csv' | 'xlsx' }): Promise<string | null>
  /** 打开文件（Excel/CSV）。返回内容；取消或非原生环境返回 null */
  openFile(): Promise<{ name: string; content: string; type?: 'csv' | 'xlsx' } | null>
  onFocusTask(cb: (taskId: string) => void): () => void
  /** 轻量模式开关；返回主进程实际状态（Dock 点击/飘条点击也可能改变它） */
  lightmodeSet(on: boolean): Promise<boolean>
  /** 推送「今天 / 快到期」的未完成任务清单，供主进程一条一个飘条飘过提醒 */
  lightmodeTasks(payload: LightFlyPayload): Promise<boolean>
  /** 上报各飘条矩形（仅 #lightfly 页使用），主进程据此判定悬停 */
  lightmodeHit(rects: LightFlyHitRect[]): void
  /** 悬停回调：null = 没悬停；数字 = 该条飘条被悬停（暂停滑动） */
  onLightmodeHover(cb: (index: number | null) => void): () => void
  onLightmodeState(cb: (on: boolean) => void): () => void
}

interface NativeApi {
  platform: string
  read(): Promise<AppData | null>
  write(data: AppData): Promise<boolean>
  notify(payload: NotifyPayload): Promise<boolean>
  badge(text: string): Promise<boolean>
  info(): Promise<Record<string, unknown>>
  revealData(): Promise<boolean>
  saveFile(payload: { defaultName?: string; content: string; format?: 'csv' | 'xlsx' }): Promise<string | null>
  openFile(): Promise<{ name: string; content: string; type?: 'csv' | 'xlsx' } | null>
  onFocusTask(cb: (taskId: string) => void): () => void
  lightmodeSet(on: boolean): Promise<boolean>
  lightmodeTasks(payload: LightFlyPayload): Promise<boolean>
  lightmodeOpen(): void
  lightmodeHit(rects: LightFlyHitRect[]): void
  onLightmodeHover(cb: (index: number | null) => void): () => void
  onLightmodeState(cb: (on: boolean) => void): () => void
}

declare global {
  interface Window {
    taskflow?: NativeApi
  }
}

const LS_KEY = 'taskflow-data'

/**
 * 有 Electron 桥接就走本地文件持久化 + 原生通知；
 * 否则（浏览器里预览）降级到 localStorage + Web Notification，
 * 保证同一套 UI 代码两边都能跑。
 */
export const bridge: Bridge = {
  isNative: typeof window !== 'undefined' && !!window.taskflow,
  platform:
    typeof window !== 'undefined' && window.taskflow ? window.taskflow.platform : 'browser',

  async read() {
    if (window.taskflow) return window.taskflow.read()
    try {
      const raw = localStorage.getItem(LS_KEY)
      return raw ? (JSON.parse(raw) as AppData) : null
    } catch {
      return null
    }
  },

  async write(data) {
    if (window.taskflow) return window.taskflow.write(data)
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(data))
      return true
    } catch {
      return false
    }
  },

  async notify(payload) {
    if (window.taskflow) return window.taskflow.notify(payload)
    try {
      if (!('Notification' in window)) return false
      if (Notification.permission === 'default') await Notification.requestPermission()
      if (Notification.permission !== 'granted') return false
      new Notification(payload.title, { body: payload.body })
      return true
    } catch {
      return false
    }
  },

  async badge(text) {
    if (window.taskflow) return window.taskflow.badge(text)
    return false
  },

  async info() {
    if (window.taskflow) return window.taskflow.info()
    return { version: '1.0.0', platform: 'browser', electron: '—' }
  },

  async revealData() {
    if (window.taskflow) return window.taskflow.revealData()
    return false
  },

  async saveFile(payload) {
    if (window.taskflow) return window.taskflow.saveFile(payload)
    // 浏览器预览：触发下载
    try {
      const isXlsx = (payload.format ?? 'xlsx') === 'xlsx'
      const name = payload.defaultName ?? (isXlsx ? 'export.xlsx' : 'export.csv')
      let blob: Blob
      if (isXlsx) {
        const bin = atob(payload.content)
        const buf = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
        blob = new Blob([buf], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        })
      } else {
        blob = new Blob([payload.content], { type: 'text/csv;charset=utf-8' })
      }
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      URL.revokeObjectURL(url)
      return name
    } catch {
      return null
    }
  },

  async openFile() {
    if (window.taskflow) return window.taskflow.openFile()
    // 浏览器预览：用 <input type=file> 选择；Excel 以 base64 返回
    try {
      return await new Promise((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.xlsx,.xls,.csv'
        input.onchange = () => {
          const file = input.files?.[0]
          if (!file) return resolve(null)
          const reader = new FileReader()
          const isCsv = /\.csv$/i.test(file.name)
          reader.onload = () => {
            if (isCsv) {
              resolve({ name: file.name, content: String(reader.result ?? ''), type: 'csv' })
              return
            }
            const buf = new Uint8Array(reader.result as ArrayBuffer)
            let bin = ''
            for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i])
            resolve({ name: file.name, content: btoa(bin), type: 'xlsx' })
          }
          reader.onerror = () => resolve(null)
          if (isCsv) reader.readAsText(file)
          else reader.readAsArrayBuffer(file)
        }
        input.click()
      })
    } catch {
      return null
    }
  },

  onFocusTask(cb) {
    if (window.taskflow) return window.taskflow.onFocusTask(cb)
    return () => {}
  },

  async lightmodeSet(on) {
    if (window.taskflow) return window.taskflow.lightmodeSet(on)
    return false // 浏览器预览没有 Dock / 悬浮窗，保持关闭
  },

  async lightmodeTasks(payload) {
    if (window.taskflow) return window.taskflow.lightmodeTasks(payload)
    return false
  },

  lightmodeHit(rects) {
    window.taskflow?.lightmodeHit(rects)
  },

  onLightmodeHover(cb) {
    if (window.taskflow) return window.taskflow.onLightmodeHover(cb)
    return () => {}
  },

  onLightmodeState(cb) {
    if (window.taskflow) return window.taskflow.onLightmodeState(cb)
    return () => {}
  },
}
