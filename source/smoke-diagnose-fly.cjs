'use strict'
/**
 * 精确诊断飘窗显示：加载后立刻轮询 flyWindow 的 isVisible，
 * 并直接截图（screencapture 整屏上层区域）判断飘条是否出现在桌面上。
 * 运行：npx electron smoke-diagnose-fly.cjs [SLOTH_LIGHT_FIRST_FLY_MS]
 */
const { app, BrowserWindow, screen, nativeImage } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execSync } = require('node:child_process')

const OUT = '/tmp/taskflow-diagnose'
const USERDATA = path.join(os.tmpdir(), 'taskflow-diag6-userdata')
fs.rmSync(USERDATA, { recursive: true, force: true })
fs.mkdirSync(USERDATA, { recursive: true })
fs.mkdirSync(OUT, { recursive: true })
app.setPath('userData', USERDATA)

require('./electron/main.cjs')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const isFly = (w) => !w.isDestroyed() && w.webContents.getURL().includes('#lightfly')

app.whenReady().then(async () => {
  let main = null
  for (let i = 0; i < 100 && !main; i += 1) {
    main = BrowserWindow.getAllWindows().find(
      (w) => !isFly(w) && w.webContents.getURL().includes('index.html') && !w.webContents.isLoading()
    )
    if (!main) await sleep(150)
  }
  await sleep(1200)
  const area = screen.getPrimaryDisplay().workArea

  await main.webContents.executeJavaScript(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('轻量模式')).click()`
  )
  await main.webContents.executeJavaScript(
    `window.taskflow.lightmodeTasks({ message: '诊断：今天 18:00 到期', count: 2, taskId: 'x' })`
  )

  // 主进程里的飘窗由首拍定时器创建：这里主动等，并记录创建前后的可见性
  const fly = await (async () => {
    for (let i = 0; i < 120; i += 1) {
      const w = BrowserWindow.getAllWindows().find(isFly)
      if (w) return w
      await sleep(150)
    }
    return null
  })()
  if (!fly) {
    console.log('FAIL 飘窗从未创建')
    app.exit(1)
    return
  }
  console.log('飘窗已创建 bounds=', JSON.stringify(fly.getBounds()))

  for (let i = 0; i < 14; i += 1) {
    const n = await fly.webContents.executeJavaScript('1').catch(() => null)
    const vis = fly.isVisible()
    const x = await fly.webContents
      .executeJavaScript(
        `(() => { const p=document.querySelector('.lf-pill'); return p?Math.round(p.getBoundingClientRect().x):null })()`
      )
      .catch(() => null)
    if (i % 2 === 0) {
      // 真实屏幕：抓飘窗所在的顶部横条
      execSync(`screencapture -x -R 0,${area.y},${area.width},72 ${OUT}/row.png`, { stdio: 'ignore' })
      const img = nativeImage.createFromPath(`${OUT}/row.png`)
      const s = img.getSize()
      const b = img.toBitmap()
      const y = Math.floor(s.height / 2)
      let min = -1
      let max = -1
      for (let xx = 0; xx < s.width; xx += 2) {
        const idx = (y * s.width + xx) * 4
        if (b[idx] < 45 && b[idx + 1] < 45 && b[idx + 2] < 75) {
          if (min < 0) min = xx
          max = xx
        }
      }
      console.log(
        `t=${(i * 0.4).toFixed(1)}s dom=${n ? 'ok' : 'nil'} visible=${vis} pillX=${x} 屏幕深色带=[${min},${max}]`
      )
    }
    await sleep(400)
  }
  app.exit(0)
})
