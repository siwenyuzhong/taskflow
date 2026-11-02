'use strict'
/**
 * 打包产物的内置副本冒烟：直接读 release 里 asar 内的 dist/index.html + preload，
 * 验证「轻量模式」按钮在打包版本里确实存在。
 * 运行：npx electron smoke-packed.cjs
 */
const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const PACKED_INDEX =
  process.env.PACKED_INDEX ||
  path.join(__dirname, 'release/mac-arm64/Sloth.app/Contents/Resources/app.asar/dist/index.html')

// 复用真实 preload（含 lightmode 通道），主进程侧只做最小 mock，避免影响真实数据
const PRELOAD = path.join(__dirname, 'electron/preload.cjs')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

app.setPath('userData', path.join(os.tmpdir(), 'taskflow-smoke-packed-userdata'))

app.whenReady().then(async () => {
  const lightmodeCalls = []
  ipcMain.handle('taskflow:read', () => null)
  ipcMain.handle('taskflow:write', () => true)
  ipcMain.handle('taskflow:badge', () => true)
  ipcMain.handle('taskflow:info', () => ({
    version: require('./package.json').version,
    platform: process.platform,
    electron: process.versions.electron,
  }))
  ipcMain.handle('taskflow:notify', () => true)
  ipcMain.handle('taskflow:reveal-data', () => true)
  ipcMain.handle('taskflow:lightmode', (_e, on) => {
    lightmodeCalls.push(on)
    // 模拟主进程：隐藏主窗口并回推状态
    const win = BrowserWindow.getAllWindows()[0]
    if (win) win.hide()
    win.webContents.send('taskflow:lightmode-state', !!on)
    return !!on
  })
  ipcMain.handle('taskflow:lightmode-tasks', (_e, p) => {
    lightmodeCalls.push(JSON.stringify(p))
    return true
  })
  ipcMain.on('taskflow:lightmode-open', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) win.show()
    win.webContents.send('taskflow:lightmode-state', false)
  })

  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    show: false,
    backgroundColor: '#07070e',
    webPreferences: { preload: PRELOAD, contextIsolation: true },
  })
  fs.mkdirSync('/tmp/taskflow-smoke-packed', { recursive: true })
  const errors = []
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) errors.push(message)
  })

  await win.loadFile(PACKED_INDEX)
  await sleep(1500)

  const btn = await win.webContents.executeJavaScript(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('轻量模式'))
    const sel = document.querySelector('select[aria-label="排序方式"]')
    return { found: !!b, before: !!(b && sel && b.compareDocumentPosition(sel) & Node.DOCUMENT_POSITION_FOLLOWING) }
  })()`)
  console.log(`${btn.found ? 'PASS' : 'FAIL'}  打包产物含「轻量模式」按钮`)
  console.log(`${btn.before ? 'PASS' : 'FAIL'}  按钮在「按到期时间」之前`)

  // ---- 新增：顶栏「快速打卡 / 工作清单」按钮与顺序 + 版本号 ----
  const top = await win.webContents.executeJavaScript(`(() => {
    const btns = [...document.querySelectorAll('header button')]
    const find = (kw) => btns.find((b) => b.textContent.includes(kw))
    const quick = find('快速打卡')
    const sheets = find('工作清单')
    const light = find('轻量模式')
    const x = (el) => (el ? Math.round(el.getBoundingClientRect().left) : -1)
    const ver = document.querySelector('aside')
    return {
      quick: !!quick,
      sheets: !!sheets,
      order: x(quick) < x(sheets) && x(sheets) < x(light),
      version: ver ? (ver.innerText.match(/Sloth\\s+v[\\d.]+/) || [''])[0] : '',
    }
  })()`)
  console.log(`${top.quick ? 'PASS' : 'FAIL'}  打包产物含「快速打卡」按钮`)
  console.log(`${top.sheets ? 'PASS' : 'FAIL'}  打包产物含「工作清单」按钮`)
  console.log(`${top.order ? 'PASS' : 'FAIL'}  顺序为 快速打卡 → 工作清单 → 轻量模式`)
  console.log(
    `${top.version === 'Sloth v20261022.1' ? 'PASS' : 'FAIL'}  版本号显示为 Sloth v20261022.1 — ${top.version}`
  )

  await win.webContents.executeJavaScript(
    `[...document.querySelectorAll('button')].find((x) => x.textContent.includes('轻量模式')).click()`
  )
  await sleep(800)
  // 注意：挂载时渲染层就会先推一次 lightmode-tasks（空清单），
  // 所以这里不能断言 lightmodeCalls[0]，只能在整条序列里找。
  const setTrue = lightmodeCalls.filter((c) => c === true).length
  console.log(`${setTrue > 0 ? 'PASS' : 'FAIL'}  点击后调用主进程 lightmode(true) — calls=${JSON.stringify(lightmodeCalls.slice(0, 3))}`)
  const pushed = lightmodeCalls.some(
    (c) => typeof c === 'string' && /"count":[1-9]/.test(c) && c.includes('"title"')
  )
  console.log(`${pushed ? 'PASS' : 'FAIL'}  推送了待办摘要`)

  // 用 IPC 模拟「点飘条/Dock」→ 渲染层应回到非轻量态
  try {
    win.webContents.send('__manual__')
  } catch {
    /* ignore */
  }
  const shown = await win.webContents.executeJavaScript(`(() => {
    window.taskflow.lightmodeOpen(); return true
  })()`)
  await sleep(400)
  const pressed = await win.webContents.executeJavaScript(
    `[...document.querySelectorAll('button')].find((x) => x.textContent.includes('轻量模式')).getAttribute('aria-pressed')`
  )
  console.log(`${shown && pressed === 'false' ? 'PASS' : 'FAIL'}  唤回后渲染层退出轻量态（aria-pressed=${pressed}）`)
  console.log(`${errors.length === 0 ? 'PASS' : 'FAIL'}  无控制台报错${errors.length ? ': ' + errors.join(' | ') : ''}`)
  console.log('shots: 无（打包冒烟只做断言）')
  app.exit(0)
})
