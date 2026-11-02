'use strict'

const { BrowserWindow, screen, ipcMain } = require('electron')
const path = require('node:path')
const { IPC } = require('./channels.cjs')

/**
 * 「工作速录」的两个辅助窗口：
 *
 *  - 后台录制悬浮球（float）：贴在屏幕右缘的小标签，点击展开为长条控制面
 *    （计时 / 暂停 / 停止 / 恢复 / 收起）；点击「后台录制」时收起主窗口、显示它。
 *  - 字幕悬浮窗（subtitle）：屏幕底部居中的透明置顶字幕。默认对鼠标「隐形穿透」
 *    （不再截留页面点击）；悬停检测由主进程轮询全局鼠标位置完成（穿透态下字幕窗
 *    自身收不到任何 DOM 鼠标事件，`forward: true` 也仅 Windows 支持）：
 *    移入字幕立即唤醒（显示阴影底板、可拖动 / 可点关闭），移出短暂宽限后回到沉浸
 *    并重新穿透；主窗口的「鼠标穿透」开关可强制常穿。
 *
 * 二者与主窗口共用同一个 preload（`window.api.windows`），通过主进程转发消息，
 * 不直接持有录音引擎。录音引擎始终运行在主窗口渲染层（隐藏时仍继续运行）。
 */

/** @type {BrowserWindow | null} */
let floatWin = null
/** @type {BrowserWindow | null} */
let subtitleWin = null
let mainGetter = () => null
let devUrl = ''
let indexFile = ''
let subtitleInteractive = true
/** 主进程轮询得出的悬停状态（含拖动锁定），配合「鼠标穿透」开关决定字幕窗是否拦截鼠标：
 *  沉浸态自动放行鼠标，避免透明长条长期截留页面点击（截图/操作被吞）。 */
let subtitleHover = false
let initialized = false
/** 最近一次推送，供窗口刚创建 / 重载时补发（避免暂停态无更新时窗口空白） */
let lastFloatState = null
let lastSubtitle = null

// ---------------------------------------------------------------------------
// 字幕窗悬停检测（主进程轮询）相关状态
// ---------------------------------------------------------------------------

const isWin32 = process.platform === 'win32'
/** 悬停轮询节拍：移入立即唤醒；移出需连续数个「不在」采样（宽限防抖）才沉浸 */
const HOVER_POLL_MS = 50
const HOVER_LEAVE_SAMPLES = 2
/** 渲染层没能上报 mouseup 时的兜底释放，避免拖动锁把穿透永久焊死 */
const DRAG_PIN_TIMEOUT_MS = 15000
/** 命中盒在字幕本体矩形基础上的外扩：覆盖右上角关闭按钮与左上角说话人标签 */
const HIT_PAD = { l: 12, r: 20, t: 14, b: 10 }

/** 字幕页上报的字幕本体矩形（窗口内 DIP 坐标）；null 时用底部横条兜底 */
let subtitleHitRect = null
/** 字幕页按下拖动中：期间只要指针还在窗口内就保持悬停 */
let subtitleDragPin = false
let dragPinTimer = null
let hoverPollTimer = null
let hoverOutsideSamples = HOVER_LEAVE_SAMPLES
/** 当前实际生效的穿透状态（null=还没设置过），只在变化时调 setIgnoreMouseEvents，减少切换 */
let subtitleIgnoring = null

function initRecorderWindows(opts) {
  if (initialized) return
  initialized = true
  mainGetter = (opts && opts.getMainWindow) || (() => null)
  devUrl = (opts && opts.devUrl) || ''
  indexFile = (opts && opts.indexFile) || path.join(__dirname, '..', '..', 'dist', 'index.html')
  registerIpc()
}

function baseWebPreferences() {
  return {
    preload: path.join(__dirname, '..', 'preload.cjs'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
    spellcheck: false,
    backgroundThrottling: false
  }
}

function loadHash(win, hash) {
  if (devUrl) win.loadURL(`${devUrl}#${hash}`)
  else win.loadFile(indexFile, { hash })
}

function getMain() {
  const main = mainGetter()
  if (!main || main.isDestroyed()) return null
  // 主窗口是这两个辅助窗的唯一控制端：它被关掉时一并收掉，
  // 否则屏幕上会留下无法操作的悬浮球 / 字幕条。
  if (!main.__srAuxHooked) {
    main.__srAuxHooked = true
    main.once('closed', () => disposeRecorderWindows())
  }
  return main
}

// ---------------------------------------------------------------------------
// 后台录制悬浮球（贴屏幕右缘，可收起 / 展开）
// ---------------------------------------------------------------------------

/** 展开态：长条控制面 */
const FLOAT_W = 332
const FLOAT_H = 62
/** 收起态：贴在右缘的小标签 */
const TAB_W = 44
const TAB_H = 96
/** 展开态距右缘的间隙；收起态紧贴右缘 */
const EDGE_GAP = 12

let floatExpanded = false
/** 窗口中心距工作区底边的距离（只允许上下拖动） */
let floatCenterFromBottom = 86

/** 按当前模式算出贴右缘的窗口位置。 */
function floatGeometry() {
  const work = screen.getPrimaryDisplay().workArea
  const w = floatExpanded ? FLOAT_W : TAB_W
  const h = floatExpanded ? FLOAT_H : TAB_H
  const gap = floatExpanded ? EDGE_GAP : 0
  const center = Math.max(
    h / 2 + 8,
    Math.min(work.height - h / 2 - 8, floatCenterFromBottom)
  )
  return {
    w,
    h,
    x: work.x + work.width - w - gap,
    y: Math.round(work.y + work.height - center - h / 2)
  }
}

function pushFloatState() {
  if (!floatWin || floatWin.isDestroyed()) return
  // expanded 必须跟着状态一起走：即使主窗口还没来得及推状态，
  // 收起 / 展开的模式也要能同步到悬浮球页面。
  floatWin.webContents.send(IPC.floatState, {
    state: 'RECORDING',
    elapsedMs: 0,
    ...(lastFloatState || {}),
    expanded: floatExpanded
  })
}

/** 收起 / 展开：换尺寸并重新贴边，同时把模式推给悬浮球页面。 */
function setFloatExpanded(on) {
  const want = !!on
  if (!floatWin || floatWin.isDestroyed()) {
    floatExpanded = want
    return
  }
  if (floatExpanded === want) return
  floatExpanded = want
  const g = floatGeometry()
  floatWin.setBounds({ x: g.x, y: g.y, width: g.w, height: g.h })
  pushFloatState()
}

function createFloatWindow() {
  if (floatWin && !floatWin.isDestroyed()) return floatWin
  const g = floatGeometry()
  floatWin = new BrowserWindow({
    x: g.x,
    y: g.y,
    width: g.w,
    height: g.h,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: baseWebPreferences()
  })
  floatWin.setAlwaysOnTop(true, 'screen-saver')
  floatWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // 用户拖动后重新贴回右缘（只保留上下方向），并记住高度位置
  floatWin.on('moved', () => {
    const win = floatWin
    if (!win || win.isDestroyed()) return
    const b = win.getBounds()
    const now = floatGeometry()
    // 收起 / 展开的瞬间 macOS 会先报旧尺寸：这种过渡态不能用来反推位置，
    // 否则中心点会被一路算到下限，长条会往下滑。
    if (b.width !== now.w || b.height !== now.h) return
    const work = screen.getPrimaryDisplay().workArea
    const center = Math.max(
      b.height / 2 + 8,
      Math.min(work.height - b.height / 2 - 8, work.y + work.height - (b.y + b.height / 2))
    )
    floatCenterFromBottom = Math.round(center)
    if (b.x !== now.x || b.y !== now.y) win.setBounds({ x: now.x, y: now.y })
  })
  loadHash(floatWin, 'float')
  floatWin.webContents.on('did-finish-load', pushFloatState)
  floatWin.once('ready-to-show', () => {
    if (floatWin && !floatWin.isDestroyed()) floatWin.showInactive()
  })
  floatWin.on('closed', () => {
    floatWin = null
  })
  return floatWin
}

function showFloat() {
  const win = createFloatWindow()
  if (win.isMinimized()) win.restore()
  // 每次进入后台录制都先收起，只留右缘提示标签
  setFloatExpanded(false)
  win.showInactive()
  const main = getMain()
  if (main) main.hide()
}

function hideFloat() {
  if (floatWin && !floatWin.isDestroyed()) floatWin.hide()
  const main = getMain()
  if (main) {
    main.show()
    main.focus()
  }
}

// ---------------------------------------------------------------------------
// 字幕悬浮窗
// ---------------------------------------------------------------------------

function createSubtitleWindow() {
  if (subtitleWin && !subtitleWin.isDestroyed()) return subtitleWin
  const work = screen.getPrimaryDisplay().workArea
  const w = Math.min(1200, Math.round(work.width * 0.74))
  const h = 184
  const x = work.x + Math.round((work.width - w) / 2)
  const y = work.y + work.height - h - 104
  // 新建时把悬停相关状态归零，避免复用到旧窗口残留的 rect / pin / ignoring
  subtitleHover = false
  subtitleHitRect = null
  subtitleIgnoring = null
  hoverOutsideSamples = HOVER_LEAVE_SAMPLES
  clearDragPin()
  subtitleWin = new BrowserWindow({
    width: w,
    height: h,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: baseWebPreferences()
  })
  subtitleWin.setAlwaysOnTop(true, 'screen-saver')
  subtitleWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  applySubtitleMouse()
  loadHash(subtitleWin, 'subtitle')
  subtitleWin.webContents.on('did-finish-load', () => {
    if (!subtitleWin || subtitleWin.isDestroyed()) return
    if (lastSubtitle) subtitleWin.webContents.send(IPC.subtitleText, lastSubtitle)
    // 页面（重）载完成：同步一次当前悬停态，防止订阅错过了变更推送
    applySubtitleMouse()
  })
  subtitleWin.once('ready-to-show', () => {
    if (subtitleWin && !subtitleWin.isDestroyed()) subtitleWin.showInactive()
  })
  subtitleWin.on('closed', () => {
    stopHoverPoll()
    clearDragPin()
    subtitleWin = null
    subtitleHitRect = null
  })
  return subtitleWin
}

function showSubtitle() {
  const win = createSubtitleWindow()
  if (win.isMinimized()) win.restore()
  win.showInactive()
  startHoverPoll()
}

function hideSubtitle() {
  stopHoverPoll()
  clearDragPin()
  setSubtitleHover(false)
  if (subtitleWin && !subtitleWin.isDestroyed()) subtitleWin.hide()
}

function setSubtitleInteractive(on) {
  subtitleInteractive = !!on
  applySubtitleMouse()
}

/** 命中判定：优先用字幕页上报的本体矩形（含外扩），未知时用底部居中横条兜底。 */
function pointInPill(pt) {
  const b = subtitleWin.getBounds()
  let x, y, w, h
  if (subtitleHitRect) {
    const r = subtitleHitRect
    x = b.x + r.x - HIT_PAD.l
    y = b.y + r.y - HIT_PAD.t
    w = r.w + HIT_PAD.l + HIT_PAD.r
    h = r.h + HIT_PAD.t + HIT_PAD.b
  } else {
    x = b.x + Math.round(b.width * 0.13)
    y = b.y + b.height - 140
    w = Math.round(b.width * 0.74)
    h = 140
  }
  return pt.x >= x && pt.x <= x + w && pt.y >= y && pt.y <= y + h
}

function pointInWindow(pt) {
  const b = subtitleWin.getBounds()
  return pt.x >= b.x && pt.x <= b.x + b.width && pt.y >= b.y && pt.y <= b.y + b.height
}

/**
 * 实际生效规则：用户开了「可交互」且鼠标正悬停在字幕上，才拦截鼠标事件；其余一律穿透。
 * 只在穿透值变化时调 setIgnoreMouseEvents（减少 macOS 上的切换开销与风险），
 * 并把生效的悬停态推给字幕页驱动「阴影底板 / 关闭按钮」的显示。
 */
function applySubtitleMouse() {
  if (!subtitleWin || subtitleWin.isDestroyed()) return
  const effective = subtitleInteractive && subtitleHover
  const ignore = !effective
  if (subtitleIgnoring !== ignore) {
    subtitleIgnoring = ignore
    try {
      // forward 仅 Windows 支持；macOS 传了无效且历史上更易出问题
      subtitleWin.setIgnoreMouseEvents(ignore, isWin32 ? { forward: true } : undefined)
    } catch {
      /* 窗口瞬时状态异常：下一个采样点会重试 */
    }
  }
  if (!subtitleWin.isDestroyed() && !subtitleWin.webContents.isDestroyed()) {
    subtitleWin.webContents.send(IPC.subtitleHoverState, effective)
  }
}

function setSubtitleHover(on) {
  if (subtitleHover === !!on) return
  subtitleHover = !!on
  applySubtitleMouse()
}

function clearDragPin() {
  subtitleDragPin = false
  if (dragPinTimer) {
    clearTimeout(dragPinTimer)
    dragPinTimer = null
  }
}

/** 轮询全局鼠标位置判定悬停：穿透态下字幕窗自身收不到鼠标事件，只能由主进程代看。 */
function pollSubtitleHover() {
  if (!subtitleWin || subtitleWin.isDestroyed() || !subtitleWin.isVisible()) return
  let inside = false
  try {
    const pt = screen.getCursorScreenPoint()
    // 拖动期间：只要指针还在窗口内就保持悬停；完全移出窗口视为拖动已结束并提前解锁
    inside = subtitleDragPin ? pointInWindow(pt) : pointInPill(pt)
    if (subtitleDragPin && !inside) clearDragPin()
  } catch {
    return
  }
  if (inside) {
    hoverOutsideSamples = 0
    setSubtitleHover(true) // 移入：立即唤醒
  } else {
    hoverOutsideSamples += 1
    // 移出：宽限数个采样再沉浸，避免穿字间隙 / 单帧抖动导致闪烁
    if (hoverOutsideSamples >= HOVER_LEAVE_SAMPLES) setSubtitleHover(false)
  }
}

function startHoverPoll() {
  if (hoverPollTimer) return
  hoverOutsideSamples = HOVER_LEAVE_SAMPLES
  hoverPollTimer = setInterval(pollSubtitleHover, HOVER_POLL_MS)
}

function stopHoverPoll() {
  if (hoverPollTimer) {
    clearInterval(hoverPollTimer)
    hoverPollTimer = null
  }
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

function registerIpc() {
  ipcMain.handle(IPC.floatControl, (_e, action) => {
    if (action === 'show') showFloat()
    else hideFloat()
  })

  // 主窗口 → 悬浮球：状态（expanded 由主进程掌握，转发时注入）
  ipcMain.on(IPC.floatState, (_e, s) => {
    lastFloatState = s
    pushFloatState()
  })

  // 悬浮球 → 主窗口：动作（restore / expand / collapse 由主进程直接处理）
  ipcMain.on(IPC.floatCommand, (_e, c) => {
    if (c === 'restore') {
      hideFloat()
      return
    }
    if (c === 'expand') {
      setFloatExpanded(true)
      return
    }
    if (c === 'collapse') {
      setFloatExpanded(false)
      return
    }
    const main = getMain()
    if (main) main.webContents.send(IPC.floatCommand, c)
    // 停止录制后自动还原主窗口，让用户直接看到结果
    if (c === 'stop') hideFloat()
  })

  ipcMain.handle(IPC.subtitleControl, (_e, action, value) => {
    if (action === 'show') showSubtitle()
    else if (action === 'hide') hideSubtitle()
    else if (action === 'interactive') setSubtitleInteractive(value)
  })

  // 字幕窗上报字幕本体矩形（窗口内坐标）：主进程据此做全局鼠标命中判定
  ipcMain.on(IPC.subtitleHit, (_e, r) => {
    if (r && Number.isFinite(r.x) && Number.isFinite(r.y) && r.w > 4 && r.h > 4) {
      subtitleHitRect = { x: r.x, y: r.y, w: r.w, h: r.h }
    }
  })

  // 字幕窗上报按下拖动状态：拖动期间锁定悬停，防止中途重新穿透把窗口丢在半路
  ipcMain.on(IPC.subtitleDrag, (_e, on) => {
    if (on) {
      subtitleDragPin = true
      hoverOutsideSamples = 0
      setSubtitleHover(true)
      if (dragPinTimer) clearTimeout(dragPinTimer)
      dragPinTimer = setTimeout(clearDragPin, DRAG_PIN_TIMEOUT_MS)
    } else {
      clearDragPin()
      hoverOutsideSamples = HOVER_LEAVE_SAMPLES - 1 // 松手后若指针已离开，下一拍即沉浸
    }
  })

  // 主窗口 → 字幕窗：内容
  ipcMain.on(IPC.subtitleText, (_e, p) => {
    lastSubtitle = p
    if (subtitleWin && !subtitleWin.isDestroyed()) subtitleWin.webContents.send(IPC.subtitleText, p)
  })

  // 字幕窗 → 主窗口：动作（关闭等），主窗口据此同步开关状态
  ipcMain.on(IPC.subtitleCommand, (_e, c) => {
    const main = getMain()
    if (main) main.webContents.send(IPC.subtitleCommand, c)
  })
}

function disposeRecorderWindows() {
  stopHoverPoll()
  clearDragPin()
  if (floatWin && !floatWin.isDestroyed()) floatWin.destroy()
  if (subtitleWin && !subtitleWin.isDestroyed()) subtitleWin.destroy()
  floatWin = null
  subtitleWin = null
  subtitleHitRect = null
}

module.exports = {
  initRecorderWindows,
  disposeRecorderWindows,
  showFloat,
  hideFloat,
  showSubtitle,
  hideSubtitle,
  setSubtitleInteractive
}
