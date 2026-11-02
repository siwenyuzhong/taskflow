'use strict'
/**
 * 定向验证：只有"用户主动定位任务"（原生通知点击 / Toast「定位任务」）才滚动页面。
 * 通过真实的 preload + IPC 通道发送 taskflow:focus-task，模拟通知点击。
 */
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const OUT = '/tmp/taskflow-smoke'
const FILE = '/tmp/taskflow-app/dist/index.html'
const PRELOAD = '/tmp/taskflow-app/electron/preload.cjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const now = Date.now()
const TASKS = Array.from({ length: 24 }, (_, i) => ({
  id: `t${i}`,
  title: `定位测试任务 ${i + 1}`,
  note: '',
  categoryId: 'work',
  priority: 'medium',
  durationMin: 240,
  createdAt: now - i * 60_000,
  cycleStartAt: now,
  dueAt: now + (i + 1) * 3_600_000,
  renewCount: 0,
  remindLeadMin: 10,
  status: 'active',
  completedAt: null,
  remindedAt: null,
  expiredNotifiedAt: null,
}))

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true })

  ipcMain.handle('taskflow:read', () => ({
    version: 1,
    tasks: TASKS,
    categories: [
      { id: 'work', name: '工作', color: '#7c5cff', builtin: true },
      { id: 'dev', name: '研发', color: '#2ee6d6', builtin: true },
    ],
    prefs: { theme: 'dark', sound: false, nativeNotify: false, defaultDurationMin: 240, defaultRemindLeadMin: 10 },
  }))
  for (const ch of ['taskflow:write', 'taskflow:badge', 'taskflow:reveal-data', 'taskflow:notify', 'taskflow:window', 'taskflow:flush']) {
    ipcMain.handle(ch, () => true)
  }
  ipcMain.handle('taskflow:info', () => ({}))

  const win = new BrowserWindow({
    width: 1440,
    height: 940,
    show: false,
    backgroundColor: '#07070e',
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: false },
  })

  const errors = []
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) errors.push(`[console:${level}] ${message}`)
  })

  const js = (code) => win.webContents.executeJavaScript(code)
  const shot = async (n) => {
    const img = await win.webContents.capturePage()
    fs.writeFileSync(`${OUT}/${n}.png`, img.toPNG())
    console.log(`shot -> ${n}.png`)
  }

  await win.loadFile(FILE)
  await sleep(2600)
  await js(`document.querySelector('main').scrollTo({ top: 0, behavior: 'auto' })`)
  await sleep(500)

  const probe = await js(`(() => {
    const main = document.querySelector('main');
    const cards = [...document.querySelectorAll('[data-task-id]')];
    const last = cards[cards.length - 1];
    const top = last.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop;
    return { count: cards.length, lastId: last.dataset.taskId, lastTop: Math.round(top),
             clientHeight: main.clientHeight, scrollHeight: main.scrollHeight, scrollTop: main.scrollTop };
  })()`)
  console.log('probe:', JSON.stringify(probe))
  await shot('11-scroll-before-reveal')

  // 模拟「点击系统通知」→ 主进程发送定位事件
  win.webContents.send('taskflow:focus-task', probe.lastId)
  await sleep(1600)

  const after = await js(`(() => {
    const main = document.querySelector('main');
    const el = document.querySelector('[data-task-id="${probe.lastId}"]');
    const top = el.getBoundingClientRect().top - main.getBoundingClientRect().top;
    return { scrollTop: Math.round(main.scrollTop), cardTop: Math.round(top), cardVisible: top >= 0 && top < main.clientHeight };
  })()`)
  await shot('12-scroll-after-reveal')
  console.log('after reveal:', JSON.stringify(after))
  console.log(
    after.scrollTop > 0 && after.cardVisible
      ? '✅ 主动定位仍然有效（滚动到目标卡片）'
      : '❌ 主动定位失效'
  )

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO_CONSOLE_ERRORS')
  app.exit(0)
})
