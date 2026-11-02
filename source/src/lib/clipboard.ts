/** 剪贴板里解析出来的一个单元格：值 + 样式（加粗 / 底色 / 字色 / 对齐） */
export interface PasteCell {
  v: string
  bold?: boolean
  /** 底色 hex */
  color?: string
  /** 字体颜色 hex */
  fc?: string
  align?: 'left' | 'center' | 'right'
}

/** 二维字符串 → 剪贴板文本（列 \t，行 \r\n，Excel / 飞书认这个格式） */
export function toDelimited(rows: string[][]): string {
  return rows.map((r) => r.map((v) => v.replace(/[\t\n\r]/g, ' ')).join('\t')).join('\r\n')
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 带样式的矩阵 → HTML 表格（写入剪贴板的 text/html，粘回本应用可还原样式） */
export function buildStyledHtml(rows: PasteCell[][]): string {
  const body = rows
    .map(
      (row) =>
        `<tr>${row
          .map((c) => {
            const styles: string[] = []
            if (c.bold) styles.push('font-weight:700')
            if (c.color) styles.push(`background:${c.color}`)
            if (c.fc) styles.push(`color:${c.fc}`)
            if (c.align) styles.push(`text-align:${c.align}`)
            if (c.v.includes('\n')) styles.push('white-space:pre-wrap')
            const attr = styles.length ? ` style="${styles.join(';')}"` : ''
            return `<td${attr}>${escapeHtml(c.v)}</td>`
          })
          .join('')}</tr>`
    )
    .join('')
  return `<meta charset='utf-8'><table><tbody>${body}</tbody></table>`
}

/** 写文本 + HTML 到剪贴板：优先 Clipboard API，失败退回 execCommand */
export async function writeRichToClipboard(
  text: string,
  html: string,
  hooks?: { onBeforeExecCopy?: () => void; onAfterExecCopy?: () => void }
): Promise<boolean> {
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        }),
      ])
      return true
    }
  } catch {
    // 继续走 execCommand
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '-1000px'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    hooks?.onBeforeExecCopy?.()
    const ok = document.execCommand('copy')
    hooks?.onAfterExecCopy?.()
    document.body.removeChild(ta)
    return ok
  } catch {
    hooks?.onAfterExecCopy?.()
    return false
  }
}

// ---------------------------------------------------------------------------
// 解析：外部 Excel / WPS / 飞书，以及本应用自己复制的带样式 HTML
// ---------------------------------------------------------------------------

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

/** 纯文本（Excel 复制的是 Tab 分隔 + 换行）→ 单元格矩阵 */
export function parseDelimited(text: string): PasteCell[][] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  while (lines.length && lines[lines.length - 1] === '') lines.pop()
  if (!lines.length) return []
  if (lines.some((l) => l.includes('\t'))) {
    return lines.map((l) => l.split('\t').map((v) => ({ v: v.trim() })))
  }
  return lines.map((l) => [{ v: l.trim() }])
}

/** 解析 <td> 的 style 字符串 → 样式片段 */
export function parseTdStyle(
  style: string
): Pick<PasteCell, 'bold' | 'color' | 'fc' | 'align'> {
  const out: Pick<PasteCell, 'bold' | 'color' | 'fc' | 'align'> = {}
  for (const decl of style.split(';')) {
    const i = decl.indexOf(':')
    if (i < 0) continue
    const p = decl.slice(0, i).trim().toLowerCase()
    const val = decl.slice(i + 1).trim().toLowerCase()
    if (p === 'font-weight' && (/bold/.test(val) || /^[6-9]00$/.test(val))) out.bold = true
    else if ((p === 'background' || p === 'background-color') && HEX_RE.test(val)) out.color = val
    else if (p === 'color' && HEX_RE.test(val)) out.fc = val
    else if (p === 'text-align' && (val === 'left' || val === 'center' || val === 'right'))
      out.align = val
  }
  return out
}

/** Excel 复制时同时给出 <table> HTML，里面带样式，可还原 */
export function parseHtmlTable(html: string): PasteCell[][] | null {
  if (!html || !/<table[\s>]/i.test(html)) return null
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const table = doc.querySelector('table')
    if (!table) return null
    const rows: PasteCell[][] = []
    for (const tr of Array.from(table.querySelectorAll('tr'))) {
      const tds = Array.from(tr.children).filter((el) => /^(TD|TH)$/i.test(el.tagName))
      if (!tds.length) continue
      rows.push(
        tds.map((el) => {
          const td = el as HTMLElement
          const styleAttr = td.getAttribute('style') ?? ''
          const preWrap = /white-space\s*:\s*(pre-wrap|pre)\b/i.test(styleAttr)
          const rawText = (td.textContent ?? '').replace(/\u00a0/g, ' ')
          const cell: PasteCell = {
            v: preWrap ? rawText.trim() : rawText.replace(/\s*\n\s*/g, ' ').trim(),
          }
          Object.assign(cell, parseTdStyle(styleAttr))
          if (!cell.bold && td.querySelector('b,strong')) cell.bold = true
          if (!cell.align) {
            const a = (td.getAttribute('align') ?? '').toLowerCase()
            if (a === 'left' || a === 'center' || a === 'right') cell.align = a
          }
          return cell
        })
      )
    }
    return rows.length ? rows : null
  } catch {
    return null
  }
}

/** 去掉四周全空的行列，保持内部空行（粘贴后行位对齐） */
export function trimMatrix(rows: PasteCell[][]): PasteCell[][] {
  let top = 0
  let bottom = rows.length - 1
  const hasValue = (r: PasteCell[] | undefined) => !!r && r.some((c) => c && c.v !== '')
  while (top <= bottom && !hasValue(rows[top])) top += 1
  while (bottom >= top && !hasValue(rows[bottom])) bottom -= 1
  if (top > bottom) return []
  const kept = rows.slice(top, bottom + 1)
  let right = 0
  for (const r of kept) {
    for (let i = r.length - 1; i >= 0; i -= 1) {
      if (r[i] && r[i].v !== '') {
        if (i + 1 > right) right = i + 1
        break
      }
    }
  }
  return kept.map((r) => r.slice(0, Math.max(right, 1)))
}

/** 从剪贴板取矩阵：优先 HTML 表格（带样式），退回纯文本分隔 */
export function matrixFromClipboard(cd: DataTransfer | null): PasteCell[][] {
  if (!cd) return []
  const fromHtml = parseHtmlTable(cd.getData('text/html') ?? '')
  if (fromHtml) return trimMatrix(fromHtml)
  return trimMatrix(parseDelimited(cd.getData('text/plain') ?? ''))
}
