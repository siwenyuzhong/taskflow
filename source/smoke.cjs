'use strict'
/**
 * 渲染层冒烟测试（快速创建流程）
 * 1) 首屏（含快速输入框）
 * 2) 输入自然语言 → 实时预览行
 * 3) 回车创建 → 卡片出现 + 输入框清空
 * 4) 点 chip 时清除文本中同类标记
 * 5) ⌘↵ 打开详细设置并带入初值
 * 6) 浅色主题
 */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')

const OUT = '/tmp/taskflow-smoke'
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

  const TYPE = (text) => `(() => {
    const el = document.querySelector('[aria-label="快速创建任务：输入内容后回车"]');
    if (!el) return 'NO_INPUT';
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(text)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return el.value;
  })()`

  const PRESS = (key, meta = false) => `(() => {
    const el = document.querySelector('[aria-label="快速创建任务：输入内容后回车"]');
    if (!el) return 'NO_INPUT';
    el.focus();
    el.dispatchEvent(new KeyboardEvent('keydown', {
      key: ${JSON.stringify(key)}, metaKey: ${meta}, bubbles: true, cancelable: true,
    }));
    return 'sent';
  })()`

  const REPORT = `(() => {
    const el = document.querySelector('[aria-label="快速创建任务：输入内容后回车"]');
    const preview = el ? el.closest('section').querySelector('[aria-live="polite"]') : null;
    const titles = [...document.querySelectorAll('article, [data-task-card]')].length;
    const body = document.body.innerText;
    return {
      inputValue: el ? el.value : null,
      preview: preview ? preview.innerText.replace(/\\n/g, ' | ') : null,
      hasToastCreated: body.includes('已创建'),
      hasCreatedTask: body.includes('重构登录模块'),
      cardCount: titles,
    };
  })()`

  await win.loadFile(FILE)
  await sleep(2800)
  await shot('1-home')

  console.log('type ->', await js(TYPE('重构登录模块 2小时 !高 #研发')))
  await sleep(420)
  await shot('2-preview')
  console.log('preview state:', JSON.stringify(await js(REPORT)))

  await js(PRESS('Enter'))
  await sleep(900)
  await shot('3-created')
  console.log('after Enter:', JSON.stringify(await js(REPORT)))

  // chip 覆盖：文本里带 1h 时点击「30 分」，应清掉文本中的时长标记
  await js(TYPE('回复邮件 1h'))
  await sleep(300)
  const chipClick = `(() => {
    const btn = [...document.querySelectorAll('.chip-btn')].find(b => b.textContent.trim() === '30 分');
    if (!btn) return 'NO_CHIP';
    btn.click();
    return 'clicked';
  })()`
  console.log('chip ->', await js(chipClick))
  await sleep(420)
  await shot('4-chip-override')
  console.log('after chip:', JSON.stringify(await js(REPORT)))

  // ⌘↵ 打开详细设置
  await js(TYPE('准备季度汇报 90分钟 !低 #工作'))
  await sleep(300)
  await js(PRESS('Enter', true))
  await sleep(1000)
  await shot('5-detail')
  const DETAIL = `(() => {
    const quick = document.querySelector('[aria-label="快速创建任务：输入内容后回车"]');
    const search = document.querySelector('[aria-label="搜索任务"]');
    const composerOpen = !!document.querySelector('textarea[placeholder*="补充说明"]');
    const titleInput = [...document.querySelectorAll('input')]
      .find(i => i !== quick && i !== search);
    return { composerOpen, composerTitle: titleInput ? titleInput.value : null };
  })()`
  console.log('detail (after ⌘↵):', JSON.stringify(await js(DETAIL)))

  // 若 ⌘↵ 未生效，退化验证「详细」按钮路径
  const viaButton = await js(DETAIL)
  if (!viaButton.composerOpen) {
    await js(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '详细');
      if (b) b.click();
      return !!b;
    })()`)
    await sleep(900)
    await shot('5b-detail-button')
    console.log('detail (via button):', JSON.stringify(await js(DETAIL)))
  }

  await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
  await sleep(500)
  await js(`(() => { const b = document.querySelector('[aria-label="切换主题"]'); if (b) b.click(); return !!b })()`)
  await sleep(1100)
  await shot('6-light')

  // 操作区按钮宽度回归：标记完成 → 已完成视图
  await js(`(() => {
    const b = [...document.querySelectorAll('article button')].find(x => x.textContent.trim() === '标记完成');
    if (b) b.click(); return !!b;
  })()`)
  await sleep(1000)
  await shot('7-completed')

  const MEASURE = `(() => {
    const cards = [...document.querySelectorAll('article')];
    return {
      cardWidth: cards[0] ? Math.round(cards[0].getBoundingClientRect().width) : null,
      rows: cards.slice(0, 4).map(a => ({
        buttons: [...a.querySelectorAll('button')]
          .filter(b => ['标记完成', '恢复任务', '续时长', '设定时长'].some(t => b.textContent.includes(t)))
          .map(b => ({
            label: b.textContent.trim().slice(0, 6),
            w: Math.round(b.getBoundingClientRect().width),
            h: Math.round(b.getBoundingClientRect().height),
          })),
      })),
    };
  })()`
  console.log('action buttons:', JSON.stringify(await js(MEASURE)))

  // 切到「已完成」视图看恢复任务按钮
  await js(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().startsWith('已完成'));
    if (b) b.click(); return !!b;
  })()`)
  await sleep(800)
  await shot('8-done-view')
  console.log('done view buttons:', JSON.stringify(await js(MEASURE)))

  // 回归：创建任务不应改变页面滚动位置
  await js(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().startsWith('全部任务'));
    if (b) b.click(); return !!b;
  })()`)
  await sleep(600)
  for (let i = 0; i < 8; i++) {
    await js(TYPE(`批量任务 ${i + 1} 2小时`))
    await js(PRESS('Enter'))
    await sleep(240)
  }
  await sleep(700)
  const scrollable = await js(
    `(() => { const m = document.querySelector('main'); return { scrollHeight: m.scrollHeight, clientHeight: m.clientHeight } })()`
  )
  await js(`(() => { const m = document.querySelector('main'); m.scrollTo({ top: 0, behavior: 'auto' }); return m.scrollTop })()`)
  await sleep(700)
  const before = await js(`document.querySelector('main').scrollTop`)
  await js(TYPE('测试定位不跳动 4小时'))
  await sleep(320)
  await shot('9-before-enter')
  await js(PRESS('Enter'))
  await sleep(1400)
  const after = await js(`document.querySelector('main').scrollTop`)
  await shot('10-after-enter-no-scroll')
  console.log('scrollable:', JSON.stringify(scrollable))
  console.log('scrollTop before/after:', before, '->', after, after === before ? '✅ 未跳动' : '❌ 发生了跳动')

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO_CONSOLE_ERRORS')
  app.exit(0)
})
