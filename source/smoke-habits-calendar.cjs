'use strict'
/**
 * 打卡新功能冒烟：按习惯独立的日历视图 + 鲜花图标
 * 目标：验证
 *   1) 打卡后出现鲜花图标（不再是 ☑️）
 *   2) 周/日历视图切换在「每个习惯卡片」上独立可用
 *   3) 月历网格只显示本习惯：网格渲染、翻月、「回到本月」、点历史日期补打卡生效
 *   4) 全程无控制台报错
 */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const OUT = '/tmp/taskflow-smoke-habits-cal'
const FILE = process.env.SMOKE_FILE || path.join(__dirname, 'dist/index.html')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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

  const shot = async (name) => {
    const img = await win.webContents.capturePage()
    fs.writeFileSync(`${OUT}/${name}.png`, img.toPNG())
    console.log(`shot -> ${name}.png`)
  }
  const js = (code) => win.webContents.executeJavaScript(code)

  const clickText = (sel, text) => `(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find(x => x.textContent.trim() === ${JSON.stringify(text)});
    if (!el) return 'NOT_FOUND';
    el.click();
    return 'clicked';
  })()`

  const clickStarts = (sel, text) => `(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find(x => x.textContent.trim().startsWith(${JSON.stringify(text)}));
    if (!el) return 'NOT_FOUND';
    el.click();
    return 'clicked';
  })()`

  const setValue = (sel, text) => `(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return 'NO_EL';
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, ${JSON.stringify(text)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return el.value;
  })()`

  const pressEnter = (sel) => `(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return 'NO_EL';
    el.focus();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    return 'sent';
  })()`

  const clickAria = (label) => `(() => {
    const el = document.querySelector('[aria-label=${JSON.stringify(label)}]');
    if (!el) return 'NOT_FOUND';
    el.click();
    return 'clicked';
  })()`

  const flowerCount = `document.querySelectorAll('svg ellipse').length`

  await win.loadFile(FILE)
  await sleep(800)
  await js('localStorage.clear()')
  await win.webContents.reload()
  await sleep(2600)
  await shot('0-home')

  // ---- 进入打卡 ----
  console.log('nav 打卡 ->', await js(clickStarts('button', '打卡')))
  await sleep(700)
  await shot('1-habits-empty')

  // ---- 新建习惯 ----
  console.log('新建习惯 ->', await js(clickText('button', '新建习惯')))
  await sleep(300)
  await js(setValue('input[placeholder*="习惯名称"]', '每天喝水 8 杯'))
  await sleep(200)
  console.log('submit habit ->', await js(pressEnter('input[placeholder*="习惯名称"]')))
  await sleep(700)
  await shot('2-habit-created')

  const beforeFlowers = await js(flowerCount)
  console.log('flowers before check-in:', beforeFlowers)

  // ---- 打卡：应出现「已打卡」+ 鲜花 ----
  console.log('toggle 打卡 ->', await js(clickText('button', '打卡')))
  await sleep(600)
  await shot('3-habit-checked')
  const afterCheck = await js(`(() => {
    const b = document.body.innerText;
    return {
      hasDone: b.includes('已打卡'),
      flowers: ${flowerCount},
      hasCheckGlyph: b.includes('☑'),
    };
  })()`)
  console.log('after check-in:', JSON.stringify(afterCheck))

  // ---- 卡片上切到日历视图（每个习惯独立的切换按钮）----
  console.log('切到日历视图 ->', await js(clickAria('日历视图')))
  await sleep(700)
  await shot('4-habit-month')
  const monthReport = await js(`(() => {
    const b = document.body.innerText;
    const monthLabel = (b.match(/\\d{4}\\s*年\\s*\\d{1,2}\\s*月/) || [null])[0];
    return {
      monthLabel,
      hasMonthCount: /本月 \\d+ 天/.test(b),
      hasDayCells: !!document.querySelector('button[title^="20"]'),
      // 不应再有全局总览的「打卡情况」面板
      hasGlobalDetail: b.includes('打卡情况'),
      navBtns: document.querySelectorAll('[aria-label="上一月"]').length,
    };
  })()`)
  console.log('month view:', JSON.stringify(monthReport))

  // ---- 翻到下一月 → 应出现「回到本月」 ----
  console.log('下一月 ->', await js(`(() => { const b = document.querySelector('[aria-label="下一月"]'); if (!b) return 'NO_BTN'; b.click(); return 'clicked' })()`))
  await sleep(500)
  await shot('5-next-month')
  const nextMonth = await js(`document.body.innerText.includes('回到本月')`)
  console.log('回到本月 visible after shift:', nextMonth)

  // ---- 回到本月 ----
  console.log('回到本月 ->', await js(clickText('button', '回到本月')))
  await sleep(500)
  const backHome = await js(`document.body.innerText.includes('回到本月')`)
  console.log('回到本月 visible after reset:', backHome)
  await shot('6-back-to-month')

  // ---- 点选一个历史日期 → 直接给本习惯补打卡（写入持久化数据）----
  const clickedDay = await js(`(() => {
    const d = new Date(); const pad = (n) => String(n).padStart(2, '0');
    const todayKey = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    const btns = [...document.querySelectorAll('button[title]')].filter((b) => /^\\d{4}-\\d{2}-\\d{2}$/.test(b.title) && b.title < todayKey && !b.disabled);
    if (!btns.length) return 'NO_DAY';
    const target = btns[0];
    target.click();
    return target.getAttribute('title');
  })()`)
  await sleep(700)
  const persisted = await js(`(() => {
    const data = JSON.parse(localStorage.getItem('taskflow-data') || '{}');
    const habit = (data.habits || [])[0];
    return habit ? Object.keys(habit.checkins).sort() : null;
  })()`)
  console.log('补打卡 day:', JSON.stringify(clickedDay), 'checkins:', JSON.stringify(persisted))
  console.log('补打卡生效:', typeof clickedDay === 'string' && Array.isArray(persisted) && persisted.includes(clickedDay))
  await shot('7-day-checked')

  // ---- 再点同一天 → 取消该天打卡 ----
  const undoDay = await js(`(() => {
    const btn = document.querySelector('button[title=${JSON.stringify(String(clickedDay))}]');
    if (!btn) return 'NO_BTN';
    btn.click();
    return 'clicked';
  })()`)
  await sleep(700)
  const persisted2 = await js(`(() => {
    const data = JSON.parse(localStorage.getItem('taskflow-data') || '{}');
    const habit = (data.habits || [])[0];
    return habit ? Object.keys(habit.checkins).sort() : null;
  })()`)
  console.log('取消打卡:', undoDay, 'checkins:', JSON.stringify(persisted2))

  // ---- 切回周视图 ----
  console.log('切回周视图 ->', await js(clickAria('周视图')))
  await sleep(500)
  const weekBack = await js(`(() => ({
    hasStrip: !document.body.innerText.includes('本月 0 天'),
    monthGone: !document.querySelector('[aria-label="上一月"]'),
  }))()`)
  console.log('week view back:', JSON.stringify(weekBack))
  await shot('8-week-again')

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO_CONSOLE_ERRORS')
  console.log('shots dir:', OUT)
  app.exit(0)
})
