'use strict'
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const MIN = 60_000
const FILE = process.env.SMOKE_FILE || '/tmp/taskflow-app/dist/index.html'

const seed = () => {
  const now = Date.now()
  const mk = (o) => ({
    id: o.id, title: o.title, note: '', categoryId: 'work', priority: 'medium',
    durationMin: 240, createdAt: now - 60 * MIN, cycleStartAt: now - 60 * MIN,
    dueAt: o.dueAt === undefined ? now + 180 * MIN : o.dueAt, renewCount: 0,
    remindLeadMin: 10, status: 'active', completedAt: null, remindedAt: null,
    expiredNotifiedAt: null, planned: !!o.planned,
  })
  return {
    version: 1,
    categories: [
      { id: 'work', name: '工作', color: '#7c5cff', builtin: true },
      { id: 'dev', name: '研发', color: '#2ee6d6', builtin: true },
      { id: 'life', name: '生活', color: '#f5a524', builtin: true },
    ],
    prefs: { theme: 'dark', sound: false, nativeNotify: false, defaultDurationMin: 240, defaultRemindLeadMin: 10 },
    tasks: [
      mk({ id: 't-run', title: '正在进行的任务', dueAt: now + 120 * MIN }),
      mk({ id: 'p1', title: '整理季度 OKR', planned: true, dueAt: now + 26 * 60 * MIN }),
      mk({ id: 'p2', title: '和设计过一轮视觉稿', planned: true, dueAt: now + 26 * 60 * MIN + 60000 }),
      mk({ id: 'p3', title: '写周四的分享稿', planned: true, dueAt: now + 26 * 60 * MIN + 120000 }),
    ],
  }
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1360, height: 820, show: false, backgroundColor: '#07070e' })
  const js = (c) => win.webContents.executeJavaScript(c)
  await win.loadFile(FILE)
  await sleep(800)
  win.show()
  await sleep(1000)
  await js(`(() => {
    const orig = localStorage.setItem.bind(localStorage)
    localStorage.setItem = (k,v) => { if (k !== 'taskflow-data') orig(k,v) }
    orig('taskflow-data', ${JSON.stringify(JSON.stringify(seed()))})
    return true
  })()`)
  await win.webContents.reload()
  await sleep(3000)
  await js(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().startsWith('未来计划')); if (b) b.click(); return true })()`)
  await sleep(1400)

  const dump = await js(`(() => {
    const cells = [...document.querySelectorAll('[role="gridcell"]')]
    const out = []
    cells.forEach((c, i) => {
      const btns = [...c.querySelectorAll('button')].map(b => JSON.stringify(b.textContent))
      if (btns.length) out.push({ i, label: c.getAttribute('aria-label'), btns })
    })
    return out
  })()`)
  console.log('CELLS WITH BUTTONS:', JSON.stringify(dump, null, 1))

  const all = await js(`(() => [...document.querySelectorAll('[role="gridcell"] button')].map(b => b.textContent))()`)
  console.log('ALL BUTTON TEXTS:', JSON.stringify(all))
  app.exit(0)
})
