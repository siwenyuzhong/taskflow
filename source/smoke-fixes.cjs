'use strict'
/**
 * 冒烟测试（第二版）：
 *  A) Toast 自动消失时长 + 悬停暂停（React 的 onMouseEnter/Leave 需用 mouseover/mouseout + relatedTarget 派发）
 *  B) 未来计划：点日历里的任务芯片可直接打开详情；「+N 个」可点开当天列表
 *  C) 点任务卡片标题可打开详情
 */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')

const OUT = '/tmp/taskflow-smoke-v2'
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
      mk({ id: 't-run', title: '正在进行的任务', dueAt: now + 120 * MIN }),
      mk({ id: 'p1', title: '整理季度 OKR', planned: true, dueAt: now + 26 * 60 * MIN }),
      mk({ id: 'p2', title: '和设计过一轮视觉稿', planned: true, dueAt: now + 26 * 60 * MIN + 60_000 }),
      mk({ id: 'p3', title: '写周四的分享稿', planned: true, dueAt: now + 26 * 60 * MIN + 120_000 }),
    ],
  }
}

app.whenReady().then(async () => {
  fs.rmSync(OUT, { recursive: true, force: true })
  fs.mkdirSync(OUT, { recursive: true })

  const win = new BrowserWindow({
    width: 1360,
    height: 820,
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
  }

  await win.loadFile(FILE)
  await sleep(800)
  win.show()
  await sleep(1200)
  await js(`(() => {
    const orig = localStorage.setItem.bind(localStorage)
    localStorage.setItem = (k, v) => { if (k !== 'taskflow-data') orig(k, v) }
    orig('taskflow-data', ${JSON.stringify(JSON.stringify(seed()))})
    return true
  })()`)
  await win.webContents.reload()
  await sleep(3200)

  const passed = []
  const failed = []
  const assert = (label, ok, detail) => {
    ;(ok ? passed : failed).push(label + (detail ? ' :: ' + detail : ''))
    console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ' :: ' + detail : ''}`)
  }

  const toastState = () =>
    js(`(() => {
      const s = document.querySelector('[role="status"]')
      const item = s && s.firstElementChild
      if (!item) return { visible: false }
      const r = item.getBoundingClientRect()
      return { visible: true, text: item.innerText.replace(/\\n/g, ' ').slice(0, 40), opacity: getComputedStyle(item).opacity, top: Math.round(r.top) }
    })()`)

  const hoverToast = (type) =>
    js(`(() => {
      const s = document.querySelector('[role="status"]')
      const item = s && s.firstElementChild
      if (!item) return { ok: false }
      item.dispatchEvent(new MouseEvent(${JSON.stringify(type)}, { bubbles: true, relatedTarget: document.body }))
      return { ok: true, text: item.innerText.replace(/\\n/g, ' ').slice(0, 40) }
    })()`)

  /** 用真实鼠标事件移动指针，触发浏览器原生的 mouseenter / mouseleave */
  const moveMouseTo = async (target) => {
    const box = await js(`(() => {
      const s = document.querySelector('[role="status"]')
      const item = s && s.firstElementChild
      if (!item) return null
      const r = item.getBoundingClientRect()
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
    })()`)
    if (!box) return null
    const p = target === 'toast' ? box : { x: 40, y: 40 }
    win.webContents.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y })
    return p
  }

  // ================================================================ A) Toast 悬停暂停 + 自动消失
  await js(`(() => {
    const b = document.querySelector('[data-task-id] button[aria-label="标记完成"]')
    if (b) b.click()
    return !!b
  })()`)
  await sleep(500)
  const appeared = await toastState()
  assert('完成任务后出现提示', appeared.visible, JSON.stringify(appeared))

  const hovered = await moveMouseTo('toast')
  await sleep(6200) // 远超 ttl(3.5s)
  const held = await toastState()
  assert('悬停时提示被暂停（6 秒后仍在）', held.visible, JSON.stringify({ hovered, held }))
  await shot('1-toast-held')

  const movedAway = await moveMouseTo('away')
  // 暂停期间不消耗时长，移开后按剩余时长(~3s)继续，故需等足
  await sleep(4200)
  const released = await toastState()
  assert('移开鼠标后提示自动消失', !released.visible, JSON.stringify({ movedAway, released }))

  // 常规自动消失：删除任务 → 带「撤销删除」按钮，ttl 4.5s
  await js(`(() => {
    const card = document.querySelector('[data-task-id="t-run"]') || document.querySelector('[data-task-id]')
    const btn = card && card.querySelector('button[aria-label="更多操作"]')
    if (btn) btn.click()
    return !!btn
  })()`)
  await sleep(500)
  await js(`(() => {
    const del = [...document.querySelectorAll('[role="menuitem"]')].find(i => i.textContent.includes('删除任务'))
    if (del) del.click()
    return !!del
  })()`)
  await sleep(400)
  const delToast = await toastState()
  assert('删除后出现提示（含撤销按钮）', delToast.visible, JSON.stringify(delToast))
  await sleep(5400)
  const delGone = await toastState()
  assert('带操作按钮的提示 5.5 秒内自动消失', !delGone.visible, JSON.stringify(delGone))
  await shot('2-toast-gone')

  // ================================================================ C) 点卡片标题打开详情
  const cardClick = await js(`(() => {
    const card = document.querySelector('[data-task-id]')
    if (!card) return { error: 'card missing' }
    const h3 = card.querySelector('h3')
    const title = h3.textContent
    const r = h3.getBoundingClientRect()
    h3.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5 }))
    return { title }
  })()`)
  await sleep(800)
  const detailOpen = await js(`(() => {
    const dlg = [...document.querySelectorAll('[role="dialog"]')]
    const box = dlg.find(d => d.querySelector('input, textarea'))
    const val = box ? (box.querySelector('input[type="text"], input:not([type])')?.value ?? '') : ''
    return { count: dlg.length, titleValue: val }
  })()`)
  assert('点任务卡片标题打开详情', !!detailOpen.titleValue && detailOpen.titleValue === cardClick.title, JSON.stringify({ cardClick, detailOpen }))
  await shot('3-card-click-detail')
  await js(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true })()`)
  await sleep(700)

  // ================================================================ B) 未来计划日历交互
  await js(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().startsWith('未来计划'))
    if (b) b.click()
    return !!b
  })()`)
  await sleep(1500)
  await shot('4-plan-view')

  const chipInfo = await js(`(() => {
    const cells = [...document.querySelectorAll('[role="gridcell"]')]
    for (const c of cells) {
      const chip = [...c.querySelectorAll('button')].find(b => b.textContent.includes('整理季度 OKR'))
      if (chip) return { found: true, aria: chip.getAttribute('aria-label'), title: chip.getAttribute('title'), cell: c.getAttribute('aria-label'), buttons: [...c.querySelectorAll('button')].map(b => b.textContent.trim()) }
    }
    return { found: false, all: [...document.querySelectorAll('[role="gridcell"] button')].map(b => b.textContent.trim()).filter(Boolean) }
  })()`)
  assert('日历上出现可点击的任务芯片', chipInfo.found, JSON.stringify(chipInfo))

  await js(`(() => {
    const cells = [...document.querySelectorAll('[role="gridcell"]')]
    for (const c of cells) {
      const chip = [...c.querySelectorAll('button')].find(b => b.textContent.includes('整理季度 OKR'))
      if (chip) { chip.click(); return true }
    }
    return false
  })()`)
  await sleep(900)
  const chipDetail = await js(`(() => {
    const dlg = [...document.querySelectorAll('[role="dialog"]')]
    const box = dlg.find(d => d.querySelector('input, textarea'))
    const val = box ? (box.querySelector('input[type="text"], input:not([type])')?.value ?? '') : ''
    return { count: dlg.length, titleValue: val }
  })()`)
  assert('点日历芯片打开该任务详情', chipDetail.titleValue.includes('整理季度 OKR'), JSON.stringify(chipDetail))
  await shot('5-chip-opened-detail')
  await js(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true })()`)
  await sleep(800)

  // 「+N 个」按钮：3 个任务 → 显示 2 个 chip + 「+1 个」
  const moreInfo = await js(`(() => {
    const cells = [...document.querySelectorAll('[role="gridcell"]')]
    for (const c of cells) {
      const btns = [...c.querySelectorAll('button')]
      const more = btns.find(b => /\\+\\s*\\d+\\s*个/.test(b.textContent))
      if (more) {
        const before = document.querySelector('#plan-day-list') ? 'list-exists' : 'no-list'
        more.click()
        return { clicked: true, label: more.textContent.trim(), before, cellButtons: btns.map(b => b.textContent.trim()) }
      }
    }
    return { clicked: false, scan: [...document.querySelectorAll('[role="gridcell"] button')].map(b => b.textContent.trim()).filter(Boolean) }
  })()`)
  await sleep(1200)
  const afterMore = await js(`(() => {
    const heads = [...document.querySelectorAll('h3')].map(h => h.textContent)
    const list = document.querySelector('#plan-day-list')
    return {
      listExists: !!list,
      listHasAll: heads.filter(t => /整理季度 OKR|和设计过一轮视觉稿|写周四的分享稿/.test(t)).length,
      headings: heads.slice(0, 8),
    }
  })()`)
  assert('「+N 个」可点击并跳到当天全部任务', moreInfo.clicked && afterMore.listHasAll >= 3, JSON.stringify({ moreInfo, afterMore }))
  await shot('6-plus-n-clicked')

  console.log('\n---- 汇总 ----')
  console.log('PASSED:', passed.length)
  passed.forEach((p) => console.log('  ✓ ' + p))
  if (failed.length) {
    console.log('FAILED:', failed.length)
    failed.forEach((f) => console.log('  ✗ ' + f))
  }
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO_CONSOLE_ERRORS')
  app.exit(failed.length || errors.length ? 1 : 0)
})
