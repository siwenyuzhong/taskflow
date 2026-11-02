'use strict'
/**
 * 端到端验收：直接跑 **打包后的 Sloth.app**（asar 内的真实主进程 + 渲染层），
 * 验证用户报的两个问题：
 *   1) 点轻量模式后 Dock 图标在（macOS）
 *   2) 「今天/已过期/即将过期」的任务真的从桌面最上方飘过（真实屏幕像素级检测）
 *
 * 用 SLOTH_LIGHT_FIRST_FLY_MS 把首拍压到 2s；并写入一份临时数据，
 * 保证「已过期 / 今天到期」两条任务一定命中提醒条件。
 * 运行：npx electron smoke-packed-fly.cjs
 */
const { app, BrowserWindow, screen, nativeImage } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execSync } = require('node:child_process')

const OUT = '/tmp/taskflow-packed-fly'
const USERDATA = path.join(os.tmpdir(), 'taskflow-packed-fly-userdata')
const APP = path.join(__dirname, 'release/mac-arm64/Sloth.app')

// —— 必须在 require 打包版主进程之前准备 ——
fs.rmSync(USERDATA, { recursive: true, force: true })
fs.mkdirSync(USERDATA, { recursive: true })
fs.mkdirSync(OUT, { recursive: true })
app.setPath('userData', USERDATA)

const now = Date.now()
const mkTask = (id, title, dueAt, status, extra = {}) => ({
  id,
  title,
  note: '',
  categoryId: 'work',
  priority: 'high',
  durationMin: 60,
  createdAt: now - 3600_000,
  cycleStartAt: now - 3600_000,
  dueAt,
  renewCount: 0,
  remindLeadMin: 10,
  status,
  completedAt: null,
  remindedAt: null,
  expiredNotifiedAt: null,
  trashedAt: null,
  ...extra,
})
fs.writeFileSync(
  path.join(USERDATA, 'taskflow-data.json'),
  JSON.stringify(
    {
      version: 1,
      tasks: [
        mkTask('t-overdue', '打包验收·已过期任务', now - 40 * 60_000, 'active', {
          expiredNotifiedAt: now - 30 * 60_000,
        }),
        mkTask('t-today', '打包验收·今天到期任务', now + 3 * 3600_000, 'active'),
        mkTask('t-soon', '打包验收·即将过期任务', now + 4 * 60_000, 'active'),
        mkTask('t-done', '打包验收·已完成任务', now - 60_000, 'completed', { completedAt: now }),
      ],
      categories: [{ id: 'work', name: '工作', color: '#7c5cff', builtin: true }],
      prefs: { theme: 'dark', sound: false, nativeNotify: false, defaultDurationMin: 60, defaultRemindLeadMin: 10 },
      habits: [],
      notes: [],
      sheets: [],
      activeSheetId: null,
    },
    null,
    2
  )
)

process.env.SLOTH_LIGHT_FIRST_FLY_MS = '2000'
// 让打包版进程内的主进程读到源码依赖（asar 内已含 dist/electron，无需额外处理）
require(path.join(APP, 'Contents/Resources/app.asar/electron/main.cjs'))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const isFly = (w) => !w.isDestroyed() && w.webContents.getURL().includes('#lightfly')
const results = []
const check = (n, ok, extra = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? ` — ${extra}` : ''}`)
}

/** 屏幕顶部横条的深色像素带（药丸本体）。返回 [min,max] */
function screenDarkBand(area) {
  execSync(`screencapture -x -R 0,${area.y},${area.width},72 ${OUT}/row.png`, { stdio: 'ignore' })
  const img = nativeImage.createFromPath(`${OUT}/row.png`)
  const s = img.getSize()
  const b = img.toBitmap()
  const y = Math.floor(s.height / 2)
  let min = -1
  let max = -1
  for (let x = 0; x < s.width; x += 1) {
    const i = (y * s.width + x) * 4
    if (b[i] < 45 && b[i + 1] < 45 && b[i + 2] < 75 && b[i + 3] > 10) {
      if (min < 0) min = x
      max = x
    }
  }
  return [min, max]
}

app.whenReady().then(async () => {
  const area = screen.getPrimaryDisplay().workArea
  let main = null
  for (let i = 0; i < 120 && !main; i += 1) {
    main = BrowserWindow.getAllWindows().find(
      (w) => !isFly(w) && w.webContents.getURL().includes('index.html') && !w.webContents.isLoading()
    )
    if (!main) await sleep(200)
  }
  if (!main) {
    console.log('FAIL 打包版主窗口未加载')
    app.exit(1)
    return
  }
  await sleep(1500)

  // 1) 按钮 + 点击
  const hasBtn = await main.webContents.executeJavaScript(
    `!![...document.querySelectorAll('button')].find((b) => b.textContent.includes('轻量模式'))`
  )
  check('打包版顶栏有「轻量模式」按钮', hasBtn)
  await main.webContents.executeJavaScript(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('轻量模式')).click()`
  )
  await sleep(600)
  check('点击后主窗口收起', !main.isVisible())
  check('macOS Dock 图标可见（问题 1）', process.platform !== 'darwin' || app.dock.isVisible())

  // 2) 等飘窗，并用真实屏幕像素确认它飘出来了（问题 2）
  const fly = await (async () => {
    for (let i = 0; i < 150; i += 1) {
      const w = BrowserWindow.getAllWindows().find(isFly)
      if (w) return w
      await sleep(150)
    }
    return null
  })()
  check('飘窗已创建', !!fly)
  if (fly) {
    check('飘窗在屏幕上可见', fly.isVisible())
    const text = await fly.webContents
      .executeJavaScript(
        `(() => { const p=document.querySelector('.lf-pill'); return p ? p.textContent : '' })()`
      )
      .catch(() => '')
    check(
      '飘条包含今日/已过期任务标题',
      text.includes('打包验收·已过期任务') || text.includes('打包验收·今天到期任务'),
      text
    )
    // 采样 6 秒：屏幕顶部应出现药丸，并且位置自右向左移动
    let seen = false
    let prevX = null
    let movedLeft = false
    for (let i = 0; i < 12; i += 1) {
      const [min, max] = screenDarkBand(area)
      if (min >= 0) {
        seen = true
        if (prevX !== null && min < prevX) movedLeft = true
        prevX = min
      }
      await sleep(500)
    }
    check('真实屏幕顶部出现飘过的提醒条', seen)
    check('提醒条自右向左移动', movedLeft, `left edge 递减=${movedLeft}`)

    // 3) 点飘条 → 回来
    const rect = await fly.webContents.executeJavaScript(
      `(() => { const p=document.querySelector('.lf-pill'); const r=p.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } })()`
    )
    console.log('飘条矩形（窗口坐标）=', JSON.stringify(rect))
    execSync(
      `osascript -e 'tell application "System Events" to click at {${Math.max(rect.x + Math.round(rect.w / 2), 1)}, ${area.y + 36}}'`,
      { stdio: 'ignore' }
    ).toString?.()
    await sleep(1200)
    check('点击飘条后主窗口唤回', main.isVisible())
    check('退出轻量模式后飘窗关闭', !BrowserWindow.getAllWindows().some(isFly))
  }

  const failed = results.filter((r) => !r).length
  console.log(`\n${failed ? `FAILED ${failed}/${results.length}` : `ALL ${results.length} PASSED`}`)
  app.exit(failed ? 1 : 0)
})
