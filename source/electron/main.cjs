'use strict'

const { app, BrowserWindow, dialog, ipcMain, Notification, Menu, shell, nativeTheme, screen, Tray, nativeImage } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const {
  registerSpeedRecScheme,
  registerRecorderFeature,
  disposeRecorder,
} = require('./recorder/index.cjs')

// ---------------------------------------------------------------------------
// Sloth — main process
// Owns: window chrome, atomic JSON persistence, native notifications, dock badge
// ---------------------------------------------------------------------------

const DEV_URL = process.env.VITE_DEV_SERVER_URL || ''
const isDev = !!DEV_URL && !app.isPackaged

/** @type {BrowserWindow | null} */
let mainWindow = null
let flushTimer = null
let pendingPayload = null

app.setName('Sloth')

// 「工作速录」自定义媒体协议需在 app ready 之前登记
registerSpeedRecScheme()

// --------------------------------------------------------------------------
// 旧版数据迁移：TaskFlow / 工作清单 → Sloth（仅首次，复制不删除）
// --------------------------------------------------------------------------

function migrateLegacyData() {
  try {
    const newFile = dataFile()
    if (fs.existsSync(newFile)) return
    const legacyDirs = ['TaskFlow', '工作清单']
    for (const dir of legacyDirs) {
      const legacyFile = path.join(app.getPath('appData'), dir, 'taskflow-data.json')
      if (fs.existsSync(legacyFile)) {
        fs.mkdirSync(path.dirname(newFile), { recursive: true })
        fs.copyFileSync(legacyFile, newFile)
        console.log(`[migrate] 已从 ${dir} 迁移历史数据`)
        return
      }
    }
  } catch {
    /* 迁移失败不影响启动 */
  }
}

// --------------------------------------------------------------------------
// Persistence — atomic write (tmp + rename) so a crash can never truncate data
// --------------------------------------------------------------------------

function dataFile() {
  return path.join(app.getPath('userData'), 'taskflow-data.json')
}

function readData() {
  const file = dataFile()
  try {
    if (!fs.existsSync(file)) return null
    const raw = fs.readFileSync(file, 'utf8')
    if (!raw.trim()) return null
    return JSON.parse(raw)
  } catch (err) {
    // Keep a copy of the corrupt file so nothing is silently lost.
    try {
      fs.copyFileSync(file, `${file}.corrupt-${Date.now()}`)
    } catch {
      /* ignore */
    }
    return null
  }
}

function writeData(data) {
  const file = dataFile()
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
    fs.renameSync(tmp, file)
    return true
  } catch {
    return false
  }
}

/** Renderer sends a snapshot; we debounce-coalesce bursts into one disk write. */
function queueWrite(data) {
  pendingPayload = data
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    const payload = pendingPayload
    pendingPayload = null
    if (payload) writeData(payload)
  }, 200)
}

function flushNow() {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (pendingPayload) {
    writeData(pendingPayload)
    pendingPayload = null
  }
}

// --------------------------------------------------------------------------
// Native notifications
// --------------------------------------------------------------------------

function showNotification(payload = {}) {
  if (!Notification.isSupported()) return false
  const n = new Notification({
    title: payload.title || 'Sloth',
    subtitle: payload.subtitle || undefined,
    body: payload.body || '',
    silent: !!payload.silent,
    urgency: payload.urgency || 'normal',
    timeoutType: payload.timeoutType || 'default',
  })
  n.on('click', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    if (payload.taskId) mainWindow.webContents.send('taskflow:focus-task', payload.taskId)
  })
  n.show()
  return true
}

// --------------------------------------------------------------------------
// Window
// --------------------------------------------------------------------------

function createWindow() {
  const isMac = process.platform === 'darwin'
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 420,
    minHeight: 580,
    show: false,
    backgroundColor: '#07070e',
    // Windows 的菜单栏会挤在自绘顶栏之上，这里隐藏（按 Alt 仍可临时唤出）
    autoHideMenuBar: true,
    // macOS：隐藏系统标题栏，保留红绿灯（渲染层左侧预留 88px）
    // Windows：使用系统自带标题栏，保证最小化/最大化/关闭按钮始终可用
    ...(isMac
      ? {
          titleBarStyle: 'hiddenInset',
          trafficLightPosition: { x: 18, y: 21 },
          roundedCorners: true,
          vibrancy: 'under-window',
          visualEffectState: 'active',
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    // 主窗口没了就别再飘提醒（setLightMode(false) 会顺手停掉节拍与飘窗）
    if (lightMode) setLightMode(false)
  })

  if (isDev) {
    mainWindow.loadURL(DEV_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

// --------------------------------------------------------------------------
// 轻量模式（顶栏「轻量模式」按钮）
//
// 开启后主窗口收起（macOS 同时确保 Dock 图标可见 + 顶部菜单栏出现托盘图标），
// 由主进程按节拍在屏幕顶部开一个透明置顶小窗，把「今天 / 快到期」的未完成任务
// **一条一个飘条**从右到左依次飘过去；渲染层只负责算出待办清单
// （`taskflow:lightmode-tasks`），飘窗内容与节奏都在这里。
// 点 Dock 图标、点菜单栏托盘或点飘条本身都会退出轻量模式并唤回主窗口。
// --------------------------------------------------------------------------

/** 进入轻量模式后第一次飘过的延时：只留主窗口收起的过渡，基本「点了就飘」 */
const LIGHT_FIRST_FLY_MS = Number(process.env.SLOTH_LIGHT_FIRST_FLY_MS) || 400
/** 之后的重复间隔：一轮飘过约 20s，隔几分钟再来一轮，不打扰（可覆盖） */
const LIGHT_FLY_INTERVAL_MS = Number(process.env.SLOTH_LIGHT_FLY_INTERVAL_MS) || 3 * 60_000
/** 飘窗宽度 = 屏宽、高度 = 药丸叠放的可用高度（一条 42px + 间距 8px） */
const FLY_MAX_TASKS = 5
const FLY_ROW_H = 50
const FLY_PAD = 8
/** 悬停轮询节拍与宽限（与字幕窗同一套做法：穿透窗自己收不到鼠标事件） */
const FLY_HOVER_POLL_MS = 60
const FLY_HOVER_LEAVE_SAMPLES = 2
/** 动画节奏：每条 30s 滑完（约 96px/s，比 18s 档再慢近一倍），错峰 1.6s（渲染层同值） */
const FLY_GLIDE_MS = 30_000
const FLY_STAGGER_MS = 1_600
/** 动画结束后的存活余量，之后自动关窗（没有任何任务时才不会再开） */
const FLY_TAIL_MS = 1_500

let lightMode = false
/** 渲染层推送的待办摘要；tasks 为空 = 没有需要提醒的任务，不飘 */
let lightPayload = { tasks: [], count: 0, taskId: null }
/** @type {BrowserWindow | null} */
let flyWin = null
let flyBeatTimer = null
/** 开关后「第一次飘」的一次性定时器（与周期节拍分开，避免被节拍清掉） */
let flyFirstBeatTimer = null
let flyKillTimer = null
/** 鼠标悬停轮询（穿透态下悬停判定只能靠主进程轮询全局鼠标位置） */
let flyHoverTimer = null
let flyHoverOutside = FLY_HOVER_LEAVE_SAMPLES
/** 当前已通知渲染层的悬停下标：null = 没悬停 */
let flyHoverIndex = null
/** 飘窗内各药丸的矩形（页面坐标），悬停命中用；由渲染层定时上报 */
let flyHitRects = []
/** 飘窗整体矩形（屏幕坐标），先用它做粗筛，避免每 60ms 穿透取 DOM 查询 */
let flyWindowRect = null

function pushLightState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('taskflow:lightmode-state', lightMode)
  }
}

// ---------------------------------------------------------------------------
// 菜单栏（顶部）托盘图标：轻量模式的第二个入口。
// 进入轻量模式才出现（平时不打扰菜单栏空间），点图标 / 菜单项都能唤回主窗口。
// ---------------------------------------------------------------------------

/** @type {Tray | null} */
let lightTray = null

function trayIcon() {
  // 直接用彩色 logo 缩小版（trayIcon.png + @2x，Electron 自动按屏选倍图）。
  // 之前用「模板图」（纯黑剪影）在 18px 下会糊成一个白方块，看不出是 logo。
  return nativeImage.createFromPath(path.join(__dirname, 'trayIcon.png'))
}

function ensureLightTray() {
  if (lightTray || process.platform !== 'darwin') return
  try {
    lightTray = new Tray(trayIcon())
  } catch (err) {
    console.error('[lightmode] 托盘图标创建失败', err)
    lightTray = null
    return
  }
  lightTray.setToolTip('Sloth · 轻量模式')
  const open = () => {
    if (!mainWindow || mainWindow.isDestroyed()) createWindow()
    setLightMode(false)
  }
  lightTray.on('click', open)
  lightTray.on('right-click', () => {
    lightTray.popUpContextMenu(
      Menu.buildFromTemplate([
        { label: '打开 Sloth（退出轻量模式）', click: open },
        { type: 'separator' },
        { label: '退出 Sloth', click: () => app.quit() },
      ])
    )
  })
}

function destroyLightTray() {
  if (lightTray) {
    lightTray.destroy()
    lightTray = null
  }
}

function closeFlyWindow() {
  if (flyKillTimer) {
    clearTimeout(flyKillTimer)
    flyKillTimer = null
  }
  stopFlyHoverPoll()
  flyHoverIndex = null
  flyHitRects = []
  if (flyWin && !flyWin.isDestroyed()) flyWin.close()
  flyWin = null
}

// ---------------------------------------------------------------------------
// 飘窗悬停检测：飘窗对鼠标「穿透」（不然屏幕最上方一整条都点不动），
// 所以页面收不到 mouseenter/mousemove —— 由主进程轮询全局鼠标位置判定，
// 命中某条药丸 → 收回穿透 + 把下标推给页面（该条暂停）；移开 → 恢复穿透 + 继续飘。
// ---------------------------------------------------------------------------

function stopFlyHoverPoll() {
  if (flyHoverTimer) {
    clearInterval(flyHoverTimer)
    flyHoverTimer = null
  }
}

function pushFlyHover(index) {
  if (index === flyHoverIndex) return
  flyHoverIndex = index
  if (!flyWin || flyWin.isDestroyed()) return
  // 悬停时收回穿透，让「点击打开」那一下真的能点到；移开立刻恢复穿透
  flyWin.setIgnoreMouseEvents(index === null)
  flyWin.webContents.send('taskflow:lightmode-hover', index)
}

function flyPollHover() {
  if (!flyWin || flyWin.isDestroyed()) {
    stopFlyHoverPoll()
    return
  }
  const pt = screen.getCursorScreenPoint()
  const win = flyWindowRect
  let hit = null
  if (win && pt.x >= win.x && pt.x <= win.x + win.width && pt.y >= win.y && pt.y <= win.y + win.height) {
    const lx = pt.x - win.x
    const ly = pt.y - win.y
    hit = flyHitRects.findIndex((r) => lx >= r.x && lx <= r.x + r.w && ly >= r.y && ly <= r.y + r.h)
    if (hit < 0) hit = null
  }
  if (hit !== null) {
    flyHoverOutside = 0
    pushFlyHover(hit)
    return
  }
  // 移出：连续两次都不在才放开，避免药丸移动时的抖动闪烁
  if (flyHoverIndex !== null) {
    flyHoverOutside += 1
    if (flyHoverOutside >= FLY_HOVER_LEAVE_SAMPLES) pushFlyHover(null)
  }
}

function startFlyHoverPoll() {
  stopFlyHoverPoll()
  flyHoverOutside = FLY_HOVER_LEAVE_SAMPLES
  flyHoverTimer = setInterval(flyPollHover, FLY_HOVER_POLL_MS)
}

/** 辅助小窗与主窗口同一套路由：dev 走 VITE_DEV_SERVER_URL，产物走 dist/index.html */
function loadHelper(win, query, hash) {
  if (isDev) {
    const qs = new URLSearchParams(query || {}).toString()
    win.loadURL(`${DEV_URL}${qs ? `?${qs}` : ''}#${hash}`)
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query, hash })
  }
}

/**
 * 屏幕顶部全宽透明窗：一条任务一个药丸，页面里用 CSS 从右往左依次滑过。
 * 高度按本次要飘的条数算（最多 FLY_MAX_TASKS 条），条数多也不会挤出屏幕。
 */
function showFlyWindow() {
  closeFlyWindow()
  try {
  const area = screen.getPrimaryDisplay().workArea
  const rows = Math.max(1, Math.min(FLY_MAX_TASKS, lightPayload.tasks.length))
  const height = rows * FLY_ROW_H + FLY_PAD
  flyWin = new BrowserWindow({
    x: area.x,
    y: area.y,
    width: area.width,
    height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    // 不可聚焦：飘条不会把焦点从别的应用抢走，但鼠标事件照常送达（点击可打开 Sloth）
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  })
  flyWin.setAlwaysOnTop(true, 'screen-saver')
  flyWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // 默认穿透：屏幕最上方这条带子不能把下层窗口的点击吃掉
  flyWin.setIgnoreMouseEvents(true)
  flyWindowRect = { x: area.x, y: area.y, width: area.width, height }

  // 每条任务 → 一行：过期标记 / 标题 / 时间标签，用不可见字符分隔（见渲染层解码）
  const encoded = lightPayload.tasks
    .slice(0, FLY_MAX_TASKS)
    .map((t) => [t.overdue ? '1' : '0', t.title, t.label].join('\u001e'))
    .join('\u001f')
  // 走 query 一律用 base64：loadFile 会对 query 再做一次 URL 规范化，
  // 直接塞 encodeURIComponent 的结果会变成「双重编码」（%1E → %251E），
  // 页面拿到的是 %251E 而不是换行分隔符 → 解析不出任何任务。
  const packed = Buffer.from(encoded, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

  loadHelper(
    flyWin,
    {
      tasks: packed,
      count: String(lightPayload.count || lightPayload.tasks.length || 0),
    },
    'lightfly'
  )

  // 透明窗的 ready-to-show 并不总会来（实测 Mac 上一直不触发，飘窗就一直处于隐藏态
  // →「任务没从桌面顶部飘过」）。改成 did-finish-load 就显示，再留 ready-to-show 兜底；
  // 用 showInactive 而不是 show：不要抢走当前应用的焦点。
  let flewIn = false
  const present = () => {
    if (!flyWin || flyWin.isDestroyed() || flewIn) return
    flewIn = true
    if (!flyWin.isVisible()) flyWin.showInactive()
    startFlyHoverPoll()
    // 关窗倒计时从真正上屏起算：页面加载花的时间不该吃掉最后一条的飘程
    const flightMs = FLY_GLIDE_MS + (rows - 1) * FLY_STAGGER_MS + FLY_TAIL_MS
    flyKillTimer = setTimeout(() => {
      flyKillTimer = null
      if (flyWin && !flyWin.isDestroyed()) flyWin.close()
    }, flightMs)
  }
  flyWin.webContents.once('did-finish-load', present)
  flyWin.once('ready-to-show', present)
  // 兜底：3 秒后还没显示就直接摆上屏（万一 did-finish-load 也没到）
  setTimeout(present, 3000)
  flyWin.on('closed', () => {
    flyWin = null
    stopFlyHoverPoll()
    if (flyKillTimer) {
      clearTimeout(flyKillTimer)
      flyKillTimer = null
    }
  })
  } catch (err) {
    console.error('[lightmode] 飘窗创建失败', err)
    flyWin = null
  }
}

/** 有「今天 / 快到期」的未完成任务才飘 */
function maybeFly() {
  if (!lightMode || !lightPayload.tasks.length) return
  showFlyWindow()
}

/** 周期拍（每 5 分钟）；首拍由 flyFirstBeatTimer 单独负责 */
function armFlyBeat() {
  if (flyBeatTimer) clearTimeout(flyBeatTimer)
  flyBeatTimer = setTimeout(() => {
    flyBeatTimer = null
    maybeFly()
    if (lightMode) armFlyBeat()
  }, LIGHT_FLY_INTERVAL_MS)
}

/** 顶栏按钮 / Dock 点击 / 飘条点击的唯一状态入口 */
function setLightMode(on) {
  const want = !!on
  if (want === lightMode) {
    pushLightState()
    return lightMode
  }
  lightMode = want
  if (lightMode) {
    // 顶部菜单栏托盘图标：轻量模式的可见入口（点它唤回主窗口）
    ensureLightTray()
    // Dock 图标是轻量模式下回到应用的唯一入口（点它 → activate → 唤回主窗口）。
    if (process.platform === 'darwin' && app.dock) app.dock.show()
    if (mainWindow && !mainWindow.isDestroyed()) {
      // 这里只做「隐藏」，不要再对窗口调 setAlwaysOnTop(true) / showInactive()。
      // 那两个调用对 macOS 来说是「改层级 + 重新前置」：窗口会被整块重新合成一次，
      // 视觉上就是点下去之后页面闪一下（实测 60fps 录屏：183ms 的渐进重绘，
      // 去掉后只剩 33ms 的一帧干净切换）。
      // 而且它们本来也没用：紧跟着的 hide() 会把窗口照旧藏掉，
      // 注释里担心的「macOS 需要可见窗口才跑 activate」从来没真正成立过
      // （hide() 之后窗口一样是不可见的），Dock 唤回走的是同一条路径。
      // Windows 没有 Dock，隐藏后任务栏也没入口了 → 收进任务栏（minimize）
      if (process.platform === 'win32') mainWindow.minimize()
      else mainWindow.hide()
    }
    armFlyBeat()
    // 立刻飘一次：待办清单是渲染层在开关切换时同步推过来的，等 20 秒才飘
    // 会让人以为功能没生效（首拍只给一点点延时，让主窗口先收干净）。
    flyFirstBeatTimer = setTimeout(() => {
      flyFirstBeatTimer = null
      maybeFly()
    }, LIGHT_FIRST_FLY_MS)
  } else {
    if (flyBeatTimer) {
      clearTimeout(flyBeatTimer)
      flyBeatTimer = null
    }
    if (flyFirstBeatTimer) {
      clearTimeout(flyFirstBeatTimer)
      flyFirstBeatTimer = null
    }
    closeFlyWindow()
    // 不清 lightPayload：渲染层会持续同步待办清单；退出时清掉会导致
    // 「退出 → 再进入」之间任务没有变化时永远飘不起来（历史 bug）。
    destroyLightTray()
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.setAlwaysOnTop(false)
      mainWindow.show()
      mainWindow.focus()
    }
  }
  pushLightState()
  return lightMode
}

function buildMenu() {
  const isMac = process.platform === 'darwin'
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about', label: '关于 Sloth' },
              { type: 'separator' },
              { role: 'hide', label: '隐藏 Sloth' },
              { role: 'hideOthers', label: '隐藏其他' },
              { role: 'unhide', label: '全部显示' },
              { type: 'separator' },
              { role: 'quit', label: '退出 Sloth' },
            ],
          },
        ]
      : []),
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新载入' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        ...(isMac ? [{ type: 'separator' }, { role: 'front', label: '前置全部窗口' }] : []),
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// --------------------------------------------------------------------------
// Lifecycle
// --------------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    migrateLegacyData()
    nativeTheme.themeSource = 'system'
    // 「工作速录」IPC / 协议 / 崩溃恢复
    registerRecorderFeature({
      getMainWindow: () => mainWindow,
      devUrl: DEV_URL,
      indexFile: path.join(__dirname, '..', 'dist', 'index.html')
    })
    buildMenu()
    createWindow()

    app.on('activate', () => {
      // 轻量模式下点 Dock 图标 = 回到正常模式并唤回主窗口
      if (lightMode) {
        setLightMode(false)
        return
      }
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('before-quit', flushNow)

// 退出前回收转写 / 降噪 worker
app.on('will-quit', disposeRecorder)

app.on('window-all-closed', () => {
  flushNow()
  if (process.platform !== 'darwin') app.quit()
})

// --------------------------------------------------------------------------
// IPC surface
// --------------------------------------------------------------------------

ipcMain.handle('taskflow:read', () => readData())
ipcMain.handle('taskflow:write', (_e, data) => {
  queueWrite(data)
  return true
})
ipcMain.handle('taskflow:flush', () => {
  flushNow()
  return true
})
ipcMain.handle('taskflow:notify', (_e, payload) => showNotification(payload))
ipcMain.handle('taskflow:badge', (_e, text) => {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setBadge(text ? String(text) : '')
  }
  return true
})
// 轻量模式：开关（顶栏按钮）/ 待办清单（渲染层推送）/ 飘条点击唤回主窗口 / 悬停命中上报
ipcMain.handle('taskflow:lightmode', (_e, on) => setLightMode(on))
ipcMain.handle('taskflow:lightmode-tasks', (_e, payload) => {
  const raw = payload && Array.isArray(payload.tasks) ? payload.tasks : []
  const tasks = raw
    .slice(0, FLY_MAX_TASKS)
    .map((t) => ({
      title: String((t && t.title) || '').slice(0, 120),
      label: String((t && t.label) || '').slice(0, 40),
      overdue: !!(t && t.overdue),
    }))
    .filter((t) => t.title)
  lightPayload = {
    tasks,
    count: payload && Number.isFinite(payload.count) ? Math.max(0, Number(payload.count)) : tasks.length,
    taskId: tasks[0] ? String(raw[0].id || '') || null : null,
  }
  // 已在轻量模式里、任务刚变成「今天/快到期」时，下一拍自然会带上它
  return true
})
// 飘条页面每帧上报各药丸在窗口内的矩形，供主进程做悬停命中
ipcMain.on('taskflow:lightmode-hit', (_e, rects) => {
  if (!Array.isArray(rects)) return
  flyHitRects = rects
    .slice(0, FLY_MAX_TASKS)
    .map((r) => ({
      x: Number(r && r.x) || 0,
      y: Number(r && r.y) || 0,
      w: Number(r && r.w) || 0,
      h: Number(r && r.h) || 0,
    }))
})
ipcMain.on('taskflow:lightmode-open', () => {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow()
  setLightMode(false)
})

ipcMain.handle('taskflow:info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  arch: process.arch,
  electron: process.versions.electron,
  userData: app.getPath('userData'),
  dataFile: dataFile(),
}))
ipcMain.handle('taskflow:reveal-data', () => {
  shell.showItemInFolder(dataFile())
  return true
})
// 工作清单导出：弹出系统保存对话框 → 返回保存路径（取消返回 null）
// format = 'xlsx' 时 content 为 base64；'csv' 时为文本
ipcMain.handle('taskflow:save-file', async (_e, payload) => {
  const { defaultName = 'export.xlsx', content = '', format = 'xlsx' } = payload ?? {}
  if (!mainWindow) return null
  const isCsv = format === 'csv'
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: isCsv ? '导出 CSV' : '导出 Excel',
    defaultPath: path.join(app.getPath('documents'), defaultName),
    filters: isCsv
      ? [{ name: 'CSV 表格', extensions: ['csv'] }]
      : [{ name: 'Excel 工作簿', extensions: ['xlsx'] }],
  })
  if (canceled || !filePath) return null
  const target = /\.[a-z]+$/i.test(filePath) ? filePath : `${filePath}.${isCsv ? 'csv' : 'xlsx'}`
  if (isCsv) fs.writeFileSync(target, content, 'utf-8')
  else fs.writeFileSync(target, Buffer.from(content, 'base64'))
  return target
})
// 工作清单导入：弹出系统打开对话框 → 返回内容（取消返回 null）
// .xlsx/.xls 以 base64 返回（type: 'xlsx'），.csv 以文本返回（type: 'csv'）
ipcMain.handle('taskflow:open-file', async (_e) => {
  if (!mainWindow) return null
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: '导入 Excel / CSV',
    properties: ['openFile'],
    filters: [{ name: 'Excel / CSV 表格', extensions: ['xlsx', 'xls', 'csv'] }],
  })
  if (canceled || !filePaths?.[0]) return null
  const p = filePaths[0]
  const name = path.basename(p)
  if (/\.csv$/i.test(name)) return { name, content: fs.readFileSync(p, 'utf-8'), type: 'csv' }
  return { name, content: fs.readFileSync(p).toString('base64'), type: 'xlsx' }
})
ipcMain.handle('taskflow:window', (_e, action) => {
  if (!mainWindow) return false
  if (action === 'minimize') mainWindow.minimize()
  if (action === 'maximize') {
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  }
  if (action === 'close') mainWindow.close()
  return true
})
