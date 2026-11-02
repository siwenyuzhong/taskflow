'use strict'
/**
 * 回归：窗口较矮时，「详细创建」弹窗的头部不能被顶出视口。
 * 覆盖 620px / 760px 两种高度，断言 dialog 完整落在视口内、标题可见、主体可独立滚动、底部按钮可见。
 */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')

const OUT = '/tmp/taskflow-smoke'
const FILE = '/tmp/taskflow-app/dist/index.html'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const PROBE = `(() => {
  const dlg = document.querySelector('[role="dialog"]');
  if (!dlg) return { open: false };
  const r = dlg.getBoundingClientRect();
  const title = [...dlg.querySelectorAll('h2')][0];
  const tr = title ? title.getBoundingClientRect() : null;
  const body = dlg.children[2] || null;
  const submit = [...dlg.querySelectorAll('button')].find(b => /创建任务|保存修改/.test(b.textContent));
  const sr = submit ? submit.getBoundingClientRect() : null;
  return {
    open: true,
    vh: window.innerHeight,
    dialog: { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) },
    titleTop: tr ? Math.round(tr.top) : null,
    titleVisible: tr ? tr.top >= 0 && tr.bottom <= window.innerHeight : false,
    submitVisible: sr ? sr.top >= 0 && sr.bottom <= window.innerHeight : false,
    bodyScroll: body ? { scrollH: body.scrollHeight, clientH: body.clientHeight } : null,
    closeBtnReachable: (() => {
      const b = dlg.querySelector('[aria-label="关闭"]');
      if (!b) return null;
      const br = b.getBoundingClientRect();
      // 元素中心点必须能被命中（不被其它元素遮挡）
      const el = document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2);
      return !!el && (el === b || b.contains(el));
    })(),
  };
})()`

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const errors = []

  const win = new BrowserWindow({
    width: 1440,
    height: 620,
    show: false,
    backgroundColor: '#07070e',
    webPreferences: { offscreen: false },
  })
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) errors.push(`console:${level} ${message}`)
  })

  for (const h of [620, 760]) {
    win.setSize(1440, h)
    await win.loadFile(FILE)
    await sleep(2600)
    await win.webContents.executeJavaScript(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '详细创建');
      if (b) b.click(); return !!b;
    })()`)
    await sleep(1000)

    const r = await win.webContents.executeJavaScript(PROBE)
    console.log(`--- 窗口高度 ${h}px ---`)
    console.log(JSON.stringify(r))
    const ok =
      r.open &&
      r.dialog.top >= 0 &&
      r.dialog.bottom <= r.vh + 1 &&
      r.titleVisible &&
      r.submitVisible &&
      r.closeBtnReachable &&
      r.bodyScroll &&
      r.bodyScroll.scrollH > r.bodyScroll.clientH
    console.log(
      ok
        ? '✅ 头部/底部均在视口内，主体可独立滚动'
        : '❌ 弹窗仍超出视口'
    )

    const img = await win.webContents.capturePage()
    fs.writeFileSync(`${OUT}/13-modal-${h}.png`, img.toPNG())
  }

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO_CONSOLE_ERRORS')
  app.exit(0)
})
