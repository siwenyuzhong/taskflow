'use strict'
/**
 * 回收站冒烟测试
 *  1) 已完成任务「删除到回收站」→ 从已完成列表消失、进入回收站、不进常规视图
 *  2) 回收站内「彻底删除」→ 卡片碎成碎片飘散（data-shatter 层存在且原卡片隐形）→ 数据被真正移除
 *  3) 已完成视图「全部移入回收站」
 *  4) 回收站「清空回收站」二次确认
 *  5) 全程持久化正确（localStorage 里的任务真的少了一条）
 */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')

const OUT = '/tmp/taskflow-trash'
const FILE = process.env.SMOKE_FILE || '/tmp/taskflow-app/dist/index.html'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const MIN = 60_000

const seed = () => {
  const now = Date.now()
  const mk = (o) => ({
    id: o.id,
    title: o.title,
    note: o.note || '',
    categoryId: o.categoryId || 'work',
    priority: o.priority || 'medium',
    durationMin: 240,
    createdAt: now - 90 * MIN,
    cycleStartAt: now - 90 * MIN,
    dueAt: o.status === 'completed' ? now - 30 * MIN : now + 180 * MIN,
    renewCount: 0,
    remindLeadMin: 10,
    status: o.status || 'active',
    completedAt: o.status === 'completed' ? now - 20 * MIN : null,
    remindedAt: o.status === 'completed' ? now : null,
    expiredNotifiedAt: o.status === 'completed' ? now : null,
    planned: false,
    trashedAt: null,
  })
  return {
    version: 1,
    categories: [
      { id: 'work', name: '工作', color: '#7c5cff', builtin: true },
      { id: 'dev', name: '研发', color: '#2ee6d6', builtin: true },
    ],
    prefs: { theme: 'dark', sound: false, nativeNotify: false, defaultDurationMin: 240, defaultRemindLeadMin: 10 },
    tasks: [
      mk({ id: 'a1', title: '还在进行中的任务', categoryId: 'dev', priority: 'high' }),
      mk({ id: 'd1', title: '已完成的任务甲', status: 'completed' }),
      mk({ id: 'd2', title: '已完成的任务乙', status: 'completed', categoryId: 'dev' }),
      mk({ id: 'd3', title: '已完成的任务丙', status: 'completed' }),
    ],
  }
}

app.whenReady().then(async () => {
  fs.rmSync(OUT, { recursive: true, force: true })
  fs.mkdirSync(OUT, { recursive: true })

  const win = new BrowserWindow({
    width: 1360,
    height: 860,
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

  /** 点侧边栏视图（按钮文本含计数，用 startsWith 匹配） */
  const goView = async (label) => {
    const ok = await js(`(() => {
      const b = [...document.querySelectorAll('aside button')].find(x => x.textContent.trim().startsWith(${JSON.stringify(label)}))
      if (b) b.click()
      return !!b
    })()`)
    await sleep(700)
    return ok
  }

  const snapshot = () =>
    js(`(() => {
      const cards = [...document.querySelectorAll('[data-task-id]')]
      return {
        cards: cards.map(c => ({ id: c.dataset.taskId, trashed: c.dataset.trashed === '1', hidden: getComputedStyle(c).visibility === 'hidden', title: (c.querySelector('h3')||{}).textContent })),
        headings: [...document.querySelectorAll('h2, h3')].map(h => h.textContent).slice(0, 6),
        body: document.body.innerText.replace(/\\n/g, ' ').slice(0, 260),
      }
    })()`)

  const sidebarTrash = () =>
    js(`(() => {
      const b = [...document.querySelectorAll('aside button')].find(x => x.textContent.trim().startsWith('回收站'))
      return b ? b.textContent.trim() : null
    })()`)

  const persisted = () =>
    js(`(() => { const raw = localStorage.getItem('taskflow-data'); if (!raw) return null; const d = JSON.parse(raw); return d.tasks.map(t => ({ id: t.id, trashed: !!t.trashedAt })) })()`)

  // ============================================================ 1) 已完成 → 删除到回收站
  assert('侧边栏出现「回收站」入口', !!(await sidebarTrash()), await sidebarTrash())
  assert('侧边栏「回收站」在「已完成」下方', await js(`(() => {
    const btns = [...document.querySelectorAll('aside nav button')].map(b => b.textContent.trim())
    const iDone = btns.findIndex(t => t.startsWith('已完成'))
    const iTrash = btns.findIndex(t => t.startsWith('回收站'))
    return iTrash === iDone + 1 && iDone >= 0
  })()`))

  await goView('已完成')
  const doneBefore = await snapshot()
  assert('已完成视图里有 3 个已完成任务', doneBefore.cards.length === 3, JSON.stringify(doneBefore.cards.map(c => c.title)))
  await shot('1-done-view')

  // 打开「已完成的任务丙」的菜单 → 删除到回收站
  const menuOpened = await js(`(() => {
    const card = document.querySelector('[data-task-id="d3"]')
    const btn = card && card.querySelector('button[aria-label="更多操作"]')
    if (btn) btn.click()
    return !!btn
  })()`)
  await sleep(400)
  const labelHit = await js(`(() => {
    const items = [...document.querySelectorAll('[role="menuitem"]')].map(i => i.textContent.trim())
    const del = [...document.querySelectorAll('[role="menuitem"]')].find(i => i.textContent.includes('删除到回收站'))
    if (del) del.click()
    return { items, clicked: !!del }
  })()`)
  assert('已完成任务的菜单里有「删除到回收站」', menuOpened && labelHit.clicked, JSON.stringify(labelHit.items))
  await sleep(1200)
  await shot('2-after-soft-delete')

  const doneAfter = await snapshot()
  assert('删除后从已完成列表消失', !doneAfter.cards.some(c => c.id === 'd3'), JSON.stringify(doneAfter.cards.map(c => c.id)))

  // 全部任务视图里也不应该再出现
  await goView('全部任务')
  const allView = await snapshot()
  assert('常规视图里看不到已删除任务', !allView.cards.some(c => c.id === 'd3'), JSON.stringify(allView.cards.map(c => c.id)))

  // ============================================================ 2) 回收站里可见
  await goView('回收站')
  const trashView = await snapshot()
  assert(
    '回收站里出现该任务且带已删除标记',
    trashView.cards.length === 1 && trashView.cards[0].id === 'd3' && trashView.cards[0].trashed,
    JSON.stringify(trashView.cards)
  )
  assert('回收站有「彻底删除」按钮', await js(`(() => !!document.querySelector('[data-action="purge"]'))()`))
  await shot('3-trash-view')

  const persistedAfterTrash = await persisted()
  assert(
    '软删除已持久化（任务进入回收站而非被移除）',
    !!persistedAfterTrash && persistedAfterTrash.some(t => t.id === 'd3' && t.trashed),
    JSON.stringify(persistedAfterTrash)
  )

  // ============================================================ 3) 彻底删除 + 碎片飘散
  await js(`(() => { const b = document.querySelector('[data-action="purge"]'); if (b) b.click(); return !!b })()`)
  await sleep(140)
  const mid = await js(`(() => {
    const layer = document.querySelector('[data-shatter]')
    const card = document.querySelector('[data-task-id="d3"]')
    return {
      layer: !!layer,
      pieces: layer ? layer.children.length : 0,
      animated: layer ? [...layer.children].filter(t => /shatter-fly/.test(t.style.animation)).length : 0,
      cardHidden: card ? getComputedStyle(card).visibility === 'hidden' : null,
    }
  })()`)
  assert('点击彻底删除后生成碎片层并播放在场动画', mid.layer && mid.pieces >= 120 && mid.animated === mid.pieces, JSON.stringify(mid))
  assert('原卡片立即隐形（碎片接管视觉）', mid.cardHidden === true, JSON.stringify(mid))
  await shot('4-shatter-mid')

  await sleep(600)
  await shot('4b-shatter-mid2')
  await sleep(700)
  await shot('4c-shatter-late')

  await sleep(1700)
  const afterPurge = await js(`(() => ({
    layer: !!document.querySelector('[data-shatter]'),
    cards: [...document.querySelectorAll('[data-task-id]')].map(c => c.dataset.taskId),
    empty: document.body.innerText.includes('回收站是空的'),
  }))()`)
  assert('碎片层自动清理干净', !afterPurge.layer, JSON.stringify(afterPurge))
  assert('任务被真正移除且回收站显示空状态', afterPurge.cards.length === 0 && afterPurge.empty, JSON.stringify(afterPurge))
  await shot('5-trash-empty')

  const persistedAfterPurge = await persisted()
  assert(
    '永久删除已持久化（数据里不再有该任务）',
    !!persistedAfterPurge && !persistedAfterPurge.some(t => t.id === 'd3'),
    JSON.stringify(persistedAfterPurge)
  )

  // ============================================================ 4) 全部移入回收站
  await goView('已完成')
  const bulk = await js(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().includes('全部移入回收站'))
    if (b) b.click()
    return !!b
  })()`)
  await sleep(900)
  const afterBulk = await snapshot()
  assert('「全部移入回收站」把已完成任务全部移走', bulk && afterBulk.cards.length === 0, JSON.stringify(afterBulk.cards.map(c => c.id)))
  await goView('回收站')
  const trashTwo = await snapshot()
  assert('回收站里出现 2 个任务', trashTwo.cards.length === 2, JSON.stringify(trashTwo.cards.map(c => c.id)))
  await shot('6-bulk-moved')

  // ============================================================ 5) 清空回收站（二次确认）
  const firstClick = await js(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().startsWith('清空回收站'))
    if (b) b.click()
    return !!b
  })()`)
  await sleep(400)
  const armed = await js(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().startsWith('再点一次'))
    return { armed: !!b, label: b ? b.textContent.trim() : null, cards: [...document.querySelectorAll('[data-task-id]')].length }
  })()`)
  assert('清空回收站需二次确认（第一次不删）', firstClick && armed.armed && armed.cards === 2, JSON.stringify(armed))

  await js(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().startsWith('再点一次')); if (b) b.click(); return !!b })()`)
  await sleep(900)
  const emptied = await js(`(() => ({
    cards: [...document.querySelectorAll('[data-task-id]')].length,
    empty: document.body.innerText.includes('回收站是空的'),
    sidebar: (() => { const b = [...document.querySelectorAll('aside button')].find(x => x.textContent.trim().startsWith('回收站')); return b ? b.textContent.trim() : null })(),
  }))()`)
  assert('二次确认后回收站被清空', emptied.cards === 0 && emptied.empty && !/\d/.test(emptied.sidebar || ''), JSON.stringify(emptied))
  await shot('7-emptied')

  const finalData = await persisted()
  assert(
    '清空后数据里只剩进行中的任务',
    !!finalData && finalData.length === 1 && finalData[0].id === 'a1',
    JSON.stringify(finalData)
  )

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
