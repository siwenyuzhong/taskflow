'use strict'
/**
 * 诊断已安装的 /Applications/Sloth.app（真实主进程 + 真实 preload + 真实渲染层）：
 *   1) 进入轻量模式后 Dock 图标是否可见（activate 需要至少一个可见窗口才唤得回来）
 *   2) 飘窗是否真的出现在屏幕顶部、是否可见、是否被合成/遮挡
 *   3) 联动 dock.isVisible / 窗口列表 / 飘条矩形，用于定位「没飘出来」的原因
 *
 * 运行：npx electron smoke-dock-diagnose.cjs
 */
const { app, BrowserWindow, screen } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const OUT = '/tmp/taskflow-diagnose'
const USERDATA = path.join(os.tmpdir(), 'taskflow-diagnose-userdata')

fs.rmSync(USERDATA, { recursive: true, force: true })
fs.mkdirSync(USERDATA, { recursive: true })
fs.mkdirSync(OUT, { recursive: true })
app.setPath('userData', USERDATA)
process.env.SLOTH_LIGHT_FIRST_FLY_MS = '1500'

require('./electron/main.cjs')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(fn, timeout = 8000) {
  const end = Date.now() + timeout
  for (;;) {
    let v = null
    try {
      v = await fn()
    } catch {}
    if (v) return v
    if (Date.now() > end) return null
    await sleep(120)
  }
}

const isFly = (w) => !w.isDestroyed() && w.webContents.getURL().includes('#lightfly')

app.whenReady().then(async () => {
  const main = await waitFor(() =>
    BrowserWindow.getAllWindows().find(
      (w) => !isFly(w) && w.webContents.getURL().includes('index.html') && !w.webContents.isLoading()
    )
  )
  await sleep(1200)
  console.log('主窗口:', main ? 'ok' : 'missing', 'visible=', main && main.isVisible())

  console.log('\n--- 进入轻量模式 ---')
  await main.webContents.executeJavaScript(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('轻量模式')).click()`
  )
  await sleep(1000)

  const wins = BrowserWindow.getAllWindows().map((w) => ({
    url: w.webContents.getURL().slice(-24) || '(empty)',
    visible: w.isVisible(),
    bounds: w.getBounds(),
    alwaysOnTop: w.isAlwaysOnTop(),
    focusable: w.isFocusable(),
    level: typeof w.getTitle,
  }))
  console.log('主窗口 visible =', main.isVisible())
  console.log('窗口列表 =', JSON.stringify(wins, null, 1))
  console.log('dock.isVisible() =', app.dock ? app.dock.isVisible() : '(no dock api)')
  console.log('所有窗口都不可见? =', BrowserWindow.getAllWindows().every((w) => !w.isVisible()))

  console.log('\n--- 等飘窗（1.5s 首拍）---')
  await main.webContents.executeJavaScript(`window.taskflow.lightmodeTasks({
    message: '「完成 Sloth 需求评审」今天 18:00 到期', count: 2, taskId: 'task-x' })`)
  const fly = await waitFor(() => BrowserWindow.getAllWindows().find(isFly))
  console.log('飘窗存在 =', !!fly)
  if (fly) {
    await waitFor(() => !fly.webContents.isLoading())
    await sleep(900)
    console.log('飘窗 visible =', fly.isVisible(), 'bounds =', JSON.stringify(fly.getBounds()))
    console.log('工作区 =', JSON.stringify(screen.getPrimaryDisplay().workArea))
    const pill = await fly.webContents.executeJavaScript(`(() => {
      const p = document.querySelector('.lf-pill')
      if (!p) return null
      const r = p.getBoundingClientRect()
      const cs = getComputedStyle(p)
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
               opacity: cs.opacity, transform: cs.transform, anim: cs.animationName, bg: cs.backgroundColor }
    })()`)
    console.log('飘条矩形/样式 =', JSON.stringify(pill))
    const img = await fly.webContents.capturePage()
    fs.writeFileSync(`${OUT}/fly.png`, img.toPNG())
    // 同时抓一张全屏，看它到底有没有画在桌面上
    const disp = screen.getPrimaryDisplay()
    const img2 = await (async () => {
      const { desktopCapturer } = require('electron')
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: disp.size.width, height: disp.size.height },
      })
      return sources[0]
    })()
    if (img2) fs.writeFileSync(`${OUT}/screen.png`, img2.thumbnail.toPNG())
    console.log('截图:', OUT)
  } else {
    console.log('飘窗未创建 → 检查 lightPayload 是否为空');
    const st = await main.webContents.executeJavaScript(`(async () => {
      const r = await window.taskflow.lightmodeTasks({ message: 'ping', count: 1 })
      return r
    })()`)
    console.log('lightmodeTasks 返回 =', st)
  }
  app.exit(0)
})
