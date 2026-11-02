'use strict'
/**
 * 字幕悬浮窗可视化冒烟：验证
 *   1) 单行显示（只保留当前这句）
 *   2) 悬停态推送时显示阴影底板 + 关闭按钮；沉浸时仅文字描边
 *   3) 多说话人时显示「说话人 N」标签
 *   4) 字幕页持续上报本体矩形（主进程据此做悬停命中）
 * 用 mock preload 提供 window.api.windows；悬停态由测试直接推送（模拟主进程轮询结果）。
 */
const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const OUT = '/tmp/taskflow-smoke-subtitle'
const FILE = process.env.SMOKE_FILE || path.join(__dirname, 'dist/index.html')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// mock 桥接：只实现 SubtitleOverlay 用到的方法；hit/drag 记录给测试断言用
const PRELOAD = `
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('api', {
  windows: {
    subtitleHit: (r) => ipcRenderer.send('smoke:hit', r),
    subtitleDrag: (on) => ipcRenderer.send('smoke:drag', !!on),
    onSubtitleHoverState: (cb) => {
      const h = (_e, v) => cb(!!v)
      ipcRenderer.on('smoke:hover-state', h)
      return () => ipcRenderer.removeListener('smoke:hover-state', h)
    },
    onSubtitle: (cb) => {
      const h = (_e, p) => cb(p)
      ipcRenderer.on('smoke:sub', h)
      return () => ipcRenderer.removeListener('smoke:sub', h)
    },
    sendSubtitleCommand: (a) => ipcRenderer.send('smoke:cmd', String(a)),
  },
})
`

app.whenReady().then(async () => {
  fs.rmSync(OUT, { recursive: true, force: true })
  fs.mkdirSync(OUT, { recursive: true })
  const preloadPath = path.join(os.tmpdir(), 'smoke-subtitle-preload.cjs')
  fs.writeFileSync(preloadPath, PRELOAD)

  let lastHit = null
  let dragSeen = false
  ipcMain.on('smoke:hit', (_e, r) => { lastHit = r })
  ipcMain.on('smoke:drag', () => { dragSeen = true })

  // 用不透明灰底模拟字幕下方的页面，方便看清描边与阴影
  const win = new BrowserWindow({
    width: 1000,
    height: 184,
    x: 60,
    y: 60,
    frame: false,
    transparent: false,
    backgroundColor: '#8a8f98',
    show: false,
    webPreferences: { preload: preloadPath, contextIsolation: true, offscreen: false },
  })

  const errors = []
  win.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) errors.push(`[console:${level}] ${message} (${source}:${line})`)
  })
  win.webContents.on('render-process-gone', (_e, d) => errors.push(`[gone] ${d.reason}`))

  const shot = async (name) => {
    const img = await win.webContents.capturePage()
    fs.writeFileSync(`${OUT}/${name}.png`, img.toPNG())
    console.log(`shot -> ${name}.png`)
  }
  const js = (code) => win.webContents.executeJavaScript(code)
  const pushHover = (on) => win.webContents.send('smoke:hover-state', on)

  await win.loadFile(FILE, { hash: 'subtitle' })
  await sleep(1200)
  win.show()
  await sleep(300)

  // 推一条含两个说话人的字幕：pending 为当前这句
  const payload = {
    text: '第一段定稿内容。第二段定稿内容。',
    segments: [
      { startMs: 0, endMs: 2000, text: '第一段定稿内容。', speaker: 0 },
      { startMs: 2000, endMs: 4000, text: '第二段定稿内容。', speaker: 1 },
    ],
    pending: '正在说的这一句话，字幕每次只显示一行。',
    speaker: 1,
  }
  win.webContents.send('smoke:sub', payload)
  await sleep(1600) // 等逐字打印完成

  // ---- 沉浸态（主进程推送 hover=false）----
  await pushHover(false)
  await sleep(400)
  await shot('1-immersive')
  const immersiveState = await js(`(() => {
    const closeBtn = [...document.querySelectorAll('button')].find(b => b.title === '关闭字幕窗');
    const p = document.querySelector('p');
    return {
      lineCount: document.querySelectorAll('p').length,
      text: p ? p.textContent : null,
      closeOpacity: closeBtn ? getComputedStyle(closeBtn).opacity : null,
      closePE: closeBtn ? getComputedStyle(closeBtn).pointerEvents : null,
      hasSpeaker: document.body.innerText.includes('说话人'),
    };
  })()`)
  console.log('immersive:', JSON.stringify(immersiveState))

  // ---- 悬停态（主进程推送 hover=true）----
  await pushHover(true)
  await sleep(400)
  await shot('2-hover')
  const hoverState = await js(`(() => {
    const closeBtn = [...document.querySelectorAll('button')].find(b => b.title === '关闭字幕窗');
    const box = closeBtn ? closeBtn.parentElement : null;
    return {
      closeOpacity: closeBtn ? getComputedStyle(closeBtn).opacity : null,
      closePE: closeBtn ? getComputedStyle(closeBtn).pointerEvents : null,
      boxShadow: box ? getComputedStyle(box).boxShadow !== 'none' : null,
      bg: box ? getComputedStyle(box).backgroundColor : null,
    };
  })()`)
  console.log('hover:', JSON.stringify(hoverState))

  // ---- 命中矩形上报：应已收到且落在窗口底部居中区域 ----
  await sleep(200)
  console.log('hit rect:', JSON.stringify(lastHit), 'hitValid:', !!(lastHit && lastHit.w > 40 && lastHit.h > 20 && lastHit.y > 40))

  // ---- 单行验证：main 只取当前这句 ----
  const singleLine = await js(`(() => {
    const ps = [...document.querySelectorAll('p')];
    const main = ps.find(x => x.textContent.includes('只显示一行'));
    const prev = ps.some(x => x.textContent.includes('第一段定稿'));
    return { showsCurrent: !!main, showsPrevSentence: prev };
  })()`)
  console.log('single-line:', JSON.stringify(singleLine))

  // ---- 重拍沉浸态：先悬停确保合成器已绘制，再推送沉浸，避免 capturePage 取到旧帧 ----
  await pushHover(true)
  await sleep(300)
  await pushHover(false)
  await sleep(400)
  await shot('3-immersive-after')
  const immersive2 = await js(`(() => {
    const closeBtn = [...document.querySelectorAll('button')].find(b => b.title === '关闭字幕窗');
    const box = closeBtn ? closeBtn.parentElement : null;
    const p = document.querySelector('p');
    return {
      text: p ? p.textContent : null,
      closeOpacity: closeBtn ? getComputedStyle(closeBtn).opacity : null,
      closePE: closeBtn ? getComputedStyle(closeBtn).pointerEvents : null,
      boxShadow: box ? getComputedStyle(box).boxShadow !== 'none' : null,
      bg: box ? getComputedStyle(box).backgroundColor : null,
    };
  })()`)
  console.log('immersive-after:', JSON.stringify(immersive2))
  console.log('drag ipc seen (no user press):', dragSeen)

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO_CONSOLE_ERRORS')
  console.log('shots dir:', OUT)
  app.exit(0)
})
