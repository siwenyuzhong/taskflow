'use strict'
/**
 * 逐帧剖析「点击轻量模式」时窗口区域的变化形态（只看「像点击前」的占比曲线）。
 * 用法：npx electron smoke-analyze-frames.cjs <framesDir> [winX winY winW winH]
 */
const { app, nativeImage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const DIR = process.argv[2] || '/tmp/taskflow-flash-base/sheet'
const WX = Number(process.argv[3] ?? 200)
const WY = Number(process.argv[4] ?? 120)
const WW = Number(process.argv[5] ?? 2200)
const WH = Number(process.argv[6] ?? 1400)

app.whenReady().then(() => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.png')).sort()
  const imgs = files.map((f) => {
    const img = nativeImage.createFromPath(path.join(DIR, f))
    return { f, b: img.toBitmap(), size: img.getSize() }
  })
  const { width, height } = imgs[0].size

  const pts = []
  for (let y = WY; y < Math.min(height, WY + WH); y += 4) {
    for (let x = WX; x < Math.min(width, WX + WW); x += 4) {
      pts.push((y * width + x) * 4)
    }
  }
  const snap = (im) => pts.map((i) => [im.b[i], im.b[i + 1], im.b[i + 2]])
  const series = imgs.map((im) => snap(im))
  const A = series[2]
  const match = (s, ref, tol = 24) => {
    let n = 0
    for (let k = 0; k < s.length; k += 1) {
      if (
        Math.abs(s[k][0] - ref[k][0]) +
          Math.abs(s[k][1] - ref[k][1]) +
          Math.abs(s[k][2] - ref[k][2]) <=
        tol
      )
      n += 1
    }
    return (n / s.length) * 100
  }
  const m = series.map((s) => match(s, A))
  const floor = m[m.length - 1]

  // 变化起点：第一次明显偏离 100
  let start = m.findIndex((v) => v < 99)
  // 变化终点：进入平台（连续 5 帧变化 < 0.3%）
  let end = start
  for (let i = start; i < m.length; i += 1) {
    let stable = true
    for (let k = 1; k <= 5 && i + k < m.length; k += 1) {
      if (Math.abs(m[i + k] - m[i]) > 0.3) stable = false
    }
    if (stable) {
      end = i
      break
    }
  }
  console.log(`帧数=${files.length} 采样点=${pts.length} 变化起点=s${String(start + 1).padStart(3, '0')} 终点=s${String(end + 1).padStart(3, '0')} 过渡帧数=${end - start + 1} (≈${(((end - start + 1) / 60) * 1000).toFixed(0)}ms) 终值=${floor.toFixed(1)}%`)
  console.log('帧   像点击前%   逐帧跌幅')
  for (let i = 0; i <= m.length - 1; i += 1) {
    const d = i > 0 ? m[i - 1] - m[i] : 0
    if (m[i] > 99.5 && Math.abs(d) < 0.2 && i !== 0 && i !== m.length - 1) continue
    console.log(`s${String(i + 1).padStart(3, '0')}   ${m[i].toFixed(1).padStart(8)}   ${d.toFixed(2).padStart(7)}`)
  }
  app.exit(0)
})
