'use strict'
/**
 * 新增功能冒烟：打卡 / 轻笔记 / 专注模式
 * 目标：验证三个视图可打开、可交互、无控制台报错
 */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')

const OUT = '/tmp/taskflow-smoke-new'
const FILE = process.env.SMOKE_FILE || '/tmp/taskflow-app/dist/index.html'

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

  await win.loadFile(FILE)
  await sleep(800)
  await js('localStorage.clear()')
  await win.webContents.reload()
  await sleep(2600)
  await shot('0-home')

  // ---- 打卡 ----
  console.log('nav 打卡 ->', await js(clickStarts('button', '打卡')))
  await sleep(700)
  await shot('1-habits-empty')
  console.log('新建习惯 ->', await js(clickText('button', '新建习惯')))
  await sleep(300)
  await js(setValue('input[placeholder*="习惯名称"]', '每天喝水 8 杯'))
  await sleep(200)
  console.log('submit habit ->', await js(pressEnter('input[placeholder*="习惯名称"]')))
  await sleep(700)
  console.log('打卡 toggle ->', await js(clickText('button', '打卡')))
  await sleep(500)
  await shot('2-habits-checked')
  const habitsReport = await js(`(() => {
    const body = document.body.innerText;
    return {
      hasHabit: body.includes('每天喝水'),
      hasStreak: body.includes('连续'),
      hasChecked: body.includes('已打卡'),
    };
  })()`)
  console.log('habits:', JSON.stringify(habitsReport))

  // ---- 轻笔记 ----
  console.log('nav 轻笔记 ->', await js(clickStarts('button', '轻笔记')))
  await sleep(700)
  await shot('3-notes')
  await js(setValue('textarea[placeholder*="写点什么"]', '冒烟长文\n\n' + Array.from({ length: 60 }, (_, i) => `第 ${i + 1} 行内容，用于测试长文滚动与底部按钮是否被遮挡。`).join('\n')))
  await sleep(200)
  console.log('添加笔记 ->', await js(clickText('button', '添加笔记')))
  await sleep(600)
  await shot('4-notes-added')
  const notesReport = await js(`(() => {
    const body = document.body.innerText;
    return { hasNote: body.includes('冒烟长文') };
  })()`)
  console.log('notes:', JSON.stringify(notesReport))

  // 点击长文笔记 → 打开「查看」页（不是编辑页）
  console.log('open note ->', await js(`(() => { const a = [...document.querySelectorAll('article')].find((x) => x.textContent.includes('冒烟长文')); if (!a) return 'NOT_FOUND'; a.click(); return 'clicked' })()`))
  await sleep(500)
  await shot('4b-note-view')
  const noteView = await js(`(() => { const b = document.body.innerText; return { hasCreated: b.includes('创建于'), hasEdit: b.includes('编辑') } })()`)
  console.log('note view:', JSON.stringify(noteView))
  await js(`(() => { const x = document.querySelector('.animate-pop-in button[aria-label="关闭"]'); if (x) x.click(); return !!x })()`)
  await sleep(400)

  // 打开编辑页 → 预览模式，检查弹窗不溢出窗口、底部按钮不被遮挡、正文可滚动
  console.log('edit note ->', await js(`(() => { const a = [...document.querySelectorAll('article')].find((x) => x.textContent.includes('冒烟长文')); if (!a) return 'NOT_FOUND'; const b = a.querySelector('button[aria-label="编辑笔记"]'); if (!b) return 'NO_BTN'; b.click(); return 'clicked' })()`))
  await sleep(500)
  console.log('preview ->', await js(clickText('button', '预览')))
  await sleep(400)
  await shot('4c-note-editor-preview')
  const editorGeom = await js(`(() => {
    const panel = document.querySelector('.animate-pop-in');
    if (!panel) return 'NO_PANEL';
    const r = panel.getBoundingClientRect();
    const body = panel.querySelector('.overflow-y-auto');
    const br = body ? body.getBoundingClientRect() : null;
    const btns = [...panel.querySelectorAll('button')].map((b) => b.textContent.trim());
    const footerBtn = [...panel.querySelectorAll('button')].find((b) => b.textContent.trim() === '保存');
    const fr = footerBtn ? footerBtn.getBoundingClientRect() : null;
    return {
      bottom: Math.round(r.bottom),
      ih: window.innerHeight,
      overflow: r.bottom > window.innerHeight + 1,
      bodyInside: br ? br.bottom <= r.bottom + 1 : null,
      bodyAboveFooter: br && fr ? br.bottom <= fr.top + 1 : null,
      bodyScrollable: body ? body.scrollHeight > body.clientHeight + 2 : null,
      hasSave: btns.includes('保存'),
      hasDel: btns.includes('删除'),
    };
  })()`)
  console.log('editor geom:', JSON.stringify(editorGeom))
  await js(`(() => { const x = document.querySelector('.animate-pop-in button[aria-label="关闭"]'); if (x) x.click(); return !!x })()`)
  await sleep(400)

  // 悬浮球（固定在右下角）存在
  const fab = await js(`(() => !!document.querySelector('[aria-label="打开速记"]'))()`)
  console.log('floating ball present:', fab)
  await js(`(() => { const b = document.querySelector('[aria-label="打开速记"]'); b && b.click(); return !!b })()`)
  await sleep(500)
  await shot('5-floating-open')
  const panelOpen = await js(`(() => document.body.innerText.includes('速记'))()`)
  console.log('floating panel open:', panelOpen)

  // ---- 专注模式 ----
  console.log('nav 全部任务 ->', await js(clickStarts('button', '全部任务')))
  await sleep(700)
  console.log('专注模式 ->', await js(clickText('article button', '专注模式')))
  await sleep(700)
  await shot('6-focus')
  const focusReport = await js(`(() => {
    const body = document.body.innerText;
    return { hasFocus: body.includes('专注模式'), hasStart: body.includes('开始专注'), hasRing: !!document.querySelector('svg circle') };
  })()`)
  console.log('focus:', JSON.stringify(focusReport))
  console.log('开始专注 ->', await js(clickText('button', '开始专注')))
  await sleep(1200)
  await shot('7-focus-running')
  console.log('退出专注 ->', await js(clickText('button', '退出专注')))
  await sleep(500)

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO_CONSOLE_ERRORS')
  app.exit(0)
})
