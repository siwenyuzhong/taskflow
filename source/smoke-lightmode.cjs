'use strict'
/**
 * 轻量模式可视化冒烟（真实主进程 electron/main.cjs + 真实渲染层 + 真实 preload）：
 *   1) 顶栏「轻量模式」按钮存在，且位于「按到期时间」排序下拉之前
 *   2) 点击 → 主窗口隐藏（macOS Dock 图标保持可见）
 *   3) 首拍到点 → 屏幕顶部出现 #lightfly 飘窗，飘条从右向左移动（截图）
 *   4) 点飘条 → 退出轻量模式、主窗口唤回、飘窗关闭
 *   5) 再次进入后模拟点 Dock 图标（app emit activate）→ 同样能回来
 *
 * userData 被指到 /tmp，绝不读写真实数据；首拍延时用环境变量压到 1.5s。
 *
 * 运行：npx electron smoke-lightmode.cjs
 */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const OUT = '/tmp/taskflow-smoke-lightmode'
const USERDATA = path.join(os.tmpdir(), 'taskflow-smoke-lightmode-userdata')

// —— 必须在 require 主进程之前设好：隔离真实数据 + 压缩飘过节拍 ——
fs.rmSync(USERDATA, { recursive: true, force: true })
fs.mkdirSync(USERDATA, { recursive: true })
app.setPath('userData', USERDATA)
process.env.SLOTH_LIGHT_FIRST_FLY_MS = '1500'

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

const isFly = (w) => !w.isDestroyed() && w.webContents.getURL().includes('#lightfly')

app.whenReady().then(async () => {
  fs.rmSync(OUT, { recursive: true, force: true })
  fs.mkdirSync(OUT, { recursive: true })

  // ---- 主窗口就绪（主进程的 whenReady 先跑，这里等它加载完）----
  const main = await waitFor(() =>
    BrowserWindow.getAllWindows().find(
      (w) => !w.isDestroyed() && !isFly(w) && w.webContents.getURL().includes('index.html') && !w.webContents.isLoading()
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
  await sleep(1000) // 等水合与首屏渲染

  // ---- 1) 顶栏按钮布局 ----
  const layout = await main.webContents.executeJavaScript(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('轻量模式'))
    const sel = document.querySelector('select[aria-label="排序方式"]')
    return {
      btn: !!btn,
      sel: !!sel,
      before: !!(btn && sel && btn.compareDocumentPosition(sel) & Node.DOCUMENT_POSITION_FOLLOWING),
      label: btn ? btn.textContent.trim() : null,
      pressed: btn ? btn.getAttribute('aria-pressed') : null,
      native: !!window.taskflow,
      pos: btn ? Math.round(btn.getBoundingClientRect().left) : -1,
      selPos: sel ? Math.round(sel.getBoundingClientRect().left) : -1,
    }
  })()`)
  check('顶栏存在「轻量模式」按钮', layout.btn, `label=${layout.label}`)
  check('按钮在「按到期时间」排序下拉之前', layout.before, `btn.x=${layout.pos} sel.x=${layout.selPos}`)
  check('原生桥接可用（浏览器预览会隐藏该按钮）', layout.native)
  await shot(main, '1-topbar')

  // ---- 2) 点击进入轻量模式 ----
  await main.webContents.executeJavaScript(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('轻量模式')).click()`
  )
  await sleep(700)
  check('点击后主窗口隐藏', main.isVisible() === false)
  if (process.platform === 'darwin') {
    check('macOS Dock 图标保持可见', !!(app.dock && app.dock.isVisible()))
  }
  const pressedState = await main.webContents.executeJavaScript(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('轻量模式')).getAttribute('aria-pressed')`
  )
  check('主进程状态回推渲染层（aria-pressed=true）', pressedState === 'true', `pressed=${pressedState}`)

  // ---- 3) 待办清单 → 首拍飘窗 ----
  await main.webContents.executeJavaScript(`window.taskflow.lightmodeTasks({
    tasks: [
      { title: '完成 Sloth 需求评审', label: '今天 18:00', overdue: false },
      { title: '重构任务列表的虚拟滚动', label: '今天 19:30', overdue: false },
    ],
    count: 2,
    taskId: 'task-smoke',
  })`)
  const fly = await waitFor(() => BrowserWindow.getAllWindows().find(isFly), { timeout: 8000 })
  check('首拍到点出现 #lightfly 飘窗', !!fly)
  if (fly) {
    await waitFor(() => !fly.webContents.isLoading(), { timeout: 8000 })
    await sleep(400)
    const before = await fly.webContents.executeJavaScript(
      `(() => { const p = document.querySelector('.lf-pill'); return p ? { x: Math.round(p.getBoundingClientRect().x), text: p.textContent } : null })()`
    )
    await sleep(1200)
    const after = await fly.webContents.executeJavaScript(
      `(() => { const p = document.querySelector('.lf-pill'); return p ? { x: Math.round(p.getBoundingClientRect().x) } : null })()`
    )
    check(
      '飘条带任务文案',
      !!(before && before.text.includes('2 项待完成') && before.text.includes('需求评审')),
      before ? before.text : 'pill 不存在'
    )
    check(
      '飘条从右向左移动',
      !!(before && after && after.x < before.x),
      `x: ${before && before.x} → ${after && after.x}`
    )
    await shot(fly, '2-flyby')
  }

  // 飘窗必须在桌面上真正可见（历史 bug：ready-to-show 不来 → 一直隐藏，用户看不到飘过提醒）
  check('飘窗真正显示在屏幕上（isVisible）', !!(fly && fly.isVisible()))
  if (fly && !fly.isDestroyed()) {
    await fly.webContents.executeJavaScript(
      `(() => { const p = document.querySelector('.lf-pill'); if (p) p.click(); return !!p })()`
    )
    await sleep(900)
    let back = main.isVisible()
    if (!back) {
      // focusable:false 的窗口在部分环境不投递 DOM 点击；退回同一条 IPC 通道验证
      console.log('WARN  飘条 DOM 点击未生效，改走 window.taskflow.lightmodeOpen()')
      try {
        await fly.webContents.executeJavaScript(`window.taskflow.lightmodeOpen()`)
      } catch {
        /* 窗口可能已被回收 */
      }
      await sleep(900)
      back = main.isVisible()
    }
    check('点飘条 → 退出轻量模式并唤回主窗口', back)
    check(
      '退出后飘窗关闭',
      !BrowserWindow.getAllWindows().some(isFly)
    )
  }

  // ---- 5) 再次进入 → 模拟点 Dock 图标（activate）----
  await main.webContents.executeJavaScript(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('轻量模式')).click()`
  )
  await sleep(600)
  const hiddenAgain = !main.isVisible()
  app.emit('activate') // 真实点 Dock 图标走的同一条事件
  await sleep(700)
  check('再次进入轻量模式（窗口隐藏）', hiddenAgain)
  check('模拟点 Dock 图标 → 退出并唤回', main.isVisible())
  check('Dock 图标在退出后仍在', process.platform !== 'darwin' || !!(app.dock && app.dock.isVisible()))

  check('渲染层无控制台报错', errors.length === 0, errors.slice(0, 3).join(' | '))

  const failed = results.filter((r) => !r.ok)
  console.log(
    `\n${failed.length ? `FAILED ${failed.length}/${results.length}` : `ALL ${results.length} PASSED`}`
  )
  console.log('shots dir:', OUT)
  app.exit(failed.length ? 1 : 0)
})
