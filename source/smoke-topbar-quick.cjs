'use strict'
/**
 * 顶栏「快速打卡 / 工作清单 / 轻量模式」冒烟（真实主进程 + 真实渲染层 + 真实 preload）：
 *   1) 顶栏三个按钮都存在，且顺序为 快速打卡 → 工作清单 → 轻量模式
 *   2) 「快速打卡」把打卡页里今天还没打卡的习惯一次全打卡（已打卡的保持不动）
 *   3) 「工作清单」按钮切到电子表格视图
 *
 * userData 被指到 /tmp，绝不读写真实数据；数据文件里预置了 3 个习惯（1 个今天已打卡）。
 *
 * 运行：npx electron smoke-topbar-quick.cjs
 */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const OUT = '/tmp/taskflow-smoke-topbar-quick'
const USERDATA = path.join(os.tmpdir(), 'taskflow-smoke-topbar-quick-userdata')

// —— 必须在 require 主进程之前设好：隔离真实数据 ——
fs.rmSync(USERDATA, { recursive: true, force: true })
fs.mkdirSync(USERDATA, { recursive: true })
app.setPath('userData', USERDATA)

/** 预置数据：3 个习惯，其中 1 个今天已打卡 */
function seed() {
  const d = new Date()
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const now = Date.now()
  const data = {
    version: 1,
    tasks: [],
    categories: [
      { id: 'work', name: '工作', color: '#7c5cff', builtin: true },
      { id: 'dev', name: '研发', color: '#2ee6d6', builtin: true },
      { id: 'study', name: '学习', color: '#5b9dff', builtin: true },
      { id: 'life', name: '生活', color: '#f5a524', builtin: true },
      { id: 'idea', name: '灵感', color: '#ff5c7a', builtin: true },
    ],
    prefs: { theme: 'dark', sound: false, nativeNotify: false, defaultDurationMin: 240, defaultRemindLeadMin: 10 },
    habits: [
      { id: 'h1', name: '早睡', color: '#7c5cff', createdAt: now, checkins: {} },
      { id: 'h2', name: '喝水', color: '#2ee6d6', createdAt: now, checkins: { [key]: now } },
      { id: 'h3', name: '阅读', color: '#5b9dff', createdAt: now, checkins: {} },
    ],
    notes: [],
    sheets: [{ id: 's1', name: '表 1', cells: {}, colCount: 6, rowCount: 20, colWidths: {}, createdAt: now, updatedAt: now }],
    activeSheetId: 's1',
  }
  fs.writeFileSync(path.join(USERDATA, 'taskflow-data.json'), JSON.stringify(data, null, 2), 'utf8')
}

require('./electron/main.cjs')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitFor(fn, { timeout = 15000, step = 120 } = {}) {
  const end = Date.now() + timeout
  for (;;) {
    let v = null
    try {
      v = await fn()
    } catch {
      /* 页面/窗口还没就绪 */
    }
    if (v) return v
    if (Date.now() > end) return null
    await sleep(step)
  }
}

const results = []
function check(name, ok, extra = '') {
  results.push({ name, ok: !!ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`)
}

async function shot(win, name) {
  try {
    const img = await win.webContents.capturePage()
    fs.writeFileSync(`${OUT}/${name}.png`, img.toPNG())
    console.log(`shot -> ${name}.png`)
  } catch (err) {
    console.log(`shot ${name} 失败: ${err.message}`)
  }
}

app.whenReady().then(async () => {
  fs.rmSync(OUT, { recursive: true, force: true })
  fs.mkdirSync(OUT, { recursive: true })
  seed()

  const main = await waitFor(() =>
    BrowserWindow.getAllWindows().find(
      (w) => !w.isDestroyed() && w.webContents.getURL().includes('index.html') && !w.webContents.isLoading()
    )
  )
  if (!main) {
    console.log('FAIL  主窗口未加载')
    app.exit(1)
    return
  }
  const errors = []
  main.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) errors.push(`[console:${level}] ${message} (${source}:${line})`)
  })
  main.webContents.on('render-process-gone', (_e, d) => errors.push(`[gone] ${d.reason}`))
  await sleep(1200)

  // ---- 1) 顶栏按钮存在与顺序 ----
  const layout = await main.webContents.executeJavaScript(`(() => {
    const btns = [...document.querySelectorAll('header button')]
    const find = (kw) => btns.find((b) => b.textContent.includes(kw))
    const quick = find('快速打卡')
    const sheets = find('工作清单')
    const light = find('轻量模式')
    const x = (el) => (el ? Math.round(el.getBoundingClientRect().left) : -1)
    return {
      quick: !!quick,
      sheets: !!sheets,
      light: !!light,
      quickX: x(quick),
      sheetsX: x(sheets),
      lightX: x(light),
      badge: quick ? (quick.textContent.match(/\\d+/g) || []) : [],
    }
  })()`)
  check('顶栏存在「快速打卡」按钮', layout.quick, `x=${layout.quickX}`)
  check('顶栏存在「工作清单」按钮', layout.sheets, `x=${layout.sheetsX}`)
  check('顶栏存在「轻量模式」按钮', layout.light, `x=${layout.lightX}`)
  check(
    '顺序为 快速打卡 → 工作清单 → 轻量模式',
    layout.quickX < layout.sheetsX && layout.sheetsX < layout.lightX,
    `${layout.quickX} < ${layout.sheetsX} < ${layout.lightX}`
  )
  check('「快速打卡」角标显示待打卡数 2', layout.badge.join(',') === '2', `badge=${layout.badge.join(',')}`)
  await shot(main, '1-topbar')

  // ---- 2) 一键打卡 ----
  await main.webContents.executeJavaScript(
    `[...document.querySelectorAll('header button')].find((b) => b.textContent.includes('快速打卡')).click()`
  )
  await sleep(600)
  const after = await main.webContents.executeJavaScript(`(() => {
    const d = new Date()
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    const btn = [...document.querySelectorAll('header button')].find((b) => b.textContent.includes('快速打卡'))
    return {
      badge: btn ? (btn.textContent.match(/\\d+/g) || []) : [],
      toast: [...document.querySelectorAll('body *')].some((el) => el.textContent.includes('已一键打卡 2 个习惯')),
    }
  })()`)
  check('一键打卡后角标消失（今天都打完了）', after.badge.length === 0, `badge=${after.badge.join(',')}`)
  check('提示「已一键打卡 2 个习惯」', after.toast)
  await shot(main, '2-checked')

  // 数据落盘校验：三个习惯今天都有记录
  const saved = JSON.parse(fs.readFileSync(path.join(USERDATA, 'taskflow-data.json'), 'utf8'))
  const d = new Date()
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const done = saved.habits.filter((h) => h.checkins[key]).map((h) => h.name)
  check('三个习惯今天都已打卡', done.length === 3, done.join('、'))

  // ---- 3) 工作清单按钮切视图 ----
  await main.webContents.executeJavaScript(
    `[...document.querySelectorAll('header button')].find((b) => b.textContent.includes('工作清单')).click()`
  )
  await sleep(500)
  const sheetsView = await main.webContents.executeJavaScript(`(() => {
    const btn = [...document.querySelectorAll('header button')].find((b) => b.textContent.includes('工作清单'))
    const nav = [...document.querySelectorAll('aside button')].find((b) => b.textContent.includes('工作清单'))
    return {
      pressed: btn ? btn.getAttribute('aria-pressed') : null,
      navCurrent: nav ? nav.getAttribute('aria-current') : null,
      hasGrid: document.body.innerText.includes('个工作表 · 当前'),
    }
  })()`)
  check('「工作清单」按钮进入选中态', sheetsView.pressed === 'true', `pressed=${sheetsView.pressed}`)
  check('侧栏同步切到工作清单', sheetsView.navCurrent === 'page', `aria-current=${sheetsView.navCurrent}`)
  check('工作清单视图已渲染', sheetsView.hasGrid)
  await shot(main, '3-sheets')

  // ---- 4) 窄窗口（最小宽度 420）下顶栏不溢出 ----
  main.setSize(420, 700)
  await sleep(600)
  const narrow = await main.webContents.executeJavaScript(`(() => {
    const btns = [...document.querySelectorAll('header button')].filter((b) => {
      const r = b.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    })
    const overflow = btns.filter((b) => b.getBoundingClientRect().right > window.innerWidth + 1)
    const search = document.querySelector('input[aria-label="搜索任务"]')
    return {
      inner: window.innerWidth,
      count: btns.length,
      overflow: overflow.length,
      searchVisible: !!search && search.getBoundingClientRect().width > 40,
    }
  })()`)
  check(
    '窄窗口(' + narrow.inner + 'px)顶栏按钮不溢出',
    narrow.overflow === 0 && narrow.count >= 4,
    '按钮=' + narrow.count + ' 溢出=' + narrow.overflow
  )
  check('窄窗口下搜索框仍可用', narrow.searchVisible)
  await shot(main, '4-narrow')
  main.setSize(1240, 820)
  await sleep(300)

  check('渲染层无报错', errors.length === 0, errors.join(' | '))

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${failed.length ? 'FAIL' : 'PASS'}  ${results.length - failed.length}/${results.length} 项通过`)
  app.exit(failed.length ? 1 : 0)
})
