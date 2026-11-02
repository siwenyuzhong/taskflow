'use strict'

const { app, BrowserWindow, dialog, ipcMain } = require('electron')
const { execFile } = require('child_process')
const { mkdtempSync, rmSync, writeFileSync, copyFileSync } = require('fs')
const { join } = require('path')
const { resolveFfmpegPath } = require('./resources.cjs')
/** 可执行 ffmpeg 路径（打包后指向 asar 解包副本） */
const ffmpegPath = resolveFfmpegPath()
const { IPC } = require('./channels.cjs')
const {
  measureLoudnorm,
  loudnormFilter,
  normalizeWavLoudness,
  readWavSampleRate
} = require('./loudness.cjs')

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('未找到内置 ffmpeg'))
    execFile(ffmpegPath, args, { maxBuffer: 1024 * 1024 * 32 }, (err, _stdout, stderr) => {
      if (err) reject(new Error(String(stderr || err.message)))
      else resolve()
    })
  })
}

const FILTERS = {
  wav: [{ name: 'WAV 音频', extensions: ['wav'] }],
  mp3: [{ name: 'MP3 音频', extensions: ['mp3'] }]
}

function registerFileIpc() {
  ipcMain.handle(
    IPC.fileExportAudio,
    async (e, defaultName, format, wavData, loudness = 'off') => {
      const win = BrowserWindow.fromWebContents(e.sender)
      const result = await dialog.showSaveDialog(win ?? undefined, {
        defaultPath: defaultName,
        filters: FILTERS[format] ?? FILTERS.wav
      })
      if (result.canceled || !result.filePath) return null

      const tmpDir = mkdtempSync(join(app.getPath('temp'), 'speedrec-export-'))
      const tmpWav = join(tmpDir, 'source.wav')
      writeFileSync(tmpWav, Buffer.from(wavData))

      const normalize = loudness !== 'off'
      // loudnorm 会把内部 192kHz 处理结果带到输出，导出时回到源采样率
      const sourceRate = readWavSampleRate(wavData) ?? 48000
      const target = Number(loudness)

      try {
        if (format === 'wav') {
          if (normalize) {
            // 两段式 loudnorm：先测量，再施加，输出 16-bit WAV。
            await normalizeWavLoudness(tmpWav, result.filePath, target, sourceRate)
          } else {
            copyFileSync(tmpWav, result.filePath)
          }
        } else {
          const args = ['-y', '-i', tmpWav]
          if (normalize) {
            const measure = await measureLoudnorm(tmpWav, target)
            args.push('-af', loudnormFilter(measure, target), '-ar', String(sourceRate))
          }
          args.push('-codec:a', 'libmp3lame', '-b:a', '192k', result.filePath)
          await runFfmpeg(args)
        }
        return result.filePath
      } finally {
        rmSync(tmpDir, { recursive: true, force: true })
      }
    }
  )
}

module.exports = { registerFileIpc }
