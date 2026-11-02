import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../store/AppContext'
import {
  colLabel,
  csvToRows,
  nextSheetName,
  parseSheetKey,
  sheetFromCsv,
  sheetKey,
  sheetValue,
} from '../lib/spreadsheet'
import {
  buildStyledHtml,
  matrixFromClipboard,
  toDelimited,
  writeRichToClipboard,
  type PasteCell,
} from '../lib/clipboard'
import * as XLSX from 'xlsx'
import {
  IconAlignCenter,
  IconAlignLeft,
  IconAlignRight,
  IconBrush,
  IconCalendarPlus,
  IconCheck,
  IconCopy,
  IconDownload,
  IconLayers,
  IconMaximize,
  IconMinimize,
  IconPlus,
  IconTable,
  IconTrash,
  IconUpload,
  IconX,
} from './Icons'
import { bridge } from '../lib/bridge'
import { clamp, cn } from '../lib/cn'
import { formatRelative } from '../lib/time'
import type { Sheet, SheetCell } from '../types'

const DEFAULT_COL_W = 110
const MIN_COL_W = 48
const MAX_COL_W = 400

const FONT_COLORS = [
  '#ffffff',
  '#ff5c7a',
  '#f5a524',
  '#2ee6d6',
  '#5b9dff',
  '#a78bfa',
  '#fb923c',
  '#34d399',
]

const CELL_COLORS = [
  '#7c5cff',
  '#2ee6d6',
  '#5b9dff',
  '#f5a524',
  '#ff5c7a',
  '#34d399',
  '#a78bfa',
  '#fb923c',
]

// 框选区域 / 格式刷样式载体
interface RectSel {
  r0: number
  c0: number
  r1: number
  c1: number
}
interface PainterStyle {
  bold?: boolean
  color?: string
  fc?: string
  align?: 'left' | 'center' | 'right'
}

const normRect = (r0: number, c0: number, r1: number, c1: number): RectSel => ({
  r0: Math.min(r0, r1),
  c0: Math.min(c0, c1),
  r1: Math.max(r0, r1),
  c1: Math.max(c0, c1),
})
const rowKeysOf = (s: Sheet, r: number) => Array.from({ length: s.colCount }, (_, c) => sheetKey(r, c))
const colKeysOf = (s: Sheet, c: number) => Array.from({ length: s.rowCount }, (_, r) => sheetKey(r, c))
const rectKeysOf = (s: Sheet, rc: RectSel) => {
  const out: string[] = []
  for (let r = rc.r0; r <= Math.min(rc.r1, s.rowCount - 1); r++)
    for (let c = rc.c0; c <= Math.min(rc.c1, s.colCount - 1); c++) out.push(sheetKey(r, c))
  return out
}

// --------------------------------------------------------------------------
// 单元格：单击选中展示计算结果；双击 / Enter / F2 / 直接打字进入编辑
// --------------------------------------------------------------------------

function GridCell({
  r,
  c,
  cell,
  display,
  active,
  selected,
  rowSelected,
  colSelected,
  inRect,
  seed,
  onDown,
  onEdit,
  onEnter,
  onCommit,
  onMove,
  onCancel,
}: {
  r: number
  c: number
  cell: SheetCell | undefined
  display: string
  active: boolean
  selected: boolean
  rowSelected: boolean
  colSelected: boolean
  inRect: boolean
  /** 直接打字进入编辑时的首字符（替换原内容）；正常进入编辑为 null */
  seed: string | null
  onDown: (r: number, c: number) => void
  onEdit: (r: number, c: number) => void
  onEnter: (r: number, c: number, buttons: number) => void
  onCommit: (r: number, c: number, value: string) => void
  onMove: (r: number, c: number) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(cell?.v ?? '')
  const ref = useRef<HTMLTextAreaElement>(null)
  const cancelled = useRef(false)
  const moved = useRef(false)

  useEffect(() => {
    if (active) {
      cancelled.current = false
      moved.current = false
      setDraft(seed ?? cell?.v ?? '')
      const typed = seed != null
      const t = window.setTimeout(() => {
        const el = ref.current
        if (!el) return
        if (typed) {
          // 打字进入：光标放到末尾继续输入
          el.focus()
          el.selectionStart = el.selectionEnd = el.value.length
        } else {
          el.select()
        }
      }, 0)
      return () => window.clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  // 编辑框高度随内容自动增长（支持多行）
  useEffect(() => {
    const el = ref.current
    if (active && el) {
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
    }
  }, [active, draft])

  if (active) {
    return (
      <td className="sheet-cell sheet-editing">
        <textarea
          ref={ref}
          value={draft}
          rows={1}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          className="sheet-input"
          style={{
            fontWeight: cell?.bold ? 700 : undefined,
            textAlign: cell?.align ?? 'left',
            background: cell?.color ?? undefined,
            color: cell?.fc ?? undefined,
          }}
          onBlur={() => {
            if (cancelled.current) {
              cancelled.current = false
              return
            }
            if (moved.current) {
              moved.current = false
              return
            }
            onCommit(r, c, draft)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              // ⌘+回车：在光标处插入换行
              e.preventDefault()
              const el = ref.current
              const pos = el ? el.selectionStart : draft.length
              const endPos = el ? el.selectionEnd : pos
              setDraft(draft.slice(0, pos) + '\n' + draft.slice(endPos))
              window.setTimeout(() => {
                if (el) {
                  el.focus()
                  el.selectionStart = el.selectionEnd = pos + 1
                }
              }, 0)
            } else if (e.key === 'Enter') {
              e.preventDefault()
              moved.current = true
              onCommit(r, c, draft)
              onMove(r + 1, c)
            } else if (e.key === 'Tab') {
              e.preventDefault()
              moved.current = true
              onCommit(r, c, draft)
              onMove(r, c + (e.shiftKey ? -1 : 1))
            } else if (e.key === 'Escape') {
              e.preventDefault()
              cancelled.current = true
              onCancel()
            }
          }}
        />
      </td>
    )
  }

  const isErr = display === '#ERROR!' || display === '#循环引用!'
  const multiline = display.includes('\n')
  return (
    <td
      className={cn(
        'sheet-cell',
        selected && 'sheet-selected',
        (rowSelected || colSelected) && 'sheet-row-selected',
        inRect && 'sheet-in-rect'
      )}
      onMouseDown={(e) => {
        if (e.button === 0) onDown(r, c)
      }}
      onDoubleClick={(e) => {
        e.preventDefault()
        onEdit(r, c)
      }}
      onMouseEnter={(e) => onEnter(r, c, e.buttons)}
      style={{ background: cell?.color ?? undefined }}
    >
      <div
        className={cn(
          'sheet-display',
          multiline ? 'sheet-multiline' : 'truncate',
          cell?.bold && 'font-semibold',
          isErr && 'text-[var(--warn)]'
        )}
        style={{ textAlign: cell?.align ?? 'left', color: cell?.fc ?? undefined }}
      >
        {display || '\u00A0'}
      </div>
    </td>
  )
}

// --------------------------------------------------------------------------
// 工作清单：飞书风格的多 Sheet 表格
// --------------------------------------------------------------------------

export function SheetsBoard({
  now,
  fullscreen,
  onToggleFullscreen,
}: {
  now: number
  fullscreen: boolean
  onToggleFullscreen: () => void
}) {
  const {
    sheets,
    activeSheetId,
    setActiveSheetId,
    addSheet,
    renameSheet,
    removeSheet,
    updateSheet,
    pushToast,
  } = useApp()

  const sheet = useMemo(
    () => sheets.find((s) => s.id === activeSheetId) ?? sheets[0] ?? null,
    [sheets, activeSheetId]
  )
  const sheetRef = useRef<Sheet | null>(sheet)
  useEffect(() => {
    sheetRef.current = sheet
  }, [sheet])

  // 正在编辑的单元格 / 最近选中的单元格（格式按钮作用于选中态）
  const [editKey, setEditKey] = useState<string | null>(null)
  const [selectKey, setSelectKey] = useState<string | null>(null)
  // 直接打字进入编辑时的首字符（替换原内容）
  const [editSeed, setEditSeed] = useState<string | null>(null)
  // 整行/整列选中（点行号或列标）：优先于单元格选中，作用于格式化 / 复制粘贴
  const [rowSel, setRowSel] = useState<number | null>(null)
  const [colSel, setColSel] = useState<number | null>(null)
  // 鼠标拖拽框选区域
  const [rectSel, setRectSel] = useState<RectSel | null>(null)
  const rectSelRef = useRef<RectSel | null>(null)
  const rectStart = useRef<{ r: number; c: number } | null>(null)
  const rectDragging = useRef(false)
  const suppressCommitRef = useRef<string | null>(null)
  // 格式刷：记录源样式，点击/框选目标后应用并自动关闭
  const [painter, setPainter] = useState<PainterStyle | null>(null)
  const painterRef = useRef<PainterStyle | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [colorOpen, setColorOpen] = useState(false)
  const [fcOpen, setFcOpen] = useState(false)
  /** 新建工作表面板（可选日期区间命名） */
  const [newOpen, setNewOpen] = useState(false)
  const [newStart, setNewStart] = useState('')
  const [newEnd, setNewEnd] = useState('')
  const [newPos, setNewPos] = useState<{ left: number; bottom: number } | null>(null)
  const newBtnRef = useRef<HTMLButtonElement>(null)
  const [resizing, setResizing] = useState<{ c: number; w: number } | null>(null)
  const resizeRef = useRef<{ c: number; startX: number; startW: number; w: number } | null>(null)

  // 切换工作表时收起编辑态
  useEffect(() => {
    setEditKey(null)
    setSelectKey(null)
    setRowSel(null)
    setColSel(null)
    setRectSel(null)
    rectSelRef.current = null
    setPainter(null)
    painterRef.current = null
    setRenamingId(null)
    setColorOpen(false)
    setFcOpen(false)
  }, [sheet?.id])

  const colWidthOf = useCallback(
    (c: number) => sheet?.colWidths[`C${c}`] ?? DEFAULT_COL_W,
    [sheet]
  )

  // 每个单元格的展示文本（公式在此处求值，一次渲染算一遍）
  const displayMap = useMemo(() => {
    const map = new Map<string, string>()
    const s = sheet
    if (!s) return map
    for (let r = 0; r < s.rowCount; r++)
      for (let c = 0; c < s.colCount; c++) map.set(sheetKey(r, c), sheetValue(s, sheetKey(r, c)))
    return map
  }, [sheet])

  const rowIndexes = sheet ? Array.from({ length: sheet.rowCount }, (_, i) => i) : []
  const colIndexes = sheet ? Array.from({ length: sheet.colCount }, (_, i) => i) : []

  // ---------------------------------------------------------------- 列宽拖拽
  const startResize = (e: React.MouseEvent, c: number) => {
    e.preventDefault()
    e.stopPropagation()
    resizeRef.current = { c, startX: e.clientX, startW: colWidthOf(c), w: colWidthOf(c) }
    setResizing({ c, w: colWidthOf(c) })
  }

  useEffect(() => {
    if (!resizing) return
    const onMove = (e: MouseEvent) => {
      const r = resizeRef.current
      if (!r) return
      r.w = clamp(r.startW + (e.clientX - r.startX), MIN_COL_W, MAX_COL_W)
      setResizing({ c: r.c, w: r.w })
    }
    const onUp = () => {
      const r = resizeRef.current
      const s = sheetRef.current
      if (r && s) {
        updateSheet(s.id, { colWidths: { ...s.colWidths, [`C${r.c}`]: r.w } })
      }
      resizeRef.current = null
      setResizing(null)
      document.body.style.userSelect = ''
    }
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resizing])

  // ---------------------------------------------------------------- 单元格
  /** 格式刷：把记录的样式应用到指定单元格集合，然后自动关闭 */
  const applyPainterTo = useCallback(
    (keys: string[]) => {
      const s = sheetRef.current
      const p = painterRef.current
      if (!s || !p || !keys.length) return
      const cells = { ...s.cells }
      for (const k of keys) {
        const next: SheetCell = { ...(cells[k] ?? { v: '' }) }
        if (p.bold) next.bold = true
        else delete next.bold
        if (p.color) next.color = p.color
        else delete next.color
        if (p.fc) next.fc = p.fc
        else delete next.fc
        if (p.align) next.align = p.align
        else delete next.align
        cells[k] = next
      }
      updateSheet(s.id, { cells })
      painterRef.current = null
      setPainter(null)
      pushToast({ tone: 'ok', title: '格式刷已应用', body: `样式已写入 ${keys.length} 个单元格` })
    },
    [updateSheet, pushToast]
  )

  /** 开启/关闭格式刷：取当前选区首格的样式 */
  const togglePainter = () => {
    if (painter) {
      setPainter(null)
      painterRef.current = null
      return
    }
    const s = sheetRef.current
    const src = targetKeys.length && s ? s.cells[targetKeys[0]] : undefined
    if (!src || (!src.bold && !src.color && !src.fc && !src.align)) {
      pushToast({
        tone: 'warn',
        title: '源单元格没有样式',
        body: '先选中带加粗 / 底色 / 字色 / 对齐的单元格、行列或区域',
      })
      return
    }
    const style: PainterStyle = { bold: src.bold, color: src.color, fc: src.fc, align: src.align }
    setPainter(style)
    painterRef.current = style
    pushToast({ tone: 'info', title: '格式刷已开启', body: '点击或框选目标后自动应用，Esc 取消' })
  }

  /** 仅选中单元格（收起其它选区）；返回选中 key，越界返回 null */
  const selectCell = useCallback((r: number, c: number): string | null => {
    const s = sheetRef.current
    if (!s || r < 0 || r >= s.rowCount || c < 0 || c >= s.colCount) return null
    const key = sheetKey(r, c)
    setSelectKey(key)
    setRowSel(null)
    setColSel(null)
    setRectSel(null)
    rectSelRef.current = null
    setColorOpen(false)
    setFcOpen(false)
    return key
  }, [])

  /** 进入编辑态：双击 / Enter / F2 / 直接打字（seed 为首字符） */
  const startEdit = useCallback(
    (r: number, c: number, seed: string | null = null) => {
      const key = selectCell(r, c)
      if (!key) return
      if (painterRef.current) {
        applyPainterTo([key])
        return
      }
      setEditSeed(seed)
      setEditKey(key)
    },
    [selectCell, applyPainterTo]
  )

  /** 单击：只选中，不进入编辑 */
  const handleActivate = useCallback(
    (r: number, c: number) => {
      const key = selectCell(r, c)
      if (!key) return
      if (painterRef.current) applyPainterTo([key])
    },
    [selectCell, applyPainterTo]
  )

  /** 按下单元格：记录框选起点（未拖动则视为单击） */
  const handleCellDown = (r: number, c: number) => {
    rectStart.current = { r, c }
    rectDragging.current = false
  }

  /** 按住并移入其他单元格：进入框选 */
  const handleCellEnter = (r: number, c: number, buttons: number) => {
    const st = rectStart.current
    if (!st || buttons !== 1) return
    if (!rectDragging.current && st.r === r && st.c === c) return
    rectDragging.current = true
    const rc = normRect(st.r, st.c, r, c)
    rectSelRef.current = rc
    setRectSel(rc)
    setEditKey(null)
    setSelectKey(sheetKey(st.r, st.c))
    setRowSel(null)
    setColSel(null)
    setColorOpen(false)
    setFcOpen(false)
  }

  /** 松开鼠标：单击 → 选中；拖框结束 → 保持区域选中（格式刷此时应用） */
  useEffect(() => {
    const onUp = () => {
      const st = rectStart.current
      if (!st) return
      rectStart.current = null
      if (!rectDragging.current) {
        handleActivate(st.r, st.c)
        return
      }
      rectDragging.current = false
      const rc = rectSelRef.current
      const s = sheetRef.current
      if (painterRef.current && rc && s) applyPainterTo(rectKeysOf(s, rc))
    }
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [handleActivate, applyPainterTo])

  /** Esc：取消格式刷 / 选中（并阻止冒泡，避免误退出全屏） */
  useEffect(() => {
    if (!painter && !rectSel && rowSel === null && colSel === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      e.stopPropagation()
      setPainter(null)
      painterRef.current = null
      setRectSel(null)
      rectSelRef.current = null
      setRowSel(null)
      setColSel(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [painter, rectSel, rowSel, colSel])

  const handleCommit = useCallback((r: number, c: number, value: string) => {
    const s = sheetRef.current
    if (!s) return
    const key = sheetKey(r, c)
    // 编辑态中被表格粘贴接管：丢弃本次 blur 提交，避免覆盖刚粘贴的内容
    if (suppressCommitRef.current === key) {
      suppressCommitRef.current = null
      return
    }
    const trimmed = value.trim()
    const cells = { ...s.cells }
    if (trimmed) {
      const prev = cells[key]
      cells[key] = { ...(prev ?? {}), v: trimmed }
    } else {
      delete cells[key]
    }
    updateSheet(s.id, { cells })
    setSelectKey(key)
    setEditKey(null) // 提交后退出编辑，但仍保持选中态
  }, [updateSheet])

  const handleMove = useCallback(
    (r: number, c: number) => {
      // Enter/Tab 提交后仅移动选中（编辑需双击 / 直接打字进入）
      selectCell(r, c)
    },
    [selectCell]
  )

  const handleCancel = useCallback(() => {
    setEditKey(null)
  }, [])

  // ---------------------------------------------------------------- 行列
  const addRow = () => {
    const s = sheetRef.current
    if (s && s.rowCount < 500) updateSheet(s.id, { rowCount: s.rowCount + 1 })
  }
  const addCol = () => {
    const s = sheetRef.current
    if (s && s.colCount < 99) updateSheet(s.id, { colCount: s.colCount + 1 })
  }
  const removeRow = () => {
    const s = sheetRef.current
    if (!s || s.rowCount <= 1) return
    const last = s.rowCount - 1
    const cells = { ...s.cells }
    for (let c = 0; c < s.colCount; c++) delete cells[sheetKey(last, c)]
    updateSheet(s.id, { cells, rowCount: last })
    setEditKey(null)
    setSelectKey(null)
    setRowSel(null)
    setRectSel(null)
    rectSelRef.current = null
  }
  const removeCol = () => {
    const s = sheetRef.current
    if (!s || s.colCount <= 1) return
    const last = s.colCount - 1
    const cells = { ...s.cells }
    for (let r = 0; r < s.rowCount; r++) delete cells[sheetKey(r, last)]
    updateSheet(s.id, { cells, colCount: last })
    setEditKey(null)
    setSelectKey(null)
    setColSel(null)
    setRectSel(null)
    rectSelRef.current = null
  }

  // ---------------------------------------------------------------- 样式
  /** 当前格式作用对象：整行 > 整列 > 框选区域 > 单个单元格 */
  const targetKeys = useMemo(() => {
    if (!sheet) return [] as string[]
    if (rowSel !== null) return rowSel < sheet.rowCount ? rowKeysOf(sheet, rowSel) : []
    if (colSel !== null) return colSel < sheet.colCount ? colKeysOf(sheet, colSel) : []
    if (rectSel) return rectKeysOf(sheet, rectSel)
    return selectKey ? [selectKey] : []
  }, [sheet, rowSel, colSel, rectSel, selectKey])

  const activeCell = useMemo(
    () => (sheet && targetKeys.length ? sheet.cells[targetKeys[0]] : undefined),
    [sheet, targetKeys]
  )

  /** 对选区内所有单元格应用样式补丁 */
  const patchTargets = (fn: (prev: SheetCell | undefined) => SheetCell | undefined) => {
    const s = sheetRef.current
    if (!s || !targetKeys.length) return
    const cells = { ...s.cells }
    for (const k of targetKeys) {
      const next = fn(cells[k])
      if (next) cells[k] = next
      else delete cells[k]
    }
    updateSheet(s.id, { cells })
  }

  const toggleBold = () => patchTargets((prev) => ({ ...(prev ?? { v: '' }), bold: !activeCell?.bold }))

  const setAlign = (align: 'left' | 'center' | 'right') =>
    patchTargets((prev) => ({ ...(prev ?? { v: '' }), align }))

  const setCellColor = (color: string | null) => {
    patchTargets((prev) => {
      if (!color) {
        if (!prev) return prev
        const { color: _ignored, ...rest } = prev
        return rest
      }
      return { ...(prev ?? { v: '' }), color }
    })
    setColorOpen(false)
  }

  const setFontColor = (color: string | null) => {
    patchTargets((prev) => {
      if (!color) {
        if (!prev) return prev
        const { fc: _ignored, ...rest } = prev
        return rest
      }
      return { ...(prev ?? { v: '' }), fc: color }
    })
    setFcOpen(false)
  }

  // ---------------------------------------------------------------- 选区与剪贴板
  /** 点行号：选中/取消整行 */
  const handleRowSelect = (r: number) => {
    setEditKey(null)
    setSelectKey(null)
    setColorOpen(false)
    setFcOpen(false)
    setColSel(null)
    setRectSel(null)
    rectSelRef.current = null
    if (painterRef.current) {
      const s = sheetRef.current
      if (s && r < s.rowCount) applyPainterTo(rowKeysOf(s, r))
      return
    }
    setRowSel((prev) => (prev === r ? null : r))
  }

  /** 点列标：选中/取消整列 */
  const handleColSelect = (c: number) => {
    setEditKey(null)
    setSelectKey(null)
    setColorOpen(false)
    setFcOpen(false)
    setRowSel(null)
    setRectSel(null)
    rectSelRef.current = null
    if (painterRef.current) {
      const s = sheetRef.current
      if (s && c < s.colCount) applyPainterTo(colKeysOf(s, c))
      return
    }
    setColSel((prev) => (prev === c ? null : c))
  }

  /** 单元格 → 剪贴板单元（值 + 样式） */
  const pasteCellAt = (s: Sheet, key: string): PasteCell => {
    const cell = s.cells[key]
    const out: PasteCell = { v: sheetValue(s, key) }
    if (cell?.bold) out.bold = true
    if (cell?.color) out.color = cell.color
    if (cell?.fc) out.fc = cell.fc
    if (cell?.align) out.align = cell.align
    return out
  }

  /** 当前选区 → 剪贴板载荷：TSV 文本（外部 Excel 认）+ 带样式 HTML（粘回本应用还原样式） */
  const buildCopyPayload = (): { text: string; html: string } | null => {
    const s = sheetRef.current
    if (!s) return null
    let matrix: PasteCell[][] | null = null
    if (rowSel !== null && rowSel < s.rowCount) {
      matrix = [Array.from({ length: s.colCount }, (_, c) => pasteCellAt(s, sheetKey(rowSel, c)))]
    } else if (colSel !== null && colSel < s.colCount) {
      matrix = Array.from({ length: s.rowCount }, (_, r) => [pasteCellAt(s, sheetKey(r, colSel))])
    } else if (rectSel) {
      matrix = []
      for (let r = rectSel.r0; r <= Math.min(rectSel.r1, s.rowCount - 1); r++) {
        const row: PasteCell[] = []
        for (let c = rectSel.c0; c <= Math.min(rectSel.c1, s.colCount - 1); c++)
          row.push(pasteCellAt(s, sheetKey(r, c)))
        matrix.push(row)
      }
    } else if (selectKey && parseSheetKey(selectKey)) {
      matrix = [[pasteCellAt(s, selectKey)]]
    }
    if (!matrix) return null
    return {
      text: toDelimited(matrix.map((row) => row.map((c) => c.v))),
      html: buildStyledHtml(matrix),
    }
  }

  /** execCommand 兜底复制时派发的 DOM copy 事件，不再重复弹 toast */
  const suppressCopyToast = useRef(false)

  const copiedTitle = () =>
    rowSel !== null
      ? `已复制第 ${rowSel + 1} 行`
      : colSel !== null
        ? `已复制 ${colLabel(colSel!)} 列`
        : rectSel
          ? `已复制 ${rectSel.r1 - rectSel.r0 + 1} 行 × ${rectSel.c1 - rectSel.c0 + 1} 列`
          : '已复制单元格'

  const copySelection = async () => {
    const payload = buildCopyPayload()
    if (!payload) {
      pushToast({ tone: 'warn', title: '先选中内容', body: '点行号/列标选整行整列，拖拽框选区域，或点击一个单元格' })
      return
    }
    const ok = await writeRichToClipboard(payload.text, payload.html, {
      onBeforeExecCopy: () => {
        suppressCopyToast.current = true
      },
      onAfterExecCopy: () => {
        suppressCopyToast.current = false
      },
    })
    pushToast(
      ok
        ? { tone: 'ok', title: copiedTitle(), body: '⌘V 可粘贴到其它工作表或外部 Excel' }
        : { tone: 'warn', title: '复制失败', body: '请检查剪贴板权限' }
    )
  }

  /** 矩阵粘贴到 (startR, startC)：逐格展开，超界自动扩行列 */
  const pasteMatrix = (matrix: PasteCell[][], startR: number, startC: number) => {
    const s = sheetRef.current
    if (!s) return
    const cells = { ...s.cells }
    let maxR = startR
    let maxC = startC
    matrix.forEach((row, ri) => {
      row.forEach((cell, ci) => {
        const r = startR + ri
        const c = startC + ci
        if (r > 499 || c > 98) return
        if (r > maxR) maxR = r
        if (c > maxC) maxC = c
        const key = sheetKey(r, c)
        const hasStyle =
          cell.bold !== undefined ||
          cell.color !== undefined ||
          cell.fc !== undefined ||
          cell.align !== undefined
        if (!cell.v && !hasStyle) {
          delete cells[key]
          return
        }
        const next: SheetCell = { ...(cells[key] ?? { v: '' }), v: cell.v }
        if (cell.bold !== undefined) next.bold = cell.bold
        if (cell.color !== undefined) {
          if (cell.color) next.color = cell.color
          else delete next.color
        }
        if (cell.fc !== undefined) {
          if (cell.fc) next.fc = cell.fc
          else delete next.fc
        }
        if (cell.align !== undefined) next.align = cell.align
        cells[key] = next
      })
    })
    const cols = Math.max(...matrix.map((m) => m.length), 1)
    updateSheet(s.id, {
      cells,
      rowCount: Math.min(500, Math.max(s.rowCount, maxR + 1)),
      colCount: Math.min(99, Math.max(s.colCount, maxC + 1)),
    })
    pushToast({
      tone: 'ok',
      title: `已粘贴 ${matrix.length} 行 × ${cols} 列`,
      body: '加粗、对齐、底色、字色一并还原',
    })
  }

  /** 清除选中区域的内容（保留样式），Delete/Backspace 或提示条按钮触发 */
  const clearSelection = () => {
    const s = sheetRef.current
    if (!s || !targetKeys.length) return
    const cells = { ...s.cells }
    let n = 0
    for (const k of targetKeys) {
      const c = cells[k]
      if (!c || c.v === '') continue
      n += 1
      const { v: _v, ...rest } = c
      if (Object.keys(rest).length > 0) cells[k] = { ...rest, v: '' }
      else delete cells[k]
    }
    if (!n) {
      pushToast({ tone: 'info', title: '选中区域没有内容', body: '' })
      return
    }
    updateSheet(s.id, { cells })
    pushToast({ tone: 'ok', title: `已清除 ${n} 个单元格`, body: '内容已删除，样式保留' })
  }

  // 选中态下按 Delete/Backspace：清除内容（编辑输入框内不拦截）
  useEffect(() => {
    const hasSel =
      rowSel !== null || colSel !== null || rectSel !== null || (!!selectKey && !editKey)
    if (!hasSel) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      e.preventDefault()
      clearSelection()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowSel, colSel, rectSel, selectKey, editKey, targetKeys])

  // 选中态（未编辑）键盘导航：方向键移动 / Enter·F2·直接打字进入编辑 / Esc 取消选中
  useEffect(() => {
    if (!selectKey || editKey || rowSel !== null || colSel !== null || rectSel !== null) return
    const parsed = parseSheetKey(selectKey)
    if (!parsed) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const s = sheetRef.current
      if (!s) return
      const { r, c } = parsed
      if (e.key === 'Enter' || e.key === 'F2') {
        // 刚点过工具栏按钮时 Enter 保留给按钮激活
        if (e.key === 'Enter' && t && t.closest('button')) return
        e.preventDefault()
        startEdit(r, c)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation() // 先取消选中，不冒泡触发退出全屏
        setSelectKey(null)
      } else if (
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown' ||
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight'
      ) {
        e.preventDefault()
        selectCell(
          r + (e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0),
          c + (e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0)
        )
      } else if (e.key.length === 1) {
        // 直接打字：进入编辑并替换原内容（同飞书/Excel）
        e.preventDefault()
        startEdit(r, c, e.key)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selectKey, editKey, rowSel, colSel, rectSel, startEdit, selectCell])

  // 复制/粘贴：同时响应键盘和顶部菜单（Electron 的 role 会派发 DOM copy/paste 事件）
  useEffect(() => {
    if (!sheet) return
    const isTyping = (el: EventTarget | null) => {
      const t = el as HTMLElement | null
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
    }
    const onCopy = (e: ClipboardEvent) => {
      if (isTyping(e.target)) {
        // 输入框内整格全选（激活单元格默认全选）→ 也带样式复制
        const t = e.target as HTMLInputElement
        const full =
          editKey != null &&
          typeof t.selectionStart === 'number' &&
          t.selectionStart === 0 &&
          t.selectionEnd === (t.value ?? '').length
        if (!full) return
      } else if (editKey) return
      const payload = buildCopyPayload()
      if (!payload || !e.clipboardData) return
      e.preventDefault()
      e.clipboardData.setData('text/plain', payload.text)
      e.clipboardData.setData('text/html', payload.html)
      if (suppressCopyToast.current) {
        suppressCopyToast.current = false
        return
      }
      pushToast({
        tone: 'ok',
        title: copiedTitle(),
        body: '⌘V 可粘贴到其它工作表或外部 Excel',
      })
    }
    const onPaste = (e: ClipboardEvent) => {
      const typing = isTyping(e.target)
      // 正在输入框里编辑：粘贴"表格"（多行或多列）→ 退出编辑并逐格展开；单值粘贴走原生
      if (typing && editKey) {
        const matrix = matrixFromClipboard(e.clipboardData)
        const html = e.clipboardData?.getData('text/html') ?? ''
        const isMulti =
          matrix.length > 1 || (matrix[0]?.length ?? 0) > 1 || /<table[\s>]/i.test(html)
        if (!isMulti) return
        const p = parseSheetKey(editKey)
        if (!p) return
        e.preventDefault()
        suppressCommitRef.current = editKey
        setEditKey(null)
        setSelectKey(editKey)
        setRowSel(null)
        setColSel(null)
        setRectSel(null)
        rectSelRef.current = null
        pasteMatrix(matrix, p.r, p.c)
        window.setTimeout(() => {
          suppressCommitRef.current = null
        }, 0)
        return
      }
      if (typing || editKey) return
      let startR = -1
      let startC = 0
      if (rowSel !== null) {
        startR = rowSel
      } else if (colSel !== null) {
        startR = 0
        startC = colSel
      } else if (rectSel) {
        startR = rectSel.r0
        startC = rectSel.c0
      } else if (selectKey) {
        const p = parseSheetKey(selectKey)
        if (p) {
          startR = p.r
          startC = p.c
        }
      }
      if (startR < 0) return
      const matrix = matrixFromClipboard(e.clipboardData)
      if (!matrix.length) return
      e.preventDefault()
      pasteMatrix(matrix, startR, startC)
    }
    document.addEventListener('copy', onCopy)
    document.addEventListener('paste', onPaste)
    return () => {
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('paste', onPaste)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet, rowSel, colSel, rectSel, selectKey, editKey])

  // ---------------------------------------------------------------- Sheet 标签
  const addBlankSheet = () => {
    const s = addSheet()
    pushToast({ tone: 'ok', title: `已创建「${s.name}」`, body: '点击下方标签切换工作表，双击标签可重命名' })
  }

  /** 默认名：上午用今天、下午用次日（如 10.19）；重名依次加后缀 -2、-3… */
  const defaultSheetName = () => nextSheetName(sheets.map((s) => s.name))

  /** 选择日期区间后的名称预览：26-10-12~26-10-16 / 26-09-01~26-09-08 */
  const previewName =
    newStart && newEnd
      ? (() => {
          const [a, b] = newStart <= newEnd ? [newStart, newEnd] : [newEnd, newStart]
          return `${a.slice(2)}~${b.slice(2)}`
        })()
      : defaultSheetName()

  const openNewPanel = () => {
    const el = newBtnRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setNewStart('')
    setNewEnd('')
    setNewPos({
      left: Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - 320 - 8)),
      bottom: window.innerHeight - r.top + 8,
    })
    setNewOpen(true)
  }
  const closeNewPanel = () => setNewOpen(false)

  const createFromPanel = () => {
    const s = addSheet(newStart && newEnd ? previewName : '')
    pushToast({ tone: 'ok', title: `已创建「${s.name}」`, body: '点击下方标签切换工作表，双击标签可重命名' })
    closeNewPanel()
  }
  const removeSheetTab = (id: string) => {
    if (sheets.length <= 1) {
      pushToast({ tone: 'warn', title: '至少保留一个工作表', body: '当前已是最后一个，无法删除' })
      return
    }
    if (removeSheet(id)) pushToast({ tone: 'info', title: '已删除工作表', body: '' })
  }
  const commitRename = () => {
    const id = renamingId
    setRenamingId(null)
    if (!id) return
    const s = sheets.find((x) => x.id === id)
    const name = renameDraft.trim()
    if (s && name && name !== s.name) renameSheet(id, name)
  }

  // ---------------------------------------------------------------- Excel / CSV
  /** 当前工作表 → xlsx（base64）→ 系统保存对话框 */
  const exportExcel = async () => {
    const s = sheetRef.current
    if (!s) return
    const aoa = Array.from({ length: s.rowCount }, (_, r) =>
      Array.from({ length: s.colCount }, (_, c) => sheetValue(s, sheetKey(r, c)))
    )
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31) || 'Sheet1')
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'base64', compression: true })
    const path = await bridge.saveFile({ defaultName: `${s.name}.xlsx`, content: wbout, format: 'xlsx' })
    if (path) pushToast({ tone: 'ok', title: '已导出 Excel', body: path })
    else pushToast({ tone: 'info', title: '已取消导出', body: '' })
  }

  /** Excel / CSV → 新建一个工作表 */
  const importExcel = async () => {
    const res = await bridge.openFile()
    if (!res) return
    try {
      let rows: string[][]
      if (res.type === 'xlsx') {
        const bin = Uint8Array.from(atob(res.content), (c) => c.charCodeAt(0))
        const wb = XLSX.read(bin, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        if (!ws) {
          pushToast({ tone: 'warn', title: 'Excel 里没有工作表', body: res.name })
          return
        }
        rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: '' })
      } else {
        rows = csvToRows(res.content)
      }
      if (!rows.length) {
        pushToast({ tone: 'warn', title: '文件内容为空', body: '没有可导入的数据' })
        return
      }
      const name = (res.name.replace(/\.(csv|xlsx|xls)$/i, '').trim() || '导入表格').slice(0, 40)
      const created = addSheet({ ...sheetFromCsv(name, rows) })
      pushToast({ tone: 'ok', title: `已导入「${name}」`, body: `${created.rowCount} 行 × ${created.colCount} 列` })
    } catch {
      pushToast({ tone: 'warn', title: '文件读取失败', body: '请确认是 .xlsx 或 .csv 文件' })
    }
  }

  // ---------------------------------------------------------------- 渲染
  if (!sheet) {
    return (
      <div className="glass sheen flex flex-col items-center gap-4 rounded-[22px] px-6 py-16 text-center">
        <span
          className="flex h-14 w-14 items-center justify-center rounded-2xl"
          style={{ background: 'rgba(124,92,255,0.14)', color: 'var(--accent)' }}
        >
          <IconTable size={26} />
        </span>
        <p className="font-display text-[16px] font-bold t1">还没有工作表</p>
        <button className="btn btn-primary" onClick={addBlankSheet}>
          <IconPlus size={15} />
          新建工作表
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* 标题（全屏时左侧留出红绿灯按钮的位置） */}
      <div className={cn('flex flex-wrap items-end justify-between gap-3', fullscreen && 'pl-[68px]')}>
        <div className="flex items-center gap-3.5">
          <span
            className="flex h-11 w-11 items-center justify-center rounded-2xl"
            style={{ background: 'rgba(124,92,255,0.14)', color: 'var(--accent)' }}
          >
            <IconTable size={21} />
          </span>
          <div>
            <h1 className="font-display text-[20px] font-bold t1">工作清单</h1>
            <p className="mt-0.5 text-[12.5px] t3">
              {sheets.length} 个工作表 · 当前 {sheet.colCount} 列 × {sheet.rowCount} 行 · 自动保存到本地
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden text-right text-[12px] t3 sm:block">
            上次编辑 <span className="tnum">{formatRelative(sheet.updatedAt, now)}</span>
          </div>

          <button
            onClick={onToggleFullscreen}
            title={fullscreen ? '退出全屏（Esc）' : '全屏编辑，隐藏顶栏和侧栏'}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-line bg-surface t3 transition-colors hover:bg-surface-2 hover:t1"
          >
            {fullscreen ? <IconMinimize size={14} /> : <IconMaximize size={14} />}
          </button>
        </div>
      </div>

      {/* 工具栏 */}
      <section className="relative z-[60] rounded-2xl border border-line bg-surface/70 px-2.5 py-2 backdrop-blur-sm">
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex items-center gap-1.5 rounded-lg px-2 py-1">
            <IconLayers size={14} className="t3" />
            <span
              className="max-w-[160px] truncate text-[13px] font-semibold t1"
              title={`${sheet.name}（双击底部标签可重命名）`}
            >
              {sheet.name}
            </span>
          </div>

          {(rowSel !== null || colSel !== null || rectSel !== null) && (
            <span className="flex items-center gap-1.5 rounded-lg bg-[var(--accent-soft)] px-2 py-1 text-[12px] font-semibold t1">
              <IconCopy size={13} className="shrink-0 text-[var(--accent)]" />
              {rowSel !== null ? (
                <>
                  第 <span className="tnum">{rowSel + 1}</span> 行已选中
                </>
              ) : colSel !== null ? (
                <>
                  <span className="tnum">{colLabel(colSel)}</span> 列已选中
                </>
              ) : (
                <>
                  已选 <span className="tnum">{rectSel!.r1 - rectSel!.r0 + 1}</span> 行 ×{' '}
                  <span className="tnum">{rectSel!.c1 - rectSel!.c0 + 1}</span> 列
                </>
              )}
              <button
                onClick={copySelection}
                title="复制到剪贴板（⌘C）"
                className="btn btn-ghost !min-h-[22px] !rounded-md !px-2 text-[11.5px]"
              >
                复制
              </button>
              <button
                onClick={clearSelection}
                title="清除选中内容，保留样式（Delete）"
                className="btn btn-ghost !min-h-[22px] !rounded-md !px-2 text-[11.5px]"
              >
                清除
              </button>
              <button
                onClick={() => {
                  setRowSel(null)
                  setColSel(null)
                  setRectSel(null)
                  rectSelRef.current = null
                }}
                title="取消选中"
                className="t3 hover:t1"
              >
                <IconX size={13} />
              </button>
            </span>
          )}

          {painter && (
            <span className="flex items-center gap-1.5 rounded-lg bg-[var(--accent-soft)] px-2 py-1 text-[12px] font-semibold t1">
              <IconBrush size={13} className="shrink-0 text-[var(--accent)]" />
              格式刷已开启：点击 / 框选 / 点行列标应用
              <button
                onClick={() => {
                  setPainter(null)
                  painterRef.current = null
                }}
                title="取消（Esc）"
                className="t3 hover:t1"
              >
                <IconX size={13} />
              </button>
            </span>
          )}

          <span className="mx-1 h-5 w-px bg-[var(--line)]" />

          <button
            onClick={toggleBold}
            title="加粗选中单元格"
            className={cn(
              'btn btn-ghost !min-h-[30px] !rounded-lg !px-3 text-[13px] font-extrabold',
              activeCell?.bold && 't1 !border-[var(--accent)]'
            )}
          >
            B
          </button>

          <div className="flex items-center overflow-hidden rounded-lg border border-line">
            {(
              [
                { k: 'left', Icon: IconAlignLeft, title: '左对齐' },
                { k: 'center', Icon: IconAlignCenter, title: '居中' },
                { k: 'right', Icon: IconAlignRight, title: '右对齐' },
              ] as const
            ).map(({ k, Icon, title }) => (
              <button
                key={k}
                onClick={() => setAlign(k)}
                title={title}
                className={cn(
                  'flex h-[30px] w-9 items-center justify-center transition-colors',
                  (activeCell?.align ?? 'left') === k
                    ? 'bg-[var(--accent-soft)] t1'
                    : 't3 hover:bg-surface'
                )}
              >
                <Icon size={14} />
              </button>
            ))}
          </div>

          <div className="relative">
            <button
              onClick={() => {
                setFcOpen(false)
                setColorOpen((v) => !v)
              }}
              title="底色"
              className="btn btn-ghost !min-h-[30px] !rounded-lg !px-2.5 text-[12.5px]"
            >
              <span
                className="inline-block h-3.5 w-3.5 rounded-full"
                style={{ background: activeCell?.color ?? 'linear-gradient(135deg,#7c5cff,#2ee6d6)' }}
              />
              底色
            </button>
            {colorOpen && (
              <div className="glass absolute left-0 top-full z-30 mt-2 flex items-center gap-1.5 rounded-xl p-2 shadow-xl">
                {CELL_COLORS.map((c) => (
                  <button
                    key={c}
                    aria-label={`底色 ${c}`}
                    onClick={() => setCellColor(c)}
                    className="h-6 w-6 rounded-full border border-white/20 transition-transform hover:scale-110"
                    style={{ background: c }}
                  />
                ))}
                <span className="mx-1 h-5 w-px bg-[var(--line)]" />
                <button
                  onClick={() => setCellColor(null)}
                  className="text-[12px] t3 hover:t1"
                  title="清除底色"
                >
                  <IconCheck size={14} />
                </button>
              </div>
            )}
          </div>

          <div className="relative">
            <button
              onClick={() => {
                setColorOpen(false)
                setFcOpen((v) => !v)
              }}
              title="字体颜色"
              className="btn btn-ghost !min-h-[30px] !rounded-lg !px-2.5 text-[12.5px]"
            >
              <span
                className="flex h-4 w-4 items-center justify-center text-[12px] font-bold leading-none"
                style={{ color: activeCell?.fc ?? 'var(--text-1)' }}
              >
                A
              </span>
              <span
                className="inline-block h-1 w-4 rounded-full"
                style={{ background: activeCell?.fc ?? 'linear-gradient(135deg,#7c5cff,#2ee6d6)' }}
              />
              字色
            </button>
            {fcOpen && (
              <div className="glass absolute left-0 top-full z-30 mt-2 flex items-center gap-1.5 rounded-xl p-2 shadow-xl">
                {FONT_COLORS.map((c) => (
                  <button
                    key={c}
                    aria-label={`字色 ${c}`}
                    onClick={() => setFontColor(c)}
                    className="flex h-6 w-6 items-center justify-center rounded-full border border-white/20 text-[11px] font-bold leading-none transition-transform hover:scale-110"
                    style={{ color: c }}
                  >
                    A
                  </button>
                ))}
                <span className="mx-1 h-5 w-px bg-[var(--line)]" />
                <button
                  onClick={() => setFontColor(null)}
                  className="text-[12px] t3 hover:t1"
                  title="恢复默认字色"
                >
                  <IconCheck size={14} />
                </button>
              </div>
            )}
          </div>

          <button
            onClick={togglePainter}
            title="格式刷：复制选区样式，再点击/框选目标应用（Esc 取消）"
            className={cn(
              'btn btn-ghost !h-[30px] !min-h-[30px] !w-[30px] !rounded-lg !px-0',
              painter && '!border-[var(--accent)] bg-[var(--accent-soft)]'
            )}
          >
            <IconBrush size={14} className={painter ? 'text-[var(--accent)]' : 't3'} />
          </button>

          <span className="mx-1 h-5 w-px bg-[var(--line)]" />

          <button
            onClick={removeRow}
            disabled={sheet.rowCount <= 1}
            title="删除最后一行"
            className="btn btn-ghost !min-h-[30px] !rounded-lg !px-2.5 text-[12.5px] disabled:opacity-40"
          >
            <IconTrash size={13} className="t3" /> 删行
          </button>
          <button
            onClick={removeCol}
            disabled={sheet.colCount <= 1}
            title="删除最后一列"
            className="btn btn-ghost !min-h-[30px] !rounded-lg !px-2.5 text-[12.5px] disabled:opacity-40"
          >
            <IconTrash size={13} className="t3" /> 删列
          </button>

          <span className="mx-1 h-5 w-px bg-[var(--line)]" />

          <button onClick={importExcel} title="导入 Excel 或 CSV（新建一个工作表）" className="btn btn-ghost !h-[30px] !min-h-[30px] !w-[30px] !rounded-lg !px-0">
            <IconUpload size={14} className="t3" />
          </button>
          <button onClick={exportExcel} title="把当前工作表导出为 Excel" className="btn btn-ghost !h-[30px] !min-h-[30px] !w-[30px] !rounded-lg !px-0">
            <IconDownload size={14} className="t3" />
          </button>
        </div>
        </section>

          {/* 网格 */}
          <section className="relative flex min-h-0 flex-1 overflow-hidden rounded-2xl border border-line bg-surface/80">
        <div className="grid-scroll min-w-0 flex-1 overflow-auto">
          <table className="sheet-table min-w-full">
            <colgroup>
              <col style={{ minWidth: 40, width: 40 }} />
              {colIndexes.map((c) => (
                <col key={c} style={{ minWidth: colWidthOf(c) }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className="sheet-corner">
                  <div className="flex h-8 items-center justify-center text-[11px] font-semibold t3">#</div>
                </th>
                {colIndexes.map((c) => (
                  <th
                    key={c}
                    className={cn('sheet-header-cell', colSel === c && 'sheet-header-cell-active')}
                    style={{ width: colWidthOf(c) }}
                    onClick={() => handleColSelect(c)}
                    title="选中整列（可 ⌘C 复制 / ⌘V 粘贴）"
                  >
                    <div className="relative flex h-8 select-none items-center justify-center pl-1.5 pr-2">
                      <span
                        className={cn(
                          'tnum text-[12px] font-bold',
                          colSel === c ? 'text-white' : 't1'
                        )}
                      >
                        {colLabel(c)}
                      </span>
                      <span
                        className={cn(
                          'sheet-resize',
                          resizing?.c === c && '!opacity-70'
                        )}
                        onMouseDown={(e) => startResize(e, c)}
                        onClick={(e) => e.stopPropagation()}
                        style={resizing?.c === c ? { background: 'var(--accent)' } : undefined}
                      />
                    </div>
                  </th>
                ))}
                <th
                  className="sheet-header-cell !cursor-default !border-r-0 hover:!bg-[var(--surface-2)]"
                  style={{ width: 34, minWidth: 34 }}
                >
                  <button
                    onClick={addCol}
                    title="添加一列"
                    className="flex h-full w-full items-center justify-center t3 hover:t1"
                  >
                    <IconPlus size={14} />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {rowIndexes.map((r) => (
                <tr key={r}>
                  <td
                    className={cn('sheet-rowhead', rowSel === r && 'sheet-rowhead-active')}
                    onClick={() => handleRowSelect(r)}
                    title="选中整行（可 ⌘C 复制 / ⌘V 粘贴）"
                  >
                    <div
                      className={cn(
                        'tnum flex h-8 items-center justify-center text-[11px] select-none',
                        rowSel === r ? 'font-bold text-white' : 't3'
                      )}
                    >
                      {r + 1}
                    </div>
                  </td>
                  {colIndexes.map((c) => (
                    <GridCell
                      key={c}
                      r={r}
                      c={c}
                      cell={sheet.cells[sheetKey(r, c)]}
                      display={displayMap.get(sheetKey(r, c)) ?? ''}
                      active={editKey === sheetKey(r, c)}
                      selected={selectKey === sheetKey(r, c)}
                      rowSelected={rowSel === r}
                      colSelected={colSel === c}
                      inRect={
                        !!rectSel &&
                        r >= rectSel.r0 &&
                        r <= rectSel.r1 &&
                        c >= rectSel.c0 &&
                        c <= rectSel.c1
                      }
                      seed={editKey === sheetKey(r, c) ? editSeed : null}
                      onDown={handleCellDown}
                      onEdit={startEdit}
                      onEnter={handleCellEnter}
                      onCommit={handleCommit}
                      onMove={handleMove}
                      onCancel={handleCancel}
                    />
                  ))}
                  <td className="sheet-cell !border-r-0" />
                </tr>
              ))}
              <tr>
                <td className="sheet-rowhead">
                  <button
                    onClick={addRow}
                    title="添加一行"
                    className="flex h-8 w-full items-center justify-center t3 hover:t1"
                  >
                    <IconPlus size={14} />
                  </button>
                </td>
                {colIndexes.map((c) => (
                  <td key={c} className="sheet-cell" aria-hidden="true" />
                ))}
                <td className="sheet-cell !border-r-0" aria-hidden="true" />
              </tr>
            </tbody>
          </table>
        </div>

        {/* 右下角 + 状态角标（不占布局） */}
        <div className="pointer-events-none absolute bottom-2 right-3 rounded-lg bg-surface-2/50 px-2 py-1 text-[11px] tnum t3 select-none">
          {colLabel(sheet.colCount - 1)}
          {sheet.rowCount}
        </div>
      </section>

      {/* Sheet 标签 */}
      <section className="flex items-center gap-1 rounded-xl border border-line bg-surface/70 px-2 py-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {sheets.map((s) => {
          const active = s.id === sheet.id
          if (renamingId === s.id) {
            return (
              <span
                key={s.id}
                className={cn(
                  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg pl-3 pr-2 text-[13px]',
                  active ? 'bg-[var(--accent-soft)] font-semibold t1' : 't2'
                )}
              >
                <IconLayers size={13} className={active ? '' : 't3'} />
                <input
                  autoFocus
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onBlur={commitRename}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter') commitRename()
                    else if (e.key === 'Escape') setRenamingId(null)
                  }}
                  className="h-6 w-32 rounded-md border border-[var(--accent)] bg-surface px-1.5 text-[12.5px] t1 outline-none"
                />
              </span>
            )
          }
          return (
            <span
              key={s.id}
              onClick={() => setActiveSheetId(s.id)}
              onDoubleClick={() => {
                setActiveSheetId(s.id)
                setRenameDraft(s.name)
                setRenamingId(s.id)
              }}
              title="双击重命名"
              className={cn(
                'group inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg pl-3 pr-1.5 text-[13px] transition-colors',
                active
                  ? 'bg-[var(--accent-soft)] font-semibold t1'
                  : 't2 hover:bg-surface'
              )}
            >
              <IconLayers size={13} className={active ? '' : 't3'} />
              <span className="max-w-[150px] truncate">{s.name}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  removeSheetTab(s.id)
                }}
                title="删除工作表"
                className={cn(
                  'flex h-5 w-5 items-center justify-center rounded-md t3 hover:bg-surface-2 hover:text-[var(--warn)]',
                  active ? '' : 'opacity-0 group-hover:opacity-100'
                )}
              >
                <IconX size={12} />
              </button>
            </span>
          )
        })}
        </div>
        <button
          ref={newBtnRef}
          onClick={() => (newOpen ? closeNewPanel() : openNewPanel())}
          className="ml-0.5 flex h-8 shrink-0 items-center gap-1 rounded-lg px-2.5 text-[13px] t3 hover:bg-surface hover:t1"
        >
          <IconPlus size={14} />
          新建
        </button>
      </section>

      {newOpen && newPos && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={closeNewPanel} />
          <div
            className="glass fixed z-[70] w-[320px] rounded-xl p-3 shadow-xl"
            style={{ left: newPos.left, bottom: newPos.bottom }}
          >
            <p className="mb-2 flex items-center gap-1.5 text-[12.5px] font-semibold t1">
              <IconCalendarPlus size={14} className="t3" />
              新建工作表（可选日期范围）
            </p>
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={newStart}
                onChange={(e) => setNewStart(e.target.value)}
                title="起始日期"
                className="field !min-h-[34px] !rounded-lg !px-2 text-[12px]"
              />
              <span className="t3 shrink-0 text-[12px]">~</span>
              <input
                type="date"
                value={newEnd}
                onChange={(e) => setNewEnd(e.target.value)}
                title="结束日期"
                className="field !min-h-[34px] !rounded-lg !px-2 text-[12px]"
              />
            </div>
            <div className="mt-2.5 flex items-center justify-between gap-2">
              <span className="tnum min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[12.5px] font-semibold t1">
                {previewName}
              </span>
              <button
                onClick={createFromPanel}
                className="btn btn-primary !min-h-[30px] !rounded-lg !px-3 text-[12.5px]"
              >
                <IconPlus size={13} />
                创建
              </button>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed t3">
              选好起止日期后自动命名，如 26-10-12~26-10-16、26-09-01~26-09-08；不选则按日期命名（上午=今天、下午=次日）
            </p>
          </div>
        </>
      )}
    </div>
  )
}