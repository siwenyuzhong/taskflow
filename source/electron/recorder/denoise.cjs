'use strict'

const { ipcMain } = require('electron')
const { existsSync, rmSync, statSync, writeFileSync } = require('fs')
const { join } = require('path')
const { IPC } = require('./channels.cjs')
const { DENOISE_MODEL_ID, checkDenoiseAvailability } = require('./denoise-models.cjs')
const { denoiseService } = require('./denoise-service.cjs')
const { encodeWav16Mono } = require('./denoise-wav.cjs')
const { recordingDir } = require('./paths.cjs')
const { readMeta, updateMeta } = require('./library.cjs')

/** 降噪产物的固定文件名（与原始文件并存，便于「还原原声」）。 */
const DENOISED_FILE = 'audio.denoised.wav'

function registerDenoiseIpc() {
  ipcMain.handle(IPC.denoiseAvailability, () => checkDenoiseAvailability())

  ipcMain.handle(IPC.denoiseStart, async (e) => {
    const availability = checkDenoiseAvailability()
    if (!availability.available) {
      throw new Error(availability.message ?? '降噪模型不可用')
    }
    await denoiseService.start(e.sender)
  })

  // 高频、单向：PCM 分片直接投递给 utilityProcess，不走 invoke。
  ipcMain.on(IPC.denoiseFeed, (_e, samples, sampleRate) => {
    try {
      denoiseService.feed(samples, sampleRate)
    } catch (err) {
      console.error('denoise feed 异常', err)
    }
  })

  ipcMain.handle(IPC.denoiseFinish, async (_e, id) => {
    const dir = recordingDir(id)
    const meta = readMeta(dir)
    if (!meta) return null

    const result = await denoiseService.finish()
    if (!result || result.samples.length === 0) return null

    const wav = encodeWav16Mono(result.samples, result.sampleRate)
    writeFileSync(join(dir, DENOISED_FILE), wav)

    // 非破坏：原始文件名只记录一次，audioFile 指向降噪版本。
    return updateMeta(id, {
      originalAudioFile: meta.originalAudioFile ?? meta.audioFile,
      originalMimeType: meta.originalMimeType ?? meta.mimeType,
      audioFile: DENOISED_FILE,
      mimeType: 'audio/wav',
      bytes: statSync(join(dir, DENOISED_FILE)).size,
      hasDenoised: true,
      denoiseModel: DENOISE_MODEL_ID
    })
  })

  ipcMain.handle(IPC.denoiseRevert, (_e, id) => {
    const dir = recordingDir(id)
    const meta = readMeta(dir)
    if (!meta || !meta.hasDenoised || !meta.originalAudioFile) return meta

    const original = join(dir, meta.originalAudioFile)
    if (!existsSync(original)) return meta

    const denoised = join(dir, DENOISED_FILE)
    if (existsSync(denoised)) rmSync(denoised, { force: true })

    return updateMeta(id, {
      audioFile: meta.originalAudioFile,
      mimeType: meta.originalMimeType ?? meta.mimeType,
      bytes: statSync(original).size,
      hasDenoised: false,
      denoiseModel: undefined,
      originalAudioFile: undefined,
      originalMimeType: undefined
    })
  })
}

module.exports = { DENOISED_FILE, registerDenoiseIpc }
