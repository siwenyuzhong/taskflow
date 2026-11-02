'use strict'
/**
 * 新功能冒烟测试
 * A) 已完成任务：... 菜单必须可见（portal 不被卡片裁切）且可删除
 * B) 未来计划：右键日期 → 连续创建多个计划任务 → 日历与当天列表出现
 * C) 计划任务到点提醒：过期计划任务应触发「计划任务到点」提醒
 */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')

const OUT = '/tmp/taskflow-plan-smoke'
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
    durationMin: o.durationMin === undefined ? 240 : o.durationMin,
    createdAt: now - 60 * MIN,
    cycleStartAt: now - 60 * MIN,
    dueAt: o.dueAt === undefined ? now + 180 * MIN : o.dueAt,
    renewCount: 0,
    remindLeadMin: 10,
    status: o.status || 'active',
    completedAt: o.completedAt || null,
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
      mk({ id: 't-done', title: '已完成的历史任务', status: 'completed', completedAt: now - 30 * MIN, durationMin: null, dueAt: null }),
      mk({ id: 't-late-plan', title: '昨天该做的计划', planned: true, dueAt: now - 20 * MIN }),
      mk({ id: 't-run', title: '正在进行的任务', dueAt: now + 120 * MIN }),
    ],
  }
}

app.whenReady().then(async () => {
  fs.rmSync(OUT, { recursive: true, force: true })
  fs.mkdirSync(OUT, { recursive: true })

  const win = new BrowserWindow({
    width: 1440,
    height: 940,
    show: false,
    backgroundColor: '#07070e',
    webPreferences: { offscreen: false, contextIsolation: true },
  })

  const errors = []
  win.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) errors.push(`[console:${level}] ${message} (${source}:${line})`)
  })
  win.webContents.on('render-process-gone', (_e, d) => errors.push(`[gone] ${d.reason}`))

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

  await win.loadFile(FILE)
  await sleep(800)
  // 隐藏窗口的 innerHeight 与真实尺寸不一致，会让定位断言失真；显示窗口再测
  win.show()
  await sleep(1200)
  console.log('viewport:', JSON.stringify(await js(`({ w: window.innerWidth, h: window.innerHeight })`)))
  // 应用在 beforeunload 时会回写状态，先把写入口临时屏蔽，避免种子数据被覆盖
  await js(`(() => {
    const orig = localStorage.setItem.bind(localStorage)
    window.__origSetItem = orig
    localStorage.setItem = (k, v) => { if (k !== 'taskflow-data') orig(k, v) }
    orig('taskflow-data', ${JSON.stringify(JSON.stringify(seed()))})
    return localStorage.getItem('taskflow-data') ? 'seeded' : 'failed'
  })()`)
  await win.webContents.reload()
  await sleep(3200)

  // ---------------------------------------------------------------- C) 到点提醒
  const remind = await js(`(() => {
    const t = document.body.innerText
    return { hasPlannedDue: t.includes('计划任务到点'), hasTitle: t.includes('昨天该做的计划') }
  })()`)
  console.log('planned reminder:', JSON.stringify(remind))
  await shot('1-planned-reminder')

  // 关闭 toast，避免遮挡（点 toast 上的关闭按钮）
  await js(`(() => {
    document.querySelectorAll('button[aria-label="关闭"]').forEach(b => { try { b.click() } catch {} })
    return true
  })()`)
  await sleep(400)

  // ---------------------------------------------------------------- A) 已完成任务删除
  await js(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().startsWith('已完成'))
    if (b) b.click()
    return !!b
  })()`)
  await sleep(1000)
  await shot('2-done-view')

  const PROBE = `(() => {
    const card = document.querySelector('[data-task-id="t-done"]')
    const btn = card && card.querySelector('button[aria-label="更多操作"]')
    const menu = document.querySelector('[role="menu"][aria-label="任务操作"]')
    const main = document.querySelector('main')
    const r = btn ? btn.getBoundingClientRect() : null
    return {
      t: Math.round(performance.now()),
      btnTop: r ? Math.round(r.top) : null,
      btnBottom: r ? Math.round(r.bottom) : null,
      menuTop: menu ? Math.round(menu.getBoundingClientRect().top) : null,
      menuH: menu ? Math.round(menu.getBoundingClientRect().height) : null,
      inlineTop: menu ? menu.style.top : null,
      innerH: window.innerHeight,
      mainScrollTop: main ? main.scrollTop : null,
      winScrollY: window.scrollY,
    }
  })()`
  await js(`(() => { const c = document.querySelector('[data-task-id="t-done"]'); const b = c && c.querySelector('button[aria-label="更多操作"]'); if (b) b.click(); return true })()`)
  for (const w of [0, 60, 200, 500]) {
    await sleep(w)
    console.log(`menu probe +${w}ms:`, JSON.stringify(await js(PROBE)))
  }
  await shot('3-done-menu-open')

  const menuInfo = await js(`(() => {
    const menu = document.querySelector('[role="menu"][aria-label="任务操作"]')
    if (!menu) return { error: 'menu not rendered' }
    const r = menu.getBoundingClientRect()
    const items = [...menu.querySelectorAll('[role="menuitem"]')].map(i => i.textContent.trim())
    const del = [...menu.querySelectorAll('[role="menuitem"]')].find(i => i.textContent.includes('删除任务'))
    const dr = del ? del.getBoundingClientRect() : null
    const inViewport = r.top >= 0 && r.bottom <= window.innerHeight + 1 && r.left >= 0 && r.right <= window.innerWidth + 1
    const parent = menu.parentElement === document.body ? 'body(portal)' : 'in-card'
    const hit = dr ? document.elementFromPoint(dr.left + dr.width / 2, dr.top + dr.height / 2) : null
    return {
      items,
      parent,
      delRect: dr ? { top: Math.round(dr.top), bottom: Math.round(dr.bottom) } : null,
      hitDesc: hit ? hit.tagName + '.' + String(hit.className || '').slice(0, 60) : null,
      hitSection: hit && hit.closest('section') ? String(hit.closest('section').className).slice(0, 80) : null,
      menuZ: getComputedStyle(menu).zIndex,
      menuPE: getComputedStyle(menu).pointerEvents,
      menuOpacity: getComputedStyle(menu).opacity,
      menuAnims: menu.getAnimations ? menu.getAnimations().map(a => a.animationName + ':' + a.playState).join(',') : 'n/a',
      hitChain: (() => { let el = hit; const out = []; while (el && out.length < 6) { out.push(el.tagName + (el.className ? '.' + String(el.className).slice(0, 30) : '')); el = el.parentElement } return out.join(' > ') })(),
      stackAtDelete: (() => {
        const dr2 = del.getBoundingClientRect()
        const stack = document.elementsFromPoint(dr2.left + dr2.width / 2, dr2.top + dr2.height / 2)
        return stack.slice(0, 8).map(e => e.tagName + (e.getAttribute('role') ? '[' + e.getAttribute('role') + ']' : '') + (e.className ? '.' + String(e.className).slice(0, 25) : ''))
      })(),
      hitInsideDelete: !!(hit && del && (hit === del || del.contains(hit))),
      viewport: { w: window.innerWidth, h: window.innerHeight },
      btnRect: (() => { const b = document.querySelector('[data-task-id] button[aria-label="更多操作"]'); const r = b.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom) } })(),
      transform: getComputedStyle(menu).transform,
      inline: { top: menu.style.top, left: menu.style.left, position: menu.style.position, cssPosition: getComputedStyle(menu).position },
      menuRect: { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) },
      inViewport,
      deleteHit: !!(hit && del && (hit === del || del.contains(hit))),
    }
  })()`)
  console.log('done-task menu:', JSON.stringify(menuInfo))

  // 突变实验：找出菜单不参与命中的原因
  const exp = await js(`(() => {
    const menu = document.querySelector('[role="menu"][aria-label="任务操作"]')
    const del = [...menu.querySelectorAll('[role="menuitem"]')].find(i => i.textContent.includes('删除任务'))
    const dr = del.getBoundingClientRect()
    const x = dr.left + dr.width / 2, y = dr.top + dr.height / 2
    const probe = () => (document.elementsFromPoint(x, y)[0] || {}).tagName
    const out = { base: probe() }
    menu.style.zIndex = '999'
    out.z999 = probe()
    menu.style.zIndex = ''
    menu.style.backdropFilter = 'none'
    out.noBackdrop = probe()
    menu.style.backdropFilter = ''
    menu.style.position = 'fixed'
    menu.style.top = dr.top + 'px'
    menu.style.left = dr.left + 'px'
    out.fixed = probe()
    menu.style.position = ''
    menu.style.top = ''
    menu.style.left = ''
    // 检查所有祖先的 overflow 与 clip
    out.ancestors = []
    let el = menu.parentElement
    while (el && el !== document.body) {
      const cs = getComputedStyle(el)
      out.ancestors.push((el.tagName + '.' + String(el.className).slice(0, 24)) + ' ov=' + cs.overflow + '/' + cs.overflowX + '/' + cs.overflowY + ' clip=' + cs.clipPath + ' contain=' + cs.contain)
      el = el.parentElement
    }
    return out
  })()`)
  console.log('experiment:', JSON.stringify(exp, null, 1))

  const deleted = await js(`(() => {
    const del = [...document.querySelectorAll('[role="menuitem"]')].find(i => i.textContent.includes('删除任务'))
    if (!del) return { ok: false, reason: 'no delete item' }
    del.click()
    return { ok: true }
  })()`)
  await sleep(900)
  const afterDelete = await js(`(() => ({
    cardGone: !document.querySelector('[data-task-id="t-done"]'),
    body: document.body.innerText.includes('已完成的历史任务'),
  }))()`)
  console.log('delete result:', JSON.stringify({ ...deleted, ...afterDelete }))
  await shot('4-after-delete')

  // ---------------------------------------------------------------- B) 未来计划
  await js(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().startsWith('未来计划'))
    if (b) b.click()
    return !!b
  })()`)
  await sleep(1200)
  await shot('5-plan-view')

  const cellInfo = await js(`(() => {
    const cells = [...document.querySelectorAll('[role="gridcell"]')]
    // 选一个本月、且不是今天的日期（第 4 行第 3 列附近）
    const target = cells[24]
    const r = target.getBoundingClientRect()
    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 30, clientY: r.top + 30 }))
    return { cells: cells.length, label: target.getAttribute('aria-label') }
  })()`)
  await sleep(700)
  console.log('calendar:', JSON.stringify(cellInfo))
  await shot('6-plan-composer')

  const INPUT = 'input[placeholder="计划做什么？回车添加"]'
  await js(typeInto(INPUT, '整理季度 OKR'))
  await sleep(250)
  await js(pressEnter(INPUT))
  await sleep(500)
  await js(typeInto(INPUT, '和设计过一轮视觉稿'))
  await sleep(250)
  await js(pressEnter(INPUT))
  await sleep(500)
  await js(typeInto(INPUT, '写周四的分享稿'))
  await sleep(250)
  await js(pressEnter(INPUT))
  await sleep(800)

  const added = await js(`(() => {
    const panel = document.querySelector('[role="dialog"][aria-label="添加计划任务"]')
    const txt = panel ? panel.innerText : ''
    const m = txt.match(/本次已添加 (\\d+) 个/)
    return { listed: m ? Number(m[1]) : 0, hasHint: txt.includes('本次已添加'), panelText: txt.replace(/\\n/g, ' | ').slice(0, 160) }
  })()`)
  console.log('composer added:', JSON.stringify(added))
  await shot('7-composer-multi')

  await js(`(() => {
    const btn = [...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.trim() === '完成')
    if (btn) btn.click()
    return !!btn
  })()`)
  await sleep(1200)
  await shot('8-plan-created')

  const planState = await js(`(() => {
    const cells = [...document.querySelectorAll('[role="gridcell"]')]
    const withChips = cells.filter(c => c.innerText.includes('整理季度 OKR'))
    const body = document.body.innerText
    return {
      cellHasTask: withChips.length,
      dayListCount: (body.match(/3 个任务/) || []).length > 0,
      hasFirstTask: body.includes('整理季度 OKR'),
      hasThirdTask: body.includes('写周四的分享稿'),
      toastAdded: body.includes('已添加 3 个计划任务'),
    }
  })()`)
  console.log('plan state:', JSON.stringify(planState))

  // 到点提醒是否真的会为新任务触发：把其中一条改成已过期
  const lateCheck = await js(`(() => {
    const raw = JSON.parse(localStorage.getItem('taskflow-data') || '{}')
    if (!raw.tasks) return { error: 'no tasks in storage' }
    const t = raw.tasks.find(x => x.title === '整理季度 OKR')
    if (!t) return { error: 'not persisted yet' }
    return { persisted: true, planned: t.planned === true, dueAt: t.dueAt }
  })()`)
  console.log('persisted planned task:', JSON.stringify(lateCheck))

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO_CONSOLE_ERRORS')
  app.exit(0)
})
