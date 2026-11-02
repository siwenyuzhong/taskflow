'use strict'

/**
 * 响度标准化：ffmpeg `loudnorm`（EBU R128）两段式。
 *
 * 第一遍只测量（print_format=json 输出集成响度 / 真实峰值 / 响度范围），
 * 第二遍代入测得的参数做精确施加，输出达标响度（如 -16 / -14 LUFS）。
 * 测量失败时回退到单遍 loudnorm，保证功能不中断。
 */
const { execFile } = require('child_process')
const { resolveFfmpegPath } = require('./resources.cjs')
/** 可执行 ffmpeg 路径（打包后指向 asar 解包副本） */
const ffmpegPath = resolveFfmpegPath()

/**
 * 运行内置 ffmpeg 并返回合并输出。
 * 注意：`loudnorm print_format=json` 把测量结果写在 **stderr**，
 * 而输出音频走 `-f null -`，故 stdout 基本为空。
 */
function runFfmpegCapture(args) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('未找到内置 ffmpeg'))
    execFile(ffmpegPath, args, { maxBuffer: 1024 * 1024 * 32 }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr || err.message)))
      else resolve(`${stdout}${stderr}`)
    })
  })
}

/** 第一遍测量：返回集成响度参数；失败返回 null（由调用方回退单遍）。 */
async function measureLoudnorm(input, target) {
  try {
    const output = await runFfmpegCapture([
      '-nostats',
      '-hide_banner',
      '-y',
      '-i',
      input,
      '-af',
      `loudnorm=I=${target}:TP=-1.5:LRA=11:print_format=json`,
      '-f',
      'null',
      '-'
    ])
    const start = output.indexOf('{')
    const end = output.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    const m = JSON.parse(output.slice(start, end + 1))
    const num = (v) => Number(v)
    return {
      input_i: num(m.input_i),
      input_tp: num(m.input_tp),
      input_lra: num(m.input_lra),
      input_thresh: num(m.input_thresh),
      offset: m.target_offset === undefined ? -0.5 : num(m.target_offset)
    }
  } catch {
    return null
  }
}

/** 组装第二遍的 loudnorm 滤波字符串。 */
function loudnormFilter(measure, target) {
  if (!measure) return `loudnorm=I=${target}:TP=-1.5:LRA=11`
  return [
    `loudnorm=I=${target}`,
    'TP=-1.5',
    'LRA=11',
    `measured_I=${measure.input_i}`,
    `measured_TP=${measure.input_tp}`,
    `measured_LRA=${measure.input_lra}`,
    `measured_thresh=${measure.input_thresh}`,
    `offset=${measure.offset}`
  ].join(':')
}

/**
 * 读取我们自产的 16-bit WAV 头的采样率（固定 44 字节头，fmt size 16）。
 * 非标准头 / 不匹配时返回 null。
 */
function readWavSampleRate(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.byteLength < 44) return null
  const tag = (o) =>
    String.fromCharCode(view.getUint8(o), view.getUint8(o + 1), view.getUint8(o + 2), view.getUint8(o + 3))
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE' || tag(12) !== 'fmt ') return null
  if (view.getUint32(16, true) < 16) return null
  const rate = view.getUint32(24, true)
  return rate > 0 ? rate : null
}

/** 把 WAV 标准化为指定 LUFS，写为 WAV。 */
async function normalizeWavLoudness(input, output, target, sampleRate) {
  const measure = await measureLoudnorm(input, target)
  const args = ['-nostats', '-hide_banner', '-y', '-i', input, '-af', loudnormFilter(measure, target)]
  // loudnorm 内部按 192kHz 处理并把该采样率带到输出，需显式回到源采样率。
  if (sampleRate) args.push('-ar', String(sampleRate))
  args.push('-codec:a', 'pcm_s16le', output)
  await runFfmpegCapture(args)
}

module.exports = {
  measureLoudnorm,
  loudnormFilter,
  readWavSampleRate,
  normalizeWavLoudness
}
