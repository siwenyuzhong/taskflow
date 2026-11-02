'use strict'
/** 最小透明窗 + 静态元素：确认真实桌面上到底有没有这条 */
const { app, BrowserWindow, screen, nativeImage } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execSync } = require('node:child_process')

const USERDATA = path.join(os.tmpdir(), 'taskflow-diag4-userdata')
fs.rmSync(USERDATA, { recursive: true, force: true })
fs.mkdirSync(USERDATA, { recursive: true })
fs.mkdirSync('/tmp/taskflow-diagnose', { recursive: true })
app.setPath('userData', USERDATA)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

app.whenReady().then(async () => {
  const area = screen.getPrimaryDisplay().workArea
  const win = new BrowserWindow({
    x: area.x + 100,
    y: area.y + 200,
    width: 700,
    height: 120,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: { contextIsolation: true, backgroundThrottling: false },
  })
  fs.writeFileSync(
    '/tmp/diag3.html',
    `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{background:transparent!important;margin:0;overflow:hidden}
      .box{width:600px;height:80px;margin:20px;border-radius:20px;background:#0a0a16;color:#fff;
           font:600 16px -apple-system;display:flex;align-items:center;justify-content:center}
    </style></head><body><div class="box" id="b">静态块 · 背景节流关闭 · 桌面可见性</div></body></html>`
  )
  await win.loadFile('/tmp/diag3.html')
  win.showInactive()
  await sleep(600)
  // 用 alpha 判断块是否真的画进了窗口（透明处 alpha=0）
  const img0 = await win.webContents.capturePage()
  const s0 = img0.getSize()
  const b0 = img0.toBitmap()
  const y0 = Math.floor(s0.height / 2)
  let bMin = -1
  let bMax = -1
  for (let x = 0; x < s0.width; x++) {
    if (b0[(y0 * s0.width + x) * 4 + 3] > 10) {
      if (bMin < 0) bMin = x
      bMax = x
    }
  }
  console.log(`capture alpha 区间=[${bMin},${bMax}]（透明窗应为块宽度附近，若为 -1 则页面没画）`)
  await new Promise((r) => setTimeout(r, 2500))
  const img0b = await win.webContents.capturePage()
  const b1 = img0b.toBitmap()
  let b1Min = -1
  let b1Max = -1
  for (let x = 0; x < s0.width; x++) {
    if (b1[(y0 * s0.width + x) * 4 + 3] > 10) {
      if (b1Min < 0) b1Min = x
      b1Max = x
    }
  }
  console.log(`等 2.5s 后再抓 alpha 区间=[${b1Min},${b1Max}]（若变成 -1 说明不可见时被节流/丢弃）`)
  await sleep(200)

  // 把窗口位置印出来；抓真实屏幕
  console.log('win bounds', JSON.stringify(win.getBounds()), 'visible', win.isVisible())
  execSync(`screencapture -x /tmp/taskflow-diagnose/full.png`, { stdio: 'ignore' })
  const img = nativeImage.createFromPath('/tmp/taskflow-diagnose/full.png')
  const s = img.getSize()
  const bmp = img.toBitmap()
  const scale = s.width / area.width
  const cx = Math.round((win.getBounds().x + 300) * scale)
  const cy = Math.round((win.getBounds().y + 60) * scale)
  const idx = (cy * s.width + cx) * 4
  console.log(
    `full=${s.width}x${s.height} scale=${scale} 取样点(${cx},${cy}) BGRA=`,
    bmp[idx], bmp[idx + 1], bmp[idx + 2], bmp[idx + 3]
  )
  // 在取样行上找暗色区间
  let minX = -1
  let maxX = -1
  for (let x = 0; x < s.width; x++) {
    const i = (cy * s.width + x) * 4
    if (bmp[i] < 25 && bmp[i + 1] < 25 && bmp[i + 2] < 40 && bmp[i + 3] > 10) {
      if (minX < 0) minX = x
      maxX = x
    }
  }
  console.log(`该行暗色区间 = [${minX},${maxX}]`)
  app.exit(0)
})
