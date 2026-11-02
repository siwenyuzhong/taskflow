'use strict'
/**
 * 量化「点击轻量模式 → 画面闪一下」并做对照实验。
 *
 * 指标：把点击前后的稳定帧当作两个端点，统计有多少帧既不等于端点 A 也不等于端点 B
 *       —— 这些「中间态」帧就是肉眼看到的闪烁（残影/半透明/重绘）。
 *
 * 用法：npx electron smoke-diagnose-flash.cjs [variant]
 *   variant: base(默认) | noShowInactive | noAlwaysOnTop | neither
 */
const { app, BrowserWindow, nativeImage } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, execFileSync } = require('node:child_process')

const VARIANT = process.argv[2] || 'base'
const OUT = `/tmp/taskflow-flash-${VARIANT}`
const USERDATA = path.join(os.tmpdir(), `taskflow-flash-${VARIANT}-userdata`)
const FFMPEG = path.join(__dirname, 'node_modules/ffmpeg-static/ffmpeg')
const SECONDS = 3

fs.rmSync(USERDATA, { recursive: true, force: true })
fs.mkdirSync(USERDATA, { recursive: true })
fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })
app.setPath('userData', USERDATA)

// ---- 对照实验：在 require 主进程前改写 BrowserWindow 原型 ----
const realShowInactive = BrowserWindow.prototype.showInactive
const realSetAlwaysOnTop = BrowserWindow.prototype.setAlwaysOnTop
if (VARIANT === 'noShowInactive' || VARIANT === 'neither') {
  BrowserWindow.prototype.showInactive = function () {
    // 飘窗要真正上屏，主窗口不需要
    if (this.webContents.getURL().includes('#lightfly')) return realShowInactive.call(this)
    return this
  }
}
if (VARIANT === 'noAlwaysOnTop' || VARIANT === 'neither') {
  BrowserWindow.prototype.setAlwaysOnTop = function (flag, level) {
    if (this.webContents.getURL().includes('#lightfly')) return realSetAlwaysOnTop.call(this, flag, level)
    if (flag === true) return this
    return realSetAlwaysOnTop.call(this, flag, level)
  }
}
if (VARIANT === 'old') {
  // 还原修复前的写法：hide() 之前先 setAlwaysOnTop(true) + showInactive()
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

function regionBytes(img, box) {
  const size = img.getSize()
  const b = img.toBitmap()
  const out = []
  for (let y = box.y; y < box.y + box.h; y += 2) {
    for (let x = box.x; x < box.x + box.w; x += 2) {
      const i = (y * size.width + x) * 4
      out.push(b[i], b[i + 1], b[i + 2])
    }
  }
  return out
}

function diffCount(a, b) {
  if (a.length !== b.length) return Infinity
  let n = 0
  for (let i = 0; i < a.length; i += 3) {
    if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 60) n += 1
  }
  return n
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
  // 保证录屏里拍到的是本应用（否则拍到的是终端/桌面，量出来的自然是「没变化」）
  app.focus()
  main.focus()
  await sleep(800)
  console.log(`[${VARIANT}] 录屏前 isVisible=${main.isVisible()} focused=${main.isFocused()}`)

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
  const box = { x: bounds.x * 2, y: bounds.y * 2, w: bounds.width * 2, h: bounds.height * 2 }
  const series = files.map((f) => regionBytes(nativeImage.createFromPath(`${OUT}/frames/${f}`), box))
  console.log(`[${VARIANT}] 帧数=${series.length}`)

  // 端点 A = 第 3 帧（点击前稳定），端点 B = 最后一帧（隐藏后稳定）
  const A = series[2]
  const B = series[series.length - 1]
  const total = A.length / 3
  const transitions = []
  for (let i = 0; i < series.length; i += 1) {
    const dA = diffCount(series[i], A)
    const dB = diffCount(series[i], B)
    const isA = dA / total < 0.01
    const isB = dB / total < 0.01
    transitions.push({ i, f: files[i], dA: (dA / total) * 100, dB: (dB / total) * 100, isA, isB })
  }
  const mid = transitions.filter((t) => !t.isA && !t.isB)
  console.log(
    `[${VARIANT}] 中间态帧数 = ${mid.length} / ${series.length}` +
      (mid.length ? `  →  ${mid.map((t) => t.f.replace(/\D/g, '')).join(',')}` : '')
  )
  console.log(`[${VARIANT}] 变化过程：`)
  for (const t of transitions) {
    if (t.dA < 0.5 && t.dB < 0.5) continue
    console.log(
      `   ${t.f}  vs点击前=${t.dA.toFixed(1).padStart(5)}%  vs点击后=${t.dB.toFixed(1).padStart(5)}%  ${t.isA ? '[=前]' : t.isB ? '[=后]' : '[中间态]'}`
    )
  }
  app.exit(0)
})
