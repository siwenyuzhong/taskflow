import type { Note } from '../types'

const IMAGE_RE = /!\[[^\]]*\]\(([^)\s]+)\)/g

/** 正文里是否包含图片 */
export function hasImage(content: string): boolean {
  IMAGE_RE.lastIndex = 0
  return IMAGE_RE.test(content)
}

/** 去掉 Markdown 标记，得到纯文本（用于标题/摘要推导） */
export function stripMarkdown(src: string): string {
  return src
    .replace(/```[\s\S]*?```/g, ' ') // 代码块
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // 图片
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 链接
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // 标题符号
    .replace(/^\s{0,3}>\s?/gm, '') // 引用
    .replace(/^\s*[-*+]\s+/gm, '') // 无序列表
    .replace(/^\s*\d+[.)]\s+/gm, '') // 有序列表
    .replace(/^\s*(-{3,}|\*{3,}|_{3,})\s*$/gm, ' ') // 分隔线
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 笔记名称：优先用显式标题，否则取正文首个非空文本行 */
export function noteTitle(note: Note): string {
  const explicit = note.title.trim()
  if (explicit) return explicit
  const lines = note.content.split('\n')
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (/^!\[[^\]]*\]\([^)]*\)$/.test(line)) continue // 纯图片行跳过
    const text = stripMarkdown(line)
    if (text) return text.length > 60 ? `${text.slice(0, 60)}…` : text
  }
  return hasImage(note.content) ? '图片笔记' : '未命名笔记'
}

/** 一行摘要（不含换行） */
export function noteSummary(content: string): string {
  return stripMarkdown(content)
}
