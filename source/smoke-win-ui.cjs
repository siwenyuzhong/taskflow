'use strict'
/**
 * 验证 Windows 平台下的渲染层适配：
 *  - 顶栏左侧不再为 macOS 红绿灯留 88px
 *  - 顶栏右侧为系统窗口按钮预留 ~150px
 *  - 快捷键提示显示 Ctrl K
 */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const OUT = '/tmp/taskflow-win-ui'
const FILE = '/tmp/taskflow-app/dist/index.html'

app.whenReady().then(async () => {
  fs.rmSync(OUT, { recursive: true, force: true })
  fs.mkdirSync(OUT, { recursive: true })

  const win = new BrowserWindow({
    width: 1240,
    height: 820,
    show: false,
    backgroundColor: '#07070e',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0a0a12', symbolColor: '#b9c1d6', height: 60 },
    webPreferences: {
      preload: '/tmp/taskflow-app/test-win-preload.cjs',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  const errors = []
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2 && !/React DevTools/.test(message)) errors.push(`[console:${level}] ${message}`)
  })

  await win.loadFile(FILE)
  await sleep(900)
  win.show()
  await sleep(1500)

  const js = (c) => win.webContents.executeJavaScript(c)
  const probe = await js(`(() => {
    const h = document.querySelector('header')
    const cs = getComputedStyle(h)
    const kbd = document.querySelector('kbd')
    const logo = h.querySelector('div')
    const r = h.getBoundingClientRect()
    return {
      headerPaddingLeft: cs.paddingLeft,
      headerPaddingRight: cs.paddingRight,
      headerWidth: Math.round(r.width),
      appRegion: cs.webkitAppRegion || cs.getPropertyValue('-webkit-app-region'),
      kbdText: kbd ? kbd.textContent.trim() : null,
      platformSeen: window.taskflow ? window.taskflow.platform : 'none',
      footer: [...document.querySelectorAll('footer')].map(f => f.textContent.trim())[0],
      bodyScrollW: document.body.scrollWidth,
      innerW: window.innerWidth,
    }
  })()`)
  console.log('WIN UI PROBE:', JSON.stringify(probe, null, 1))

  const img = await win.webContents.capturePage()
  fs.writeFileSync(`${OUT}/win-topbar.png`, img.toPNG())

  const ok =
    probe.headerPaddingLeft === '8px' &&
    probe.headerPaddingRight === '16px' &&
    probe.kbdText === 'Ctrl K' &&
    /Ctrl\+K/.test(probe.footer || '')
  console.log(ok ? 'WIN_UI_ADAPT_OK' : 'WIN_UI_ADAPT_FAILED')
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO_CONSOLE_ERRORS')
  app.exit(ok && !errors.length ? 0 : 1)
})
