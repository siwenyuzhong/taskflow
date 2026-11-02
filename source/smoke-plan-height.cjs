'use strict'
/**
 * 未来计划 · 创建面板高度冒烟测试
 * 场景：
 *  1) 在日历靠下的日期上右键打开面板（低位触发）
 *  2) 连续回车创建 9 个计划（「本次已添加」列表不断增长）
 *  3) 每一步断言：面板完整落在视口内、底部按钮可见
 *  4) 关闭后从「给这一天加计划」按钮（页面下方）再次触发
 */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')

const OUT = '/tmp/taskflow-plan-height'
const FILE = process.env.SMOKE_FILE || '/tmp/taskflow-app/dist/index.html'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const MIN = 60_000

const seed = () => {
  const now = Date.now()
  const mk = (o) => ({
    id: o.id,
    title: o.title,
    note: '',
    categoryId: o.categoryId || 'work',
    priority: o.priority || 'medium',
    durationMin: 240,
    createdAt: now - 60 * MIN,
    cycleStartAt: now - 60 * MIN,
    dueAt: o.dueAt === undefined ? now + 180 * MIN : o.dueAt,
    renewCount: 0,
    remindLeadMin: 10,
    status: 'active',
    completedAt: null,
    remindedAt: null,
    expiredNotifiedAt: null,
    planned: !!o.planned,
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
      mk({ id: 't-a', title: '正在进行的任务', dueAt: now + 120 * MIN }),
      mk({ id: 't-b', title: '待办计划', planned: true, dueAt: now + 2 * 24 * 60 * MIN }),
    ],
  }
}

app.whenReady().then(async () => {
  fs.rmSync(OUT, { recursive: true, force: true })
  fs.mkdirSync(OUT, { recursive: true })

  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    show: false,
    backgroundColor: '#07070e',
    webPreferences: { offscreen: false, contextIsolation: true },
  })

  const errors = []
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2 && !/React DevTools/.test(message)) errors.push(`[console:${level}] ${message}`)
  })

  const js = (code) => win.webContents.executeJavaScript(code)
  const shot = async (name) => {
    const img = await win.webContents.capturePage()
    fs.writeFileSync(`${OUT}/${name}.png`, img.toPNG())
    console.log(`shot -> ${name}.png`)
  }
  const typeInto = (selector, text) => `(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return false
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(el, ${JSON.stringify(text)})
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`
  const pressEnter = (selector) => `(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return false
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    return true
  })()`

  const PANEL = '[role="dialog"][aria-label="添加计划任务"]'
  const PROBE = `(() => {
    const p = document.querySelector(${JSON.stringify(PANEL)})
    if (!p) return { error: 'panel missing' }
    const r = p.getBoundingClientRect()
    const scroller = p.querySelector('.overflow-y-auto')
    const addBtn = [...p.querySelectorAll('button')].find(b => b.textContent.includes('添加'))
    const ar = addBtn ? addBtn.getBoundingClientRect() : null
    const chips = p.querySelectorAll('li').length
    return {
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      height: Math.round(r.height),
      innerH: window.innerHeight,
      topFits: r.top >= -0.5,
      bottomFits: r.bottom <= window.innerHeight + 0.5,
      addBtnVisible: ar ? ar.bottom <= window.innerHeight + 0.5 && ar.top >= -0.5 : null,
      maxHeight: p.style.maxHeight,
      scrollerClips: scroller ? scroller.scrollHeight > scroller.clientHeight + 1 : null,
      scrollPos: scroller ? scroller.scrollTop + '/' + (scroller.scrollHeight - scroller.clientHeight) : null,
      rows: chips,
    }
  })()`

  await win.loadFile(FILE)
  await sleep(800)
  win.show()
  await sleep(1200)
  console.log('viewport:', JSON.stringify(await js(`({ w: window.innerWidth, h: window.innerHeight })`)))

  await js(`(() => {
    const orig = localStorage.setItem.bind(localStorage)
    localStorage.setItem = (k, v) => { if (k !== 'taskflow-data') orig(k, v) }
    orig('taskflow-data', ${JSON.stringify(JSON.stringify(seed()))})
    return true
  })()`)
  await win.webContents.reload()
  await sleep(3000)

  // 进入未来计划
  await js(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().startsWith('未来计划'))
    if (b) b.click()
    return !!b
  })()`)
  await sleep(1200)

  const failed = []
  const check = async (label) => {
    const info = await js(PROBE)
    const ok = !info.error && info.topFits && info.bottomFits && info.addBtnVisible
    if (!ok) failed.push(label + ' -> ' + JSON.stringify(info))
    console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}:`, JSON.stringify(info))
    return info
  }

  // 1) 低位右键：选日历最后一行（第 6 行）的日期
  const cellInfo = await js(`(() => {
    const cells = [...document.querySelectorAll('[role="gridcell"]')]
    const target = cells[38]
    const r = target.getBoundingClientRect()
    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.bottom - 6 }))
    return { n: cells.length, label: target.getAttribute('aria-label'), cellBottom: Math.round(r.bottom), innerH: window.innerHeight }
  })()`)
  await sleep(700)
  console.log('trigger low-row contextmenu:', JSON.stringify(cellInfo))
  await check('打开面板（日历底部行）')
  await shot('1-open-low-row')

  // 2) 连续创建 9 个
  const INPUT = 'input[placeholder="计划做什么？回车添加"]'
  for (let i = 1; i <= 9; i++) {
    await js(typeInto(INPUT, `计划条目 ${i}`))
    await sleep(160)
    await js(pressEnter(INPUT))
    await sleep(320)
    await check(`已添加 ${i} 个`)
    if (i === 5) await shot('2-added-5')
  }
  await shot('3-added-9')

  // 3) 关闭再从页面下方的「给这一天加计划」重新打开
  await js(`(() => {
    const btn = [...document.querySelectorAll(${JSON.stringify(PANEL)} + ' button')].find(b => /完成|取消/.test(b.textContent.trim()))
    if (btn) btn.click()
    return !!btn
  })()`)
  await sleep(900)
  await js(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().startsWith('给这一天加计划'))
    if (b) { b.click(); return true }
    return false
  })()`)
  await sleep(700)
  await check('从「给这一天加计划」重新打开')
  await shot('4-reopen-from-button')

  // 4) 极小窗口下的极限验证
  win.setSize(1024, 600)
  await sleep(800)
  await check('窗口缩小到 1024x600')
  await shot('5-small-window')

  console.log(failed.length ? 'FAILED:\n' + failed.join('\n') : 'ALL_LAYOUT_CHECKS_PASSED')
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO_CONSOLE_ERRORS')
  app.exit(failed.length || errors.length ? 1 : 0)
})
