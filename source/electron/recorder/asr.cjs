'use strict'

const { ipcMain } = require('electron')
const { IPC } = require('./channels.cjs')
const { checkAsrAvailability } = require('./asr-models.cjs')
const { asrService } = require('./asr-service.cjs')
const { fileAsrService } = require('./file-asr-service.cjs')
const { updateMeta } = require('./library.cjs')

function registerAsrIpc() {
  ipcMain.handle(IPC.asrAvailability, () => checkAsrAvailability())

  ipcMain.handle(IPC.asrStart, async (e) => {
    const availability = checkAsrAvailability()
    if (!availability.available) {
      throw new Error(availability.message ?? '转写模型不可用')
    }
    await asrService.start(e.sender)
  })

  // 高频、单向：PCM 分片直接投递给 utilityProcess，不走 invoke。
  ipcMain.on(IPC.asrFeed, (_e, samples, sampleRate) => {
    try {
      asrService.feed(samples, sampleRate)
    } catch (err) {
      console.error('asr feed 异常', err)
    }
  })

  ipcMain.handle(IPC.asrStop, () => asrService.stop())

  ipcMain.handle(IPC.asrSaveTranscript, (_e, id, transcript) => updateMeta(id, { transcript }))

  // 资料库「语音转文字」：立即返回，结果靠 asr:file-partial 持续回推
  ipcMain.handle(IPC.asrTranscribeFile, (e, id) => fileAsrService.start(String(id), e.sender))

  ipcMain.handle(IPC.asrTranscribeCancel, (_e, id) => fileAsrService.cancel(String(id)))

  ipcMain.handle(IPC.asrTranscribeList, () => fileAsrService.list())
}

module.exports = { registerAsrIpc }
