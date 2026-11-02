'use strict'
/**
 * 本轮三项优化冒烟：
 *  1) 全部任务 Hero 计时环：天数用小字另起一行，长天数（222天）不溢出圆环
 *  2) 每周任务 / 未来计划：内联显示任务 + 日期后「查看全部」按钮
 *  3) 每周任务：不再出现两个「今天」；全屏网格一行 5 天
 */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const OUT = '/tmp/taskflow-round'
const FILE = process.env.SMOKE_FILE || path.join(__dirname, 'dist/index.html')
const SEED = path.join(OUT, 'seed.json')
const PRELOAD = path.join(OUT, '__preload.cjs')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const MIN = 60_000
const DAY = 24 * 60 * MIN

const mk = (o, now) => ({
  id: o.id,
  title: o.title,
  note: o.note || '',
  categoryId: o.categoryId || 'work',
  priority: o.priority || 'medium',
  durationMin: o.durationMin || 60,
  createdAt: now - 60 * MIN,
  cycleStartAt: now - 60 * MIN,
  dueAt: o.dueAt === undefined ? now + 180 * MIN : o.dueAt,
  renewCount: 0,
  remindLeadMin: 10,
  status: o.status || 'active',
  completedAt: o.completedAt || null,
  remindedAt: null,
  expiredNotifiedAt: null,
  planned: !!o.planned,
})

const base = (now, tasks) => ({
  version: 1,
  categories: [
    { id: 'work', name: '工作', color: '#7c5cff', builtin: true },
    { id: 'dev', name: '研发', color: '#2ee6d6', builtin: true },
    { id: 'life', name: '生活', color: '#f5a524', builtin: true },
  ],
  prefs: { theme: 'dark', sound: false, nativeNotify: false, defaultDurationMin: 240, defaultRemindLeadMin: 10 },
  tasks,
})

const startOfDay = (ts) => {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
const atHour = (dayTs, h) => dayTs + h * 3600 * 1000

const PRELOAD_SRC = `
const { contextBridge } = require('electron')
const fs = require('fs')
const DATA = JSON.parse(fs.readFileSync(${JSON.stringify(SEED)}, 'utf8'))
contextBridge.exposeInMainWorld('taskflow', {
  platform: 'darwin',
  read: async () => JSON.parse(JSON.stringify(DATA)),
  write: async () => true,
  notify: async () => true,
  badge: async () => true,
  info: async () => ({ version: 'test', platform: 'darwin', electron: 'test' }),
  revealData: async () => true,
  onFocusTask: () => () => {},
})
`

app.whenReady().then(async () => {
  fs.rmSync(OUT, { recursive: true, force: true })
  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(PRELOAD, PRELOAD_SRC)

  const now = Date.now()
  const today = startOfDay(now)

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: '#07070e',
    webPreferences: { contextIsolation: true, sandbox: false, preload: PRELOAD },
  })

  const errors = []
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2 && !/React DevTools/.test(message)) errors.push(`[console:${level}] ${message}`)
  })

  const js = (code) => win.webContents.executeJavaScript(code)
  const shot = async (name) => {
    const img = await win.webContents.capturePage()
    fs.writeFileSync(`${OUT}/${name}.png`, img.toPNG())
  }
  const setSeed = (data) => fs.writeFileSync(SEED, JSON.stringify(data))
  const reload = async () => {
    await win.webContents.reload()
    await sleep(2600)
  }
  const clickNav = async (label) => {
    const ok = await js(`(() => {
      const b = [...document.querySelectorAll('nav button, aside button, button')].find(x => x.textContent.trim().startsWith(${JSON.stringify(label)}))
      if (b) { b.click(); return true }
      return false
    })()`)
    await sleep(1000)
    return ok
  }

  const failed = []
  const check = (label, ok, detail) => {
    if (!ok) failed.push(label + ' -> ' + JSON.stringify(detail))
    console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}:`, JSON.stringify(detail))
  }

  win.show()
  await sleep(300)

  /* ---------- 1) Hero 计时环溢出 ---------- */
  const RING = `(() => {
    const box = document.querySelector('div.absolute.inset-0.flex.flex-col')
    if (!box) return { error: 'countdown box missing' }
    const wrap = box.parentElement
    const svg = wrap && wrap.querySelector('svg')
    if (!svg) return { error: 'ring svg missing' }
    const cr = svg.getBoundingClientRect()
    const cx = cr.left + cr.width / 2
    const cy = cr.top + cr.height / 2
    const ringInner = (cr.width / 2) * (83.5 / 110) // r=88, svg 220 -> half=110
    let maxHalf = 0
    let text = ''
    for (const el of box.querySelectorAll('span')) {
      const r = el.getBoundingClientRect()
      if (!r.width) continue
      text += el.textContent + '|'
      maxHalf = Math.max(maxHalf, Math.abs(r.left - cx), Math.abs(r.right - cx), Math.abs(r.top - cy), Math.abs(r.bottom - cy))
    }
    return { ringInner: Math.round(ringInner), maxHalf: Math.round(maxHalf), fits: maxHalf <= ringInner, text }
  })()`

  setSeed(base(now, [mk({ id: 'hero-1', title: '明天要交的任务', dueAt: now + DAY + 31 * MIN + 55 * 1000 }, now)]))
  await win.loadFile(FILE)
  await sleep(2600)
  const h1 = await js(RING)
  check('Hero 计时环 · 1天 00:31:55 不溢出', !h1.error && h1.fits && /1天/.test(h1.text) && /00:31:5/.test(h1.text), h1)
  await shot('1-hero-1day')

  setSeed(base(now, [mk({ id: 'hero-2', title: '很远的任务', dueAt: now + 222 * DAY + 12 * 3600 * 1000 }, now)]))
  await reload()
  const h2 = await js(RING)
  check('Hero 计时环 · 222天 不溢出', !h2.error && h2.fits && /222天/.test(h2.text), h2)
  await shot('2-hero-222day')

  /* ---------- 1b) 专注模式计时环长天数 ---------- */
  setSeed(base(now, [mk({ id: 'focus-1', title: '超长专注', dueAt: now + 2 * DAY, durationMin: 222 * 24 * 60 }, now)]))
  await reload()
  await js(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().startsWith('专注模式'))
    if (b) { b.click(); return true }
    return false
  })()`)
  await sleep(900)
  const focus = await js(`(() => {
    const wrap = [...document.querySelectorAll('div')].find(d => d.className.includes('h-[280px]'))
    if (!wrap) return { error: 'focus ring missing' }
    const svg = wrap.querySelector('svg')
    const cr = svg.getBoundingClientRect()
    const cx = cr.left + cr.width / 2
    const cy = cr.top + cr.height / 2
    const inner = (cr.width / 2) * (112 / 140) // r=118, svg 280 -> half=140, inner=118-6
    let maxHalf = 0
    let text = ''
    for (const el of wrap.querySelectorAll('span')) {
      const r = el.getBoundingClientRect()
      if (!r.width) continue
      text += el.textContent + '|'
      maxHalf = Math.max(maxHalf, Math.abs(r.left - cx), Math.abs(r.right - cx), Math.abs(r.top - cy), Math.abs(r.bottom - cy))
    }
    return { inner: Math.round(inner), maxHalf: Math.round(maxHalf), fits: maxHalf <= inner, text }
  })()`)
  check('专注模式 · 222天 计时不溢出', !focus.error && focus.fits && /222天/.test(focus.text), focus)
  await shot('2b-focus-222day')
  await js(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true })()`)
  await sleep(500)

  /* ---------- 2) 每周任务 / 未来计划 内联任务 + 查看全部 ---------- */
  setSeed(
    base(now, [
      mk({ id: 'y1', title: '昨天的工作', planned: true, dueAt: atHour(today - DAY, 9) }, now),
      mk({ id: 't1', title: '今天第一件事', planned: true, dueAt: atHour(today, 10) }, now),
      mk({ id: 't2', title: '今天第二件事', planned: true, dueAt: atHour(today, 12) }, now),
      mk({ id: 't3', title: '今天第三件事', planned: true, dueAt: atHour(today, 15) }, now),
      mk({ id: 'm1', title: '明天的事', planned: true, dueAt: atHour(today + DAY, 11) }, now),
    ])
  )
  await reload()

  // 每周任务
  await clickNav('每周任务')
  const week = await js(`(() => {
    const section = [...document.querySelectorAll('section')].find(s => s.textContent.includes('每周任务'))
    if (!section) return { error: 'week section missing' }
    const grid = section.querySelector('.grid')
    const cols = grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : null
    const badges = [...section.querySelectorAll('span')].filter(s => s.textContent.trim() === '今天').length
    const viewAll = [...section.querySelectorAll('button')].filter(b => (b.getAttribute('aria-label') || '').startsWith('查看全部')).length
    const viewAllText = [...section.querySelectorAll('button')].filter(b => b.textContent.trim().includes('查看全部')).length
    const viewAllCounts = [...section.querySelectorAll('button')].filter(b => (b.getAttribute('aria-label') || '').startsWith('查看全部')).map(b => b.textContent.trim())
    const inline = [...section.querySelectorAll('div')].filter(d => /今天第一件事|今天第二件事/.test(d.textContent) && d.className.includes('group flex cursor-pointer')).length
    const titles = ['昨天的工作','今天第一件事','今天第二件事','今天第三件事','明天的事'].filter(t => section.textContent.includes(t))
    return { cols, badges, viewAll, viewAllText, viewAllCounts, inline, titles }
  })()`)
  check('每周任务 · 内联显示任务', !week.error && week.titles.length === 5, week.titles)
  check('每周任务 · 今天徽标只 1 个', week.badges === 1, { badges: week.badges })
  check('每周任务 · 查看全部仅图标（无文字）', week.viewAll >= 1 && week.viewAllText === 0, { viewAll: week.viewAll, viewAllText: week.viewAllText })
  check('每周任务 · 日期显示任务数', week.viewAllCounts.some((t) => t === '3') && week.viewAllCounts.some((t) => t === '1'), week.viewAllCounts)
  check('每周任务 · 全屏一行 5 天', week.cols === 5, { cols: week.cols })
  await shot('3-weekboard')

  // 查看全部弹窗（打开「今天」列，含 3 个任务）
  await js(`(() => {
    const section = [...document.querySelectorAll('section')].find(s => s.textContent.includes('每周任务'))
    const cols = [...section.querySelectorAll('.glass')].filter(c => [...c.querySelectorAll('span')].some(s => s.textContent.trim() === '今天'))
    const col = cols[0]
    const b = col && [...col.querySelectorAll('button')].find(x => (x.getAttribute('aria-label') || '').startsWith('查看全部'))
    if (b) { b.click(); return true }
    return false
  })()`)
  await sleep(600)
  const dialog = await js(`(() => {
    const d = document.querySelector('[role="dialog"]')
    if (!d) return { open: false, label: null }
    const hasCheckbox = !!d.querySelector('button[aria-label="标记完成"], button[aria-label="恢复任务"]')
    const hasTimeInput = !!d.querySelector('input[type="time"]')
    const hasAnyInput = d.querySelectorAll('input').length
    const addBtn = [...d.querySelectorAll('button')].filter(b => /添加/.test(b.textContent)).length
    const rows = [...d.querySelectorAll('div')].filter(x => /今天第一件事|今天第二件事|今天第三件事/.test(x.textContent) && x.className.includes('rounded-xl border border-line')).length
    return { open: true, label: d.getAttribute('aria-label'), hasCheckbox, hasTimeInput, hasAnyInput, addBtn, rows }
  })()`)
  check('每周任务 · 查看全部弹窗打开', dialog.open, { open: dialog.open, label: dialog.label })
  check('每周任务 · 弹窗只读（无勾选/无添加）', dialog.hasCheckbox === false && dialog.hasTimeInput === false && dialog.hasAnyInput === 0 && dialog.addBtn === 0, dialog)
  check('每周任务 · 弹窗列出当天 3 个任务', dialog.rows === 3, { rows: dialog.rows })
  await shot('4-week-dialog')
  await js(`(() => { const x = document.querySelector('[role="dialog"] button[aria-label="关闭"]'); if (x) x.click(); return true })()`)
  await sleep(400)

  // 未来计划
  await clickNav('未来计划')
  const plan = await js(`(() => {
    const cells = [...document.querySelectorAll('[role="gridcell"]')]
    const inlineTexts = ['今天第一件事','今天第二件事','今天第三件事'].filter(t => {
      return cells.some(c => [...c.querySelectorAll('button')].some(b => b.textContent.includes(t) && b.className.includes('truncate')))
    })
    const viewAll = [...document.querySelectorAll('[role="gridcell"] button')].filter(b => (b.getAttribute('aria-label') || '').startsWith('查看全部')).length
    const viewAllText = [...document.querySelectorAll('[role="gridcell"] button')].filter(b => b.textContent.trim().includes('查看全部')).length
    const viewAllNums = [...document.querySelectorAll('[role="gridcell"] button')].filter(b => (b.getAttribute('aria-label') || '').startsWith('查看全部')).map(b => b.textContent.trim())
    const plus = [...document.querySelectorAll('[role="gridcell"] button')].filter(b => /^\\+\\d+ 个$/.test(b.textContent.trim())).length
    return { inlineTexts, viewAll, viewAllText, viewAllNums, plus }
  })()`)
  check('未来计划 · 日历内联显示任务（最多2条）', !plan.error && plan.inlineTexts.length === 2, plan.inlineTexts)
  check('未来计划 · 查看全部仅图标（无文字）', plan.viewAll >= 1 && plan.viewAllText === 0, { viewAll: plan.viewAll, viewAllText: plan.viewAllText })
  check('未来计划 · 日期显示任务数', plan.viewAllNums.some((t) => t === '3'), plan.viewAllNums)
  check('未来计划 · 超出显示 +N 个', plan.plus >= 1, { plus: plan.plus })
  await shot('5-planboard')

  console.log(failed.length ? 'FAILED:\n' + failed.join('\n') : 'ALL_ROUND_CHECKS_PASSED')
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO_CONSOLE_ERRORS')
  app.exit(failed.length || errors.length ? 1 : 0)
})
