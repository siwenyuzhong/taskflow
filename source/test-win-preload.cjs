'use strict'
// 测试专用：模拟 Windows 平台的 preload
const { contextBridge } = require('electron')
contextBridge.exposeInMainWorld('taskflow', {
  platform: 'win32',
  read: async () => null,
  write: async () => true,
  notify: async () => true,
  badge: async () => true,
  info: async () => ({ platform: 'win32', version: '1.0.0' }),
  revealData: async () => true,
  onFocusTask: () => () => {},
})
