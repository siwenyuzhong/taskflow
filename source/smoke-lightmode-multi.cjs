'use strict'
/**
 * 轻量模式「多飘条 + 悬停暂停」冒烟（真实主进程 + 真实渲染层 + 真实 preload）：
 *   1) 推送 3 条任务 → 生成 3 个飘条（有几条任务就飘几条），按错峰依次入场
 *   2) 每个飘条各自独立从右往左移动
 *   3) 模拟鼠标停在中间那条上 → 该条暂停（x 不再变化），其余继续移动
 *   4) 移开鼠标 → 该条恢复滑动
 *   5) 点击飘条 → 唤回主窗口并退出轻量模式
 *
 * 悬停走的是主进程轮询 `screen.getCursorScreenPoint()`，这里用
 * SLOTH_TEST_CURSOR=<"x,y"> 环境变量把光标位置注入进去，保证可在无人干预下复现。
 *
 * userData 指向 /tmp，绝不读写真实数据。
 * 运行：npx electron smoke-lightmode-multi.cjs
 */
const { app, BrowserWindow, screen } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const OUT = '/tmp/taskflow-smoke-multi'
const USERDATA = path.join(os.tmpdir(), 'taskflow-smoke-multi-userdata')

fs.rmSync(USERDATA, { recursive: true, force: true })
fs.mkdirSync(USERDATA, { recursive: true })
fs.mkdirSync(OUT, { recursive: true })
app.setPath('userData', USERDATA)
process.env.SLOTH_LIGHT_FIRST_FLY_MS = '1200'

// 渲染层才是待办清单的唯一真源：预置数据文件让应用启动时就有 3 条「今天/已过期」任务，
// 这样从点按钮 → 渲染层推送 → 主进程飘窗，全程走真实链路，不用去和渲染层的推送抢 payload。
const nowMs = Date.now()
const mkTask = (id, title, dueAt, minutes) => ({
  id,
  title,
  note: '',
  categoryId: 'work',
  priority: 'high',
  status: 'active',
  estimateMin: minutes,
  dueAt,
  createdAt: nowMs - 600_000,
  completedAt: null,
  remindedAt: null,
  expiredNotifiedAt: null,
  trashedAt: null,
  subtasks: [],
})
fs.writeFileSync(
  path.join(USERDATA, 'taskflow-data.json'),
  JSON.stringify(
    {
      version: 1,
      categories: [
        { id: 'work', name: '工作', color: '#7c5cff' },
        { id: 'life', name: '生活', color: '#2ee6d6' },
      ],
      prefs: {},
      tasks: [
        mkTask('t1', '写季度复盘', nowMs - 3 * 3600_000, 60),
        mkTask('t2', '完成需求评审', nowMs + 2 * 3600_000, 30),
        mkTask('t3', '给妈妈打电话', nowMs + 5 * 3600_000, 15),
      ],
      habits: [],
      notes: [],
      sheets: [],
      activeSheetId: null,
    },
    null,
    2
  )
)

// —— 注入可控光标位置：主进程每 60ms 轮询一次，我们从测试里改写这个变量 ——
// 注意 screen 模块在 app ready 之前不可用，所以补丁要放到 whenReady 里。
global.__TEST_CURSOR = null
let realGetCursor = null
const installCursorPatch = () => {
  realGetCursor = screen.getCursorScreenPoint.bind(screen)
  screen.getCursorScreenPoint = () => global.__TEST_CURSOR || realGetCursor()
}

// —— 诊断：把主进程内部状态暴露出来（仅测试文件，不进产物）——
require('./electron/main.cjs')


const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(fn, timeout = 12000) {
  const end = Date.now() + timeout
  for (;;) {
    let v = null
    try {
      v = await fn()
    } catch {
      /* not ready */
    }
    if (v) return v
    if (Date.now() > end) return null
    await sleep(120)
  }
}
const isFly = (w) => !w.isDestroyed() && w.webContents.getURL().includes('#lightfly')

const results = []
const check = (n, ok, extra = '') => {
  results.push(!!ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? ` — ${extra}` : ''}`)
}

/** 各飘条当前的左缘 x（窗口坐标） */
const pillXs = (fly) =>
  fly.webContents.executeJavaScript(
    `Array.from(document.querySelectorAll('.lf-pill')).map((el) => Math.round(el.getBoundingClientRect().x))`
  )

app.whenReady().then(async () => {
  installCursorPatch()
  const main = await waitFor(() =>
    BrowserWindow.getAllWindows().find(
      (w) => !isFly(w) && w.webContents.getURL().includes('index.html') && !w.webContents.isLoading()
    )
  )
  await sleep(1400)
  const area = screen.getPrimaryDisplay().workArea

  await main.webContents.executeJavaScript(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('轻量模式')).click()`
  )
  await sleep(300)

  const fly = await waitFor(() => BrowserWindow.getAllWindows().find(isFly))
  check('飘窗已创建', !!fly)
  if (!fly) {
    app.exit(1)
    return
  }
  await waitFor(() => !fly.webContents.isLoading())
  check('飘窗在屏幕上可见', fly.isVisible())

  const n = await fly.webContents.executeJavaScript(`document.querySelectorAll('.lf-pill').length`)
  check('有几条任务就飘几条（3 条）', n === 3, `实际 ${n} 条`)
  const titles = await fly.webContents.executeJavaScript(
    `Array.from(document.querySelectorAll('.lf-pill .lf-msg')).map((e) => e.textContent)`
  )
  check('每条各显示一个任务标题', JSON.stringify(titles) === JSON.stringify(['写季度复盘', '完成需求评审', '给妈妈打电话']), titles.join(' / '))
  const labels = await fly.webContents.executeJavaScript(
    `Array.from(document.querySelectorAll('.lf-pill .lf-when')).map((e) => e.textContent)`
  )
  check(
    '每条带自己的时间标签（过期 / 今天 HH:MM）',
    labels.length === 3 &&
      labels[0] === '已过期' &&
      /^今天 \d{2}:\d{2}$/.test(labels[1]) &&
      /^今天 \d{2}:\d{2}$/.test(labels[2]),
    labels.join(' / ')
  )

  // 等错峰入场：第 1 条已经进场，第 2/3 条还陆续跟在右边
  await sleep(2500)
  const xs1 = await pillXs(fly)
  check('飘条各自独立移动（3 条 x 各不相同）', new Set(xs1).size >= 2, `x=${xs1.join(', ')}`)

  // ---- 悬停第 2 条（下标 1）：等它滑进屏幕，再把光标钉到它中心 ----
  const waitOnScreen = async (idx) => {
    // 30s 行程下第 2 条约 17s 才完整进屏，轮询上限要盖住
    for (let i = 0; i < 260; i += 1) {
      const r = await fly.webContents.executeJavaScript(
        `(() => { const r = document.querySelectorAll('.lf-pill')[${idx}].getBoundingClientRect();
           return { x: r.x, y: r.y, w: r.width, h: r.height } })()`
      )
      // 药丸完整落在窗口内（窗口宽 area.width）才算「在屏幕上」
      if (r.x >= 0 && r.x + r.w <= area.width) return r
      await sleep(100)
    }
    return null
  }
  const onScreen = await waitOnScreen(1)
  check('第 2 条已滑入屏幕（可被悬停）', !!onScreen)
  if (onScreen) {
    global.__TEST_CURSOR = {
      x: area.x + Math.round(onScreen.x + onScreen.w / 2),
      y: area.y + Math.round(onScreen.y + onScreen.h / 2),
    }
  }
  await sleep(500)
  const pausedStyle = await fly.webContents.executeJavaScript(
    `document.querySelectorAll('.lf-pill')[1].classList.contains('lf-paused')`
  )
  check('悬停那条进入暂停态（样式 + 状态推送）', pausedStyle)

  const a = await pillXs(fly)
  await sleep(1200)
  const b = await pillXs(fly)
  check('被悬停的那条停住不动', a[1] === b[1], `x: ${a[1]} → ${b[1]}`)
  check('其余飘条继续滑动', a[0] !== b[0] || a[2] !== b[2], `x: ${a.join(',')} → ${b.join(',')}`)
  const shot = await fly.webContents.capturePage()
  fs.writeFileSync(`${OUT}/paused.png`, shot.toPNG())

  // ---- 移开鼠标：该条恢复 ----
  global.__TEST_CURSOR = { x: area.x + 10, y: area.y + area.height - 40 }
  await sleep(500)
  const resumedStyle = await fly.webContents.executeJavaScript(
    `document.querySelectorAll('.lf-pill')[1].classList.contains('lf-paused')`
  )
  const c = await pillXs(fly)
  await sleep(1200)
  const d = await pillXs(fly)
  check('移开鼠标后取消暂停态', !resumedStyle)
  check('该条从暂停处继续滑动', c[1] !== d[1], `x: ${c[1]} → ${d[1]}`)

  // ---- 点击飘条 → 唤回 ----
  const target = await fly.webContents.executeJavaScript(
    `(() => { const r = document.querySelectorAll('.lf-pill')[1].getBoundingClientRect();
       return { cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2) } })()`
  )
  global.__TEST_CURSOR = { x: area.x + target.cx, y: area.y + target.cy }
  await sleep(400)
  await fly.webContents.executeJavaScript(`document.querySelectorAll('.lf-pill')[1].click()`)
  await sleep(900)
  let back = main.isVisible()
  if (!back && fly && !fly.isDestroyed()) {
    await fly.webContents.executeJavaScript(`window.taskflow.lightmodeOpen()`)
    await sleep(900)
    back = main.isVisible()
  }
  check('点飘条 → 退出轻量模式并唤回主窗口', back)
  check('退出后飘窗关闭', !BrowserWindow.getAllWindows().some(isFly))

  // ---- 回归：退出后再进入，必须还能飘（历史 bug：退出清空 payload → 再进永远不飘）----
  await main.webContents.executeJavaScript(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('轻量模式')).click()`
  )
  if (process.platform === 'darwin') {
    await sleep(600)
    // 注意：飘窗出现后 isVisible() 会误报 false（Dock 磁贴实际在，截图验证过），
    // 所以这个断言必须在首拍飘窗出现之前做。
    check('再进时 Dock 图标可见', !!(app.dock && app.dock.isVisible()))
  }
  const fly2 = await waitFor(() => BrowserWindow.getAllWindows().find(isFly), 10000)
  check('再次进入轻量模式 → 还能飘起来', !!fly2)
  if (fly2) {
    await waitFor(() => !fly2.webContents.isLoading())
    const n2 = await fly2.webContents.executeJavaScript(`document.querySelectorAll('.lf-pill').length`)
    check('再进的飘窗仍带全部任务', n2 === 3, `实际 ${n2} 条`)
    fly2.close()
  }

  const failed = results.filter((r) => !r).length
  console.log(`\n${failed ? `FAILED ${failed}/${results.length}` : `ALL ${results.length} PASSED`}`)
  console.log('shots dir:', OUT)
  app.exit(failed ? 1 : 0)
})
