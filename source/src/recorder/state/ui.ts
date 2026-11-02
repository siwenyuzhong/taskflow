/**
 * 「工作速录」配色状态 —— 跟随 Sloth 自身的主题（`<html data-theme>`）。
 *
 * 移植自 autoRec 的 `state/ui.ts`，但去掉了「跟随系统 / 主进程持久化」逻辑：
 * Sloth 已有统一主题系统（AppContext 写 `documentElement.dataset.theme`），
 * 速录模块只需读取当前实际配色，用于 canvas / WaveSurfer 取色。
 */
import { create } from 'zustand'

export type Scheme = 'light' | 'dark'

function currentScheme(): Scheme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
}

interface UiStore {
  /** 当前实际配色（来自 Sloth 主题） */
  scheme: Scheme
  /** 开始监听 Sloth 主题变化（幂等） */
  init: () => void
}

let observer: MutationObserver | null = null

export const useUiStore = create<UiStore>((set) => ({
  scheme: currentScheme(),

  init: () => {
    set({ scheme: currentScheme() })
    if (observer) return
    observer = new MutationObserver(() => {
      set({ scheme: currentScheme() })
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    })
  }
}))

/** 读取当前主题下的调色板（rgb 三元组 CSS 变量 -> canvas / WaveSurfer 可用的颜色串）。 */
export function themeColor(name: string, alpha?: number): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return alpha === undefined ? `rgb(${raw})` : `rgb(${raw} / ${alpha})`
}
