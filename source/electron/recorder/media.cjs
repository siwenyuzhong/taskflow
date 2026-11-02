'use strict'

/**
 * 媒体探测工具（主进程）。
 *
 * MediaRecorder 产出的 webm 不写容器时长（`ffmpeg -i` 显示 `Duration: N/A`），
 * 只能解码一遍从进度输出里取 `time=`。用于崩溃恢复条目的时长回填——
 * 正常停止的录音由渲染进程计时给出 durationMs，不走这里。
 */
const { execFile } = require('child_process')
const { resolveFfmpegPath } = require('./resources.cjs')
/** 可执行 ffmpeg 路径（打包后指向 asar 解包副本） */
const ffmpegPath = resolveFfmpegPath()

function probeDurationMs(file) {
  return new Promise((resolve) => {
    if (!ffmpegPath) return resolve(0)
    execFile(
      ffmpegPath,
      ['-hide_banner', '-nostats', '-i', file, '-f', 'null', '-'],
      { timeout: 30000, maxBuffer: 1024 * 1024 * 8 },
      (_err, stdout, stderr) => {
        // 取最后一个 time=（进度行可能覆盖多次）
        const matches = String(`${stdout}${stderr}`).match(/time=(\d+):(\d\d):(\d\d(?:\.\d+)?)/g)
        const last = matches?.[matches.length - 1]
        const m = last ? /time=(\d+):(\d\d):(\d\d(?:\.\d+)?)/.exec(last) : null
        if (!m) return resolve(0)
        resolve(Number(m[1]) * 3600000 + Number(m[2]) * 60000 + Math.round(Number(m[3]) * 1000))
      }
    )
  })
}

/**
 * 读取音频文件时长（毫秒）。无法探测时返回 0。
 * 对截断 / 尾部损坏的文件仍然返回已解码部分的时长，符合恢复场景「有多少算多少」。
 */
async function measureAudioDurationMs(file) {
  try {
    return await probeDurationMs(file)
  } catch {
    return 0
  }
}

module.exports = { measureAudioDurationMs }
