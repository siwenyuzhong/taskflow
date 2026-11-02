'use strict'

/**
 * 降噪 Worker —— 运行在 Electron `utilityProcess` 中的离线降噪进程。
 *
 * 只用 Node API，不碰 Electron 窗口：
 *  - 接收父进程发来的 16kHz 单声道 Float32 PCM 分片并累积；
 *  - 收到 finish 时合并整段送入 GTCRN（OfflineSpeechDenoiser）一次性降噪；
 *  - 回传降噪后的 PCM（仍为 16kHz 单声道），由主进程落盘。
 *
 * 采用「累积 -> 一次性降噪」而非流式：质量更稳定，且降噪属于后期处理，
 * 无须实时。依赖进程唯一入口 `process.parentPort`。
 */

const { OfflineSpeechDenoiser } = require('sherpa-onnx-node')

const TARGET_SR = 16000

const parentPort = process.parentPort

let denoiser = null
let modelId = ''
/** 累积的 16kHz PCM 分片。 */
let chunks = []
let totalSamples = 0

function post(message) {
  parentPort.postMessage(message)
}

function init(msg) {
  if (denoiser) return
  denoiser = new OfflineSpeechDenoiser({
    model: {
      gtcrn: { model: msg.model },
      numThreads: msg.numThreads ?? 2,
      debug: 0,
      provider: 'cpu'
    }
  })
  modelId = msg.modelId
  post({ type: 'ready', model: modelId, sampleRate: denoiser.sampleRate })
}

function feed(samples, sampleRate) {
  if (!denoiser) return
  // 模型只接受 16kHz；主进程/渲染进程已按 16kHz 推送，这里做一次兜底。
  if (sampleRate !== TARGET_SR) {
    post({ type: 'error', message: `降噪仅支持 16kHz 输入（收到 ${sampleRate}）` })
    return
  }
  chunks.push(samples)
  totalSamples += samples.length
}

function reset() {
  chunks = []
  totalSamples = 0
}

function finish() {
  if (!denoiser) {
    post({ type: 'error', message: '降噪引擎未初始化' })
    return
  }
  if (totalSamples === 0) {
    post({ type: 'result', samples: new Float32Array(0), sampleRate: TARGET_SR })
    return
  }

  const input = new Float32Array(totalSamples)
  let offset = 0
  for (const c of chunks) {
    input.set(c, offset)
    offset += c.length
  }
  chunks = []
  totalSamples = 0

  // enableExternalBuffer:false —— 返回普通 Float32Array，避免 Electron
  // 结构化克隆报「External buffers are not allowed」。
  const out = denoiser.run({ samples: input, sampleRate: TARGET_SR, enableExternalBuffer: false })
  // 再复制一次：即便底层仍返回外部缓冲，也能安全跨进程传递。
  const samples = new Float32Array(out.samples)
  post({ type: 'result', samples, sampleRate: out.sampleRate || TARGET_SR })
}

parentPort.on('message', (e) => {
  const msg = e.data
  try {
    switch (msg.type) {
      case 'init':
        init(msg)
        break
      case 'feed':
        feed(msg.samples, msg.sampleRate)
        break
      case 'reset':
        reset()
        break
      case 'finish':
        finish()
        break
      case 'dispose':
        process.exit(0)
        break
    }
  } catch (err) {
    post({ type: 'error', message: err.message })
  }
})
