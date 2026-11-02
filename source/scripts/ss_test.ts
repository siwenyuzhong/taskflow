import {
  blankSheet,
  sheetKey,
  sheetValue,
  sheetToCsv,
  csvToRows,
  sheetFromCsv,
  colLabel,
  parseRef,
  parseSheetKey,
} from '../src/lib/spreadsheet'
import { buildStyledHtml, parseDelimited, parseTdStyle, toDelimited, trimMatrix } from '../src/lib/clipboard'
import type { Sheet } from '../src/types'

let failed = 0
function eq(name: string, a: unknown, b: unknown) {
  const ok = JSON.stringify(a) === JSON.stringify(b)
  if (!ok) {
    failed++
    console.log(`✗ ${name}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`)
  } else {
    console.log(`✓ ${name}`)
  }
}

// 基础单元格 + 公式
const sheet: Sheet = {
  id: 's1',
  name: 'T',
  cells: {
    [sheetKey(0, 0)]: { v: '任务', bold: true },
    [sheetKey(0, 3)]: { v: '得分', bold: true },
    [sheetKey(1, 0)]: { v: '完成评审' },
    [sheetKey(1, 3)]: { v: '80' },
    [sheetKey(2, 0)]: { v: '修bug' },
    [sheetKey(2, 3)]: { v: '56' },
    [sheetKey(3, 0)]: { v: '合计', bold: true },
    [sheetKey(3, 3)]: { v: '=SUM(D2:D3)' },
    [sheetKey(4, 3)]: { v: '=AVERAGE(D2:D3)' },
    [sheetKey(5, 3)]: { v: '=D2+D3' },
    [sheetKey(6, 3)]: { v: '=MAX(D2:D3)*2' },
    [sheetKey(7, 3)]: { v: '=D9' },
    [sheetKey(8, 0)]: { v: '=A2' },
    [sheetKey(8, 3)]: { v: '=COUNT(D2:D3)' },
  },
  colCount: 6,
  rowCount: 12,
  colWidths: {},
  createdAt: 0,
  updatedAt: 0,
}

eq('colLabel', colLabel(0), 'A')
eq('colLabel AA', colLabel(26), 'AA')
eq('parseRef', parseRef('B3'), { col: 1, row: 2 })
eq('plain text', sheetValue(sheet, sheetKey(1, 0)), '完成评审')
eq('SUM', sheetValue(sheet, sheetKey(3, 3)), '136')
eq('AVERAGE', sheetValue(sheet, sheetKey(4, 3)), '68')
eq('add', sheetValue(sheet, sheetKey(5, 3)), '136')
eq('MAX*2', sheetValue(sheet, sheetKey(6, 3)), '160')
eq('chain ref (D9 → COUNT)', sheetValue(sheet, sheetKey(7, 3)), '2')
eq('text ref → plain', sheetValue(sheet, sheetKey(8, 0)), '完成评审')
eq('COUNT', sheetValue(sheet, sheetKey(8, 3)), '2')

// 循环引用
const cyc: Sheet = {
  ...blankSheet('cyc'),
  cells: {
    [sheetKey(0, 0)]: { v: '=B1' },
    [sheetKey(0, 1)]: { v: '=A1' },
  },
}
eq('cycle guard', sheetValue(cyc, sheetKey(0, 0)), '#循环引用!')

// CSV 往返
const csv = sheetToCsv(sheet)
eq('csv lines', csvToRows(csv)[3][3], '136')
const imported = sheetFromCsv('导入', csvToRows('任务,负责人,状态,得分\n"评,审",小王,进行中,80\n修bug,小李,已完成,56'))
eq('import quoted comma', imported.cells[sheetKey(1, 0)]?.v, '评,审')
eq('import cell', imported.cells[sheetKey(1, 3)]?.v, '80')
eq('import colCount', imported.colCount, 4)

// 剪贴板：外部 Excel 复制的是 Tab 分隔文本
eq('parseSheetKey', parseSheetKey('R2C3'), { r: 2, c: 3 })
eq('parseSheetKey bad', parseSheetKey('xx'), null)
eq('toDelimited', toDelimited([['a', 'b'], ['c', 'd']]), 'a\tb\r\nc\td')
const clip = parseDelimited('任务\t负责人\r\n评审\t小王\r\n修bug\t小李\r\n')
eq('parse TSV rows', clip.length, 3)
eq('parse TSV cell', clip[1][1].v, '小王')
const padded: { v: string }[][] = [[{ v: '' }, { v: '' }], [{ v: 'x', bold: true }], [{ v: '' }]]
const trimmed = trimMatrix(padded)
eq('trim keeps interior pos', trimmed.length, 1)
eq('trim keeps style', trimmed[0][0].bold, true)
eq('trim cols', trimMatrix([[{ v: 'a' }, { v: 'b' }, { v: '' }]])[0].length, 2)
eq(
  'parseTdStyle full',
  parseTdStyle('FONT-WEIGHT: 700;background:#FF0000;color:#00ff00;text-align:center'),
  { bold: true, color: '#ff0000', fc: '#00ff00', align: 'center' }
)
eq('parseTdStyle bg only', parseTdStyle('background-color:#abc'), { color: '#abc' })
eq('parseTdStyle bad hex', parseTdStyle('color:red'), {})
const html = buildStyledHtml([[{ v: '<a>&b', bold: true, color: '#7c5cff', fc: '#fff', align: 'center' }]])
const htmlOk =
  html.includes('&lt;a&gt;&amp;b') &&
  html.includes('font-weight:700') &&
  html.includes('background:#7c5cff') &&
  html.includes('color:#fff') &&
  html.includes('text-align:center')
eq('buildStyledHtml escapes + styles', htmlOk, true)
eq('buildStyledHtml keeps newline', buildStyledHtml([[{ v: 'a\nb' }]]).includes('white-space:pre-wrap'), true)
console.log(failed ? `\n${failed} FAILED` : '\nALL PASS')
process.exit(failed ? 1 : 0)