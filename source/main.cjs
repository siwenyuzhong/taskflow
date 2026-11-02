'use strict'

const { app, BrowserWindow, dialog, ipcMain, Notification, Menu, shell, nativeTheme, screen } = require('electron')
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
// 开启后主窗口收起（macOS 同时确保 Dock 图标可见），由主进程按节拍在屏幕
// 顶部开一个透明置顶小窗，把「今天 / 快到期」的未完成任务摘要从右到左飘过去；
// 渲染层只负责算出待办摘要（`taskflow:lightmode-tasks`），飘窗内容与节奏都在
// 这里。点 Dock 图标或点飘条本身都会退出轻量模式并唤回主窗口。
// --------------------------------------------------------------------------

/** 进入轻量模式后第一次飘过的延时：先让用户确认功能生效（冒烟测试可用环境变量压到 1s） */
const LIGHT_FIRST_FLY_MS = Number(process.env.SLOTH_LIGHT_FIRST_FLY_MS) || 20_000
/** 之后的重复间隔（同上，可覆盖） */
const LIGHT_FLY_INTERVAL_MS = Number(process.env.SLOTH_LIGHT_FLY_INTERVAL_MS) || 5 * 60_000
/** 飘窗兜底存活时长（渲染层动画 10.5s，留出余量） */
const LIGHT_FLY_TTL_MS = 12_000

let lightMode = false
/** 渲染层推送的待办摘要；message 为空 = 没有需要提醒的任务，不飘 */
let lightPayload = { message: '', count: 0, taskId: null }
/** @type {BrowserWindow | null} */
let flyWin = null
let flyBeatTimer = null
let flyKillTimer = null

function pushLightState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('taskflow:lightmode-state', lightMode)
  }
}

function closeFlyWindow() {
  if (flyKillTimer) {
    clearTimeout(flyKillTimer)
    flyKillTimer = null
  }
  if (flyWin && !flyWin.isDestroyed()) flyWin.close()
  flyWin = null
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

/** 屏幕顶部全宽透明窗：飘条在页面里用 CSS 从右往左滑过，合成器动画不掉帧 */
function showFlyWindow() {
  closeFlyWindow()
  const area = screen.getPrimaryDisplay().workArea
  flyWin = new BrowserWindow({
    x: area.x,
    y: area.y,
    width: area.width,
    height: 72,
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

  loadHelper(
    flyWin,
    {
      message: String(lightPayload.message).slice(0, 300),
      count: String(lightPayload.count || 0),
      taskId: lightPayload.taskId ? String(lightPayload.taskId) : '',
    },
    'lightfly'
  )

  flyWin.once('ready-to-show', () => {
    if (flyWin && !flyWin.isDestroyed()) flyWin.showInactive()
  })
  flyWin.on('closed', () => {
    flyWin = null
    if (flyKillTimer) {
      clearTimeout(flyKillTimer)
      flyKillTimer = null
    }
  })
  flyKillTimer = setTimeout(() => {
    flyKillTimer = null
    if (flyWin && !flyWin.isDestroyed()) flyWin.close()
  }, LIGHT_FLY_TTL_MS)
}

/** 有「今天 / 快到期」的未完成任务才飘 */
function maybeFly() {
  if (!lightMode || !lightPayload.message) return
  showFlyWindow()
}

/** 下一拍（首拍 20s，其后每 5 分钟）；只有在轻量模式里才会继续滚下去 */
function armFlyBeat(first) {
  if (flyBeatTimer) clearTimeout(flyBeatTimer)
  flyBeatTimer = setTimeout(() => {
    flyBeatTimer = null
    maybeFly()
    if (lightMode) armFlyBeat(false)
  }, first ? LIGHT_FIRST_FLY_MS : LIGHT_FLY_INTERVAL_MS)
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
    // Dock 图标保持可见：轻量模式下它是回来的唯一入口
    if (process.platform === 'darwin' && app.dock) app.dock.show()
    if (mainWindow && !mainWindow.isDestroyed()) {
      // Windows 没有 Dock，隐藏后任务栏也没入口了 → 收进任务栏（minimize）；
      // macOS 收干净（hide），只留 Dock 图标
      if (process.platform === 'win32') mainWindow.minimize()
      else mainWindow.hide()
    }
    armFlyBeat(true)
  } else {
    if (flyBeatTimer) {
      clearTimeout(flyBeatTimer)
      flyBeatTimer = null
    }
    closeFlyWindow()
    lightPayload = { message: '', count: 0, taskId: null }
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
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
// 轻量模式：开关（顶栏按钮）/ 待办摘要（渲染层推送）/ 飘条点击唤回主窗口
ipcMain.handle('taskflow:lightmode', (_e, on) => setLightMode(on))
ipcMain.handle('taskflow:lightmode-tasks', (_e, payload) => {
  const message = payload && payload.message ? String(payload.message).slice(0, 300) : ''
  lightPayload = {
    message,
    count: payload && Number.isFinite(payload.count) ? Math.max(0, Number(payload.count)) : 0,
    taskId: payload && payload.taskId ? String(payload.taskId) : null,
  }
  // 已在轻量模式里、任务刚变成「今天/快到期」时，下一拍自然会带上它
  return true
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
