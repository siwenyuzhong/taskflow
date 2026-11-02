'use strict'
/**
 * 确定性测「窗口在屏幕上停留了多久 / 有没有中间态」：
 * 用窗口左上角那颗**红色交通灯按钮**当探针。
 *   - 窗口可见且聚焦 → 那一小块是红点（R-G 明显为正）
 *   - 窗口已隐藏     → 那一小块变成桌面/别的窗口（R-G 回到 0 附近）
 * 红点位置在录制前从「点击前那一帧」自动校准，不写死坐标。
 *
 * 用法：npx electron smoke-probe-transition.cjs [old|new]
 */
const { app, BrowserWindow, nativeImage } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, execFileSync } = require('node:child_process')

const VARIANT = process.argv[2] === 'old' ? 'old' : 'new'
const OUT = `/tmp/taskflow-probe-${VARIANT}`
const USERDATA = path.join(os.tmpdir(), `taskflow-probe-${VARIANT}-userdata`)
const FFMPEG = path.join(__dirname, 'node_modules/ffmpeg-static/ffmpeg')
const SECONDS = 3

fs.rmSync(USERDATA, { recursive: true, force: true })
fs.mkdirSync(USERDATA, { recursive: true })
fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })
app.setPath('userData', USERDATA)

const realShowInactive = BrowserWindow.prototype.showInactive
const realSetAlwaysOnTop = BrowserWindow.prototype.setAlwaysOnTop
if (VARIANT === 'old') {
  // 还原修复前：hide() 之前先 setAlwaysOnTop(true) + showInactive()
  const realHide = BrowserWindow.prototype.hide
  BrowserWindow.prototype.hide = function () {
    if (!this.webContents.getURL().includes('#lightfly')) {
      realSetAlwaysOnTop.call(this, true)
      realShowInactive.call(this)
    }
    return realHide.call(this)
  }
}

require('./electron/main.cjs')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const isFly = (w) => !w.isDestroyed() && w.webContents.getURL().includes('#lightfly')

/** 在给定矩形里找 R-G 最大的像素（红点） */
function findRed(b, size, x0, y0, w, h) {
  let best = null
  for (let y = y0; y < y0 + h; y += 1) {
    for (let x = x0; x < x0 + w; x += 1) {
      const i = (y * size.width + x) * 4
      const d = b[i] - b[i + 1]
      if (!best || d > best.d) best = { x, y, d, r: b[i], g: b[i + 1], b: b[i + 2] }
    }
  }
  return best
}

app.whenReady().then(async () => {
  let main = null
  for (let i = 0; i < 100 && !main; i += 1) {
    main = BrowserWindow.getAllWindows().find(
      (w) => !isFly(w) && w.webContents.getURL().includes('index.html') && !w.webContents.isLoading()
    )
    if (!main) await sleep(150)
  }
  if (!main) {
    console.log('FAIL 主窗口未加载')
    app.exit(1)
    return
  }
  await sleep(1500)
  const bounds = { x: 100, y: 60, width: 1100, height: 700 }
  main.setBounds(bounds)
  app.focus()
  main.focus()
  await sleep(900)

  const rec = spawn('/usr/sbin/screencapture', ['-x', '-V', String(SECONDS), `${OUT}/rec.mov`], {
    stdio: 'ignore',
  })
  await sleep(700)
  await main.webContents.executeJavaScript(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('轻量模式')).click()`
  )
  await sleep(2500)
  console.log(`[${VARIANT}] 点击后 isVisible = ${main.isVisible()}`)
  await new Promise((r) => {
    rec.on('close', r)
    setTimeout(r, 3000)
  })
  await sleep(400)

  fs.mkdirSync(`${OUT}/frames`, { recursive: true })
  execFileSync(FFMPEG, ['-i', `${OUT}/rec.mov`, '-vf', 'fps=60', `${OUT}/frames/f%04d.png`, '-loglevel', 'error'])
  const files = fs.readdirSync(`${OUT}/frames`).filter((f) => f.endsWith('.png')).sort()

  // 校准红点：在「点击前」那一帧（f0005）窗口左上角附近找 R-G 最大的像素
  const pre = nativeImage.createFromPath(`${OUT}/frames/f0005.png`)
  const ps = pre.getSize()
  const wx = bounds.x * 2
  const wy = bounds.y * 2
  const red = findRed(pre.toBitmap(), ps, wx, wy, 160, 120)
  console.log(`[${VARIANT}] 红点探针 = (${red.x},${red.y}) R-G=${red.d} rgb=(${red.r},${red.g},${red.b})`)

  const probe = files.map((f) => {
    const img = nativeImage.createFromPath(`${OUT}/frames/${f}`)
    const s = img.getSize()
    const b = img.toBitmap()
    const i = (red.y * s.width + red.x) * 4
    return { f, rg: b[i] - b[i + 1], r: b[i], g: b[i + 1], b: b[i + 2] }
  })

  const vis = probe.map((p) => p.rg > 40) // 红点还在 = 窗口还在屏幕上
  let firstGone = vis.findIndex((v) => !v)
  if (firstGone < 0) firstGone = vis.length
  // 中间态 = 既不是「明显有红点」也不是「明显没有」
  const mid = probe.filter((p, i) => i > 0 && i < probe.length - 1 && p.rg > 8 && p.rg <= 40)

  console.log(`[${VARIANT}] 窗口消失于第 ${firstGone + 1} 帧（≈${((firstGone / 60) * 1000).toFixed(0)}ms 处开始）`)
  console.log(`[${VARIANT}] 中间态（半亮/半灭）帧数 = ${mid.length} ${mid.length ? '→ ' + mid.map((p) => p.f.replace(/\D/g, '')).join(',') : ''}`)
  console.log('红点 R-G 曲线（前 60 帧）：')
  probe.slice(0, 60).forEach((p, i) => {
    const d = i > 0 ? p.rg - probe[i - 1].rg : 0
    console.log(
      `  ${p.f}  R-G=${String(p.rg).padStart(4)}  Δ=${String(d).padStart(5)}  ${p.rg > 40 ? '窗口在' : p.rg > 8 ? '中间态' : '窗口没了'}`
    )
  })
  app.exit(0)
})
