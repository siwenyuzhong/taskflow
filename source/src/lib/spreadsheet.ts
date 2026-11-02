import type { Sheet, SheetCell } from '../types'

/** 单元格 key：0 起始的行列 → "R{row}C{col}" */
export function sheetKey(r: number, c: number): string {
  return `R${r}C${c}`
}

/** "R2C3" → { r: 2, c: 3 }；非法返回 null */
export function parseSheetKey(key: string): { r: number; c: number } | null {
  const m = /^R(\d+)C(\d+)$/.exec(key)
  if (!m) return null
  return { r: Number(m[1]), c: Number(m[2]) }
}

const A_CODE = 65 // 'A'.charCodeAt(0)

/** 列索引 → 字母（0→A，25→Z，26→AA） */
export function colLabel(i: number): string {
  let n = i + 1
  let s = ''
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(A_CODE + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/** 字母列名 → 索引（A→0，AA→26） */
export function colIndex(label: string): number {
  let n = 0
  for (const ch of label.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - A_CODE + 1)
  return n - 1
}

const REF_RE = /^([A-Za-z]{1,3})(\d{1,6})$/

/** "B3" → { col: 1, row: 2 }；非法返回 null */
export function parseRef(s: string): { col: number; row: number } | null {
  const m = REF_RE.exec(s.trim())
  if (!m) return null
  return { col: colIndex(m[1]), row: parseInt(m[2], 10) - 1 }
}

function fmtNum(n: number): string {
  if (Number.isInteger(n)) return String(n)
  return String(Math.round(n * 1e6) / 1e6)
}

/** 单元格原始值是否可视为数字 */
export function toNum(text: string): number | null {
  const t = text.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

// ---------------------------------------------------------------------------
// 公式求值（在整张表上递归解析引用，带循环引用保护）
// ---------------------------------------------------------------------------

type RefTok = { t: 'ref'; col: number; row: number }

type Tok =
  | { t: 'num'; v: number }
  | RefTok
  | { t: 'op'; v: string }
  | { t: 'fn'; v: string }
  | { t: 'lpar' }
  | { t: 'rpar' }
  | { t: 'comma' }
  | { t: 'colon' }

function tokenize(src: string): Tok[] {
  const toks: Tok[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i
      while (j < src.length && /[0-9.]/.test(src[j])) j++
      toks.push({ t: 'num', v: parseFloat(src.slice(i, j)) })
      i = j
    } else if (/[A-Za-z]/.test(ch)) {
      let j = i
      while (j < src.length && /[A-Za-z]/.test(src[j])) j++
      if (src[j] === '(') {
        toks.push({ t: 'fn', v: src.slice(i, j).toUpperCase() })
        i = j
      } else {
        let k = j
        while (k < src.length && /[0-9]/.test(src[k])) k++
        const colPart = src.slice(i, j)
        const rowPart = src.slice(j, k)
        if (!rowPart) throw new Error(`无法解析引用 ${colPart}`)
        toks.push({ t: 'ref', col: colIndex(colPart), row: parseInt(rowPart, 10) - 1 })
        i = k
      }
    } else if (ch === '(') {
      toks.push({ t: 'lpar' })
      i++
    } else if (ch === ')') {
      toks.push({ t: 'rpar' })
      i++
    } else if (ch === ',') {
      toks.push({ t: 'comma' })
      i++
    } else if (ch === ':') {
      toks.push({ t: 'colon' })
      i++
    } else if ('+-*/'.includes(ch)) {
      toks.push({ t: 'op', v: ch })
      i++
    } else {
      throw new Error(`非法字符 ${ch}`)
    }
  }
  return toks
}

interface EvalCtx {
  numOf: (col: number, row: number) => number
  rawOf: (col: number, row: number) => string
  cellsIn: (a: RefTok, b: RefTok) => RefTok[]
}

function evalTokens(toks: Tok[], ctx: EvalCtx): number {
  let i = 0
  const peek = () => toks[i]
  const next = () => toks[i++]

  function expr(): number {
    let v = term()
    while (true) {
      const t = peek()
      if (t?.t === 'op' && (t.v === '+' || t.v === '-')) {
        next()
        const r = term()
        v = t.v === '+' ? v + r : v - r
      } else return v
    }
  }

  function term(): number {
    let v = factor()
    while (true) {
      const t = peek()
      if (t?.t === 'op' && (t.v === '*' || t.v === '/')) {
        next()
        const r = factor()
        v = t.v === '*' ? v * r : r === 0 ? NaN : v / r
      } else return v
    }
  }

  function factor(): number {
    const t = next()
    if (!t) throw new Error('公式不完整')
    if (t.t === 'num') return t.v
    if (t.t === 'op' && (t.v === '-' || t.v === '+')) {
      const v = factor()
      return t.v === '-' ? -v : v
    }
    if (t.t === 'ref') return ctx.numOf(t.col, t.row)
    if (t.t === 'lpar') {
      const v = expr()
      if (peek()?.t !== 'rpar') throw new Error('缺少 )')
      next()
      return v
    }
    if (t.t === 'fn') return callFn(t.v)
    throw new Error('无法识别的公式')
  }

  function rangeCell(t: RefTok): { num: number; isNum: boolean; raw: string } {
    return {
      num: ctx.numOf(t.col, t.row),
      isNum: toNum(ctx.rawOf(t.col, t.row)) !== null,
      raw: ctx.rawOf(t.col, t.row),
    }
  }

  function callFn(name: string): number {
    if (peek()?.t !== 'lpar') throw new Error(`${name} 缺少 (`)
    next()
    const args: { num: number; isNum: boolean; raw: string }[] = []
    while (peek() && peek()?.t !== 'rpar') {
      const at = peek() as Tok | undefined
      if (at && at.t === 'ref' && toks[i + 1]?.t === 'colon' && toks[i + 2]?.t === 'ref') {
        const a = next() as RefTok
        next() // colon
        const b = next() as RefTok
        for (const ref of ctx.cellsIn(a, b)) args.push(rangeCell(ref))
      } else if (at && at.t === 'ref') {
        const ref = next() as RefTok
        args.push(rangeCell(ref))
      } else {
        const v = expr()
        args.push({ num: v, isNum: Number.isFinite(v), raw: '' })
      }
      if (peek()?.t === 'comma') next()
      else break
    }
    if (peek()?.t !== 'rpar') throw new Error(`${name} 缺少 )`)
    next()
    const nums = args.filter((x) => x.isNum).map((x) => x.num)
    switch (name) {
      case 'SUM':
        return nums.reduce((s, n) => s + n, 0)
      case 'AVERAGE': {
        if (!nums.length) throw new Error('AVERAGE 无数字')
        return nums.reduce((s, n) => s + n, 0) / nums.length
      }
      case 'MIN':
        if (!nums.length) throw new Error('MIN 无数字')
        return Math.min(...nums)
      case 'MAX':
        if (!nums.length) throw new Error('MAX 无数字')
        return Math.max(...nums)
      case 'COUNT':
        return nums.length
      case 'COUNTA':
        return args.filter((x) => x.raw !== '').length
      default:
        throw new Error(`未知函数 ${name}`)
    }
  }

  const result = expr()
  if (i !== toks.length) throw new Error('公式有多余内容')
  return result
}

/** 单元格的展示文本：空 / 文本原样 / =公式计算结果 */
export function sheetValue(sheet: Sheet, key: string, stack = new Set<string>()): string {
  const cell = sheet.cells[key]
  const raw = (cell?.v ?? '').trim()
  if (!raw) return ''
  if (!raw.startsWith('=')) return raw
  if (stack.has(key)) return '#循环引用!'
  stack.add(key)
  let out = '#ERROR!'
  try {
    const body = raw.slice(1).trim()
    // 直接引用（=A2）：透传所引单元格的展示文本，避免文本被算成 0
    if (/^[A-Za-z]{1,3}\d{1,6}$/.test(body)) {
      const ref = parseRef(body)
      if (ref) {
        out = sheetValue(sheet, sheetKey(ref.row, ref.col), stack)
        stack.delete(key)
        return out
      }
    }
    const toks = tokenize(body)
    const ctx: EvalCtx = {
      numOf: (col, row) => toNum(sheetValue(sheet, sheetKey(row, col), stack)) ?? 0,
      rawOf: (col, row) => sheet.cells[sheetKey(row, col)]?.v ?? '',
      cellsIn: (a, b) => {
        const c1 = Math.min(a.col, b.col)
        const c2 = Math.max(a.col, b.col)
        const r1 = Math.min(a.row, b.row)
        const r2 = Math.max(a.row, b.row)
        const out: RefTok[] = []
        for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) out.push({ t: 'ref', col: c, row: r })
        return out
      },
    }
    const n = evalTokens(toks, ctx)
    out = Number.isFinite(n) ? fmtNum(n) : '#ERROR!'
  } catch {
    out = '#ERROR!'
  }
  stack.delete(key)
  return out
}

// ---------------------------------------------------------------------------
// CSV 导入 / 导出
// ---------------------------------------------------------------------------

/** 工作表 → CSV（值取公式结果） */
export function sheetToCsv(sheet: Sheet): string {
  const lines: string[] = []
  for (let r = 0; r < sheet.rowCount; r++) {
    const row: string[] = []
    for (let c = 0; c < sheet.colCount; c++) row.push(csvEscape(sheetValue(sheet, sheetKey(r, c))))
    lines.push(row.join(','))
  }
  return lines.join('\r\n')
}

function csvEscape(s: string): string {
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** CSV 文本 → 二维字符串数组（处理引号/转义/换行） */
export function csvToRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let inQuote = false
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inQuote) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cur += '"'
          i++
        } else inQuote = false
      } else cur += ch
    } else if (ch === '"') {
      inQuote = true
    } else if (ch === ',') {
      row.push(cur)
      cur = ''
    } else if (ch === '\n') {
      row.push(cur)
      rows.push(row)
      row = []
      cur = ''
    } else {
      cur += ch
    }
  }
  if (cur !== '' || row.length) {
    row.push(cur)
    rows.push(row)
  }
  return rows
}

/** 默认网格尺寸（列 x 行），给新建 Sheet 用 */
export const DEFAULT_COLS = 6
export const DEFAULT_ROWS = 20

/** 新建表默认名：上午（00:00~12:00）用今天、下午（12:00~24:00）用次日，如 10.19 / 10.20 */
export function dateSheetName(now: Date = new Date()): string {
  const d = new Date(now)
  if (d.getHours() >= 12) d.setDate(d.getDate() + 1)
  return `${d.getMonth() + 1}.${d.getDate()}`
}

/** 在已用名称里挑一个未占用的默认名；重名时依次加后缀 -2、-3… */
export function nextSheetName(usedNames: string[], now: Date = new Date()): string {
  const used = new Set(usedNames)
  const base = dateSheetName(now)
  if (!used.has(base)) return base
  let n = 2
  while (used.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}

/** 新建一张空白表（不含 id） */
export function blankSheet(name: string): Omit<Sheet, 'id'> {
  const at = Date.now()
  return {
    name,
    cells: {},
    colCount: DEFAULT_COLS,
    rowCount: DEFAULT_ROWS,
    colWidths: {},
    createdAt: at,
    updatedAt: at,
  }
}

/** 从 CSV 行构建表（不含 id） */
export function sheetFromCsv(name: string, rows: string[][]): Omit<Sheet, 'id'> {
  const safeRows = rows.filter((r) => r.some((v) => v.trim())).map((r) => r.map((v) => v.trim()))
  const rowCount = Math.max(1, safeRows.length)
  const colCount = Math.max(1, ...safeRows.map((r) => r.length))
  const cells: Record<string, SheetCell> = {}
  safeRows.forEach((r, ri) =>
    r.forEach((v, ci) => {
      if (v) cells[sheetKey(ri, ci)] = { v }
    })
  )
  const at = Date.now()
  return {
    name,
    cells,
    colCount,
    rowCount,
    colWidths: {},
    createdAt: at,
    updatedAt: at,
  }
}