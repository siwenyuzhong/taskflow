'use strict'

/**
 * ASR Worker —— 运行在 Electron `utilityProcess` 中的离线流式转写进程。
 *
 * 只用 Node API，不碰 Electron 窗口：
 *  - 接收父进程发来的 16kHz 单声道 Float32 PCM 分片；
 *  - 用 sherpa-onnx OnlineRecognizer（Zipformer2 中文流式，2025-06-30）做增量识别；
 *  - 用 Silero VAD 做语音/静音判定，结束时给出静音区间；
 *  - 回传增量文本（partial）与整段结果（final）。
 *
 * 依赖进程唯一入口 `process.parentPort`。
 */

const { OnlineRecognizer, Vad } = require('sherpa-onnx-node')

const TARGET_SR = 16000
const MIN_SILENCE_MS = 400

const parentPort = process.parentPort

let recognizer = null
let stream = null
let vad = null
let modelId = ''

let processedSamples = 0
let segStartSample = 0
let pending = ''
let segments = []
let speechSpans = []
let lastSpeech = false

// --- 说话人区分（轻量在线聚类，基于基频）---
// 没有专用声纹模型时，用每句话的基频中位数做在线聚类：音高差异明显的人（如男女）
// 会被分到不同「说话人」；同性别、音高相近的人可能合并，属已知局限。
let utteranceChunks = []
let utteranceSamples = 0
let pendingSpeaker = null
let activeSpeaker = null
let lastProbeSamples = 0
const speakerCentroids = []
const MAX_SPEAKERS = 3
/** 相对音高差阈值：小于它视为同一说话人 */
const SPEAKER_SIM = 0.16
/** 说话过程中约每 1s 探一次，实时给出说话人标签 */
const PROBE_STEP = TARGET_SR

function post(message) {
  parentPort.postMessage(message)
}

function msOf(samples) {
  return Math.round((samples / TARGET_SR) * 1000)
}

function resampleLinear(input, fromRate) {
  if (fromRate === TARGET_SR) return input
  const ratio = fromRate / TARGET_SR
  const outLength = Math.floor(input.length / ratio)
  const out = new Float32Array(outLength)
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(i0 + 1, input.length - 1)
    const frac = pos - i0
    out[i] = input[i0] * (1 - frac) + input[i1] * frac
  }
  return out
}

function fullText() {
  return [...segments.map((s) => s.text), pending].filter(Boolean).join('')
}

function concatChunks(chunks) {
  if (chunks.length === 0) return new Float32Array(0)
  if (chunks.length === 1) return chunks[0]
  let total = 0
  for (const c of chunks) total += c.length
  const out = new Float32Array(total)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  return out
}

/** 当前语句末尾 seconds 秒的音频（用于基频估计 / 实时探测） */
function recentSamples(seconds) {
  const all = concatChunks(utteranceChunks)
  const want = TARGET_SR * seconds
  return all.length > want ? all.subarray(all.length - want) : all
}

/**
 * 估计基频（Hz）：1024 点帧 + 归一化自相关，取各帧的中位数。
 * 取「第一个足够强的局部峰」以减少把周期整数倍误当基频（八度偏低）的错误；
 * 无可信基频时返回 0。
 */
function estimatePitch(samples) {
  const sr = TARGET_SR
  const frame = 1024
  const hop = 512
  if (!samples || samples.length < frame) return 0
  const minLag = Math.max(2, Math.floor(sr / 380))
  const maxLag = Math.min(samples.length - 1, Math.floor(sr / 70))
  const n = samples.length - maxLag
  if (n <= 0 || maxLag <= minLag) return 0

  const pitches = []
  for (let start = 0; start + frame <= samples.length; start += hop) {
    let mean = 0
    for (let i = 0; i < frame; i += 1) mean += samples[start + i]
    mean /= frame
    let energy = 0
    for (let i = 0; i < frame; i += 1) {
      const v = samples[start + i] - mean
      energy += v * v
    }
    if (Math.sqrt(energy / frame) < 0.01) continue // 静音 / 低能量帧

    let maxVal = 0
    const corr = new Float32Array(maxLag + 1)
    for (let lag = minLag; lag <= maxLag; lag += 1) {
      let acc = 0
      for (let i = 0; i < n; i += 1) {
        acc += (samples[start + i] - mean) * (samples[start + i + lag] - mean)
      }
      corr[lag] = acc
      if (acc > maxVal) maxVal = acc
    }
    if (maxVal <= 1e-6) continue

    let chosen = -1
    for (let lag = minLag + 1; lag < maxLag; lag += 1) {
      if (corr[lag] >= corr[lag - 1] && corr[lag] >= corr[lag + 1] && corr[lag] >= 0.82 * maxVal) {
        chosen = lag
        break
      }
    }
    if (chosen < 0) {
      for (let lag = minLag; lag <= maxLag; lag += 1) {
        if (corr[lag] === maxVal) {
          chosen = lag
          break
        }
      }
    }
    if (chosen > 0) pitches.push(sr / chosen)
  }

  if (pitches.length === 0) return 0
  pitches.sort((a, b) => a - b)
  return pitches[Math.floor(pitches.length / 2)]
}

/** 只在已有说话人里找最近的（不新建），用于说话过程中的实时标签 */
function classifyPitch(hz) {
  if (!hz) return null
  let best = -1
  let bestRel = Infinity
  for (let i = 0; i < speakerCentroids.length; i += 1) {
    const rel = Math.abs(hz - speakerCentroids[i].hz) / speakerCentroids[i].hz
    if (rel < bestRel) {
      bestRel = rel
      best = i
    }
  }
  return best >= 0 && bestRel <= SPEAKER_SIM ? best : null
}

function updateCentroid(index, hz) {
  const c = speakerCentroids[index]
  c.hz = (c.hz * c.weight + hz) / (c.weight + 1)
  c.weight += 1
}

/** 句子结束时定稿说话人：够近就归入并更新质心，否则新建（上限 MAX_SPEAKERS） */
function assignSpeaker(hz) {
  if (!hz) return activeSpeaker
  let best = -1
  let bestRel = Infinity
  for (let i = 0; i < speakerCentroids.length; i += 1) {
    const rel = Math.abs(hz - speakerCentroids[i].hz) / speakerCentroids[i].hz
    if (rel < bestRel) {
      bestRel = rel
      best = i
    }
  }
  if (best >= 0 && bestRel <= SPEAKER_SIM) {
    updateCentroid(best, hz)
    activeSpeaker = best
    return best
  }
  if (speakerCentroids.length < MAX_SPEAKERS) {
    speakerCentroids.push({ hz, weight: 1 })
    activeSpeaker = speakerCentroids.length - 1
    return activeSpeaker
  }
  if (best >= 0) {
    updateCentroid(best, hz)
    activeSpeaker = best
    return best
  }
  return activeSpeaker
}

function flushUtterance() {
  const text = pending.trim()
  const speaker = assignSpeaker(estimatePitch(recentSamples(4)))
  if (text) {
    segments.push({
      startMs: msOf(segStartSample),
      endMs: msOf(processedSamples),
      text,
      speaker
    })
  }
  pending = ''
  pendingSpeaker = speaker
  utteranceChunks = []
  utteranceSamples = 0
  lastProbeSamples = 0
}

function drainVad() {
  if (!vad) return
  while (!vad.isEmpty()) {
    // 传 false：返回普通 Float32Array，避免 Electron 中「External buffers are not allowed」
    const seg = vad.front(false)
    speechSpans.push({ start: seg.start, end: seg.start + seg.samples.length })
    vad.pop()
  }
}

function computeSilences() {
  const spans = [...speechSpans].sort((a, b) => a.start - b.start)
  const out = []
  let cursor = 0
  const minGap = (TARGET_SR * MIN_SILENCE_MS) / 1000
  for (const sp of spans) {
    if (sp.start - cursor > minGap) out.push({ startMs: msOf(cursor), endMs: msOf(sp.start) })
    cursor = Math.max(cursor, sp.end)
  }
  if (processedSamples - cursor > minGap) {
    out.push({ startMs: msOf(cursor), endMs: msOf(processedSamples) })
  }
  return out
}

function emitPartial() {
  post({
    type: 'partial',
    text: fullText(),
    segments,
    pending,
    pendingSpeaker,
    silence: vad ? !vad.isDetected() : false
  })
}

function init(msg) {
  if (recognizer) return
  recognizer = new OnlineRecognizer({
    featConfig: { sampleRate: TARGET_SR, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: msg.models.encoder,
        decoder: msg.models.decoder,
        joiner: msg.models.joiner
      },
      tokens: msg.models.tokens,
      numThreads: msg.numThreads ?? 2,
      provider: 'cpu',
      debug: 0,
      // 2025-06-30 的中文流式模型为 zipformer2（large）架构，
      // 用 'zipformer' 会在 InitEncoder 取 attention_dims 时崩溃。
      modelType: 'zipformer2'
    },
    // 束搜索比贪心略准，实测实时率仍远低于 1（约 0.05），可放心使用
    decodingMethod: 'modified_beam_search',
    maxActivePaths: 4,
    enableEndpoint: true,
    rule1MinTrailingSilence: 2.4,
    rule2MinTrailingSilence: 1.2,
    rule3MinUtteranceLength: 20
  })
  stream = recognizer.createStream()
  vad = new Vad(
    {
      sileroVad: {
        model: msg.models.vad,
        threshold: 0.5,
        minSilenceDuration: 0.25,
        minSpeechDuration: 0.25,
        windowSize: 512,
        maxSpeechDuration: 8
      },
      sampleRate: TARGET_SR,
      numThreads: 1,
      provider: 'cpu',
      debug: 0
    },
    60
  )
  modelId = msg.modelId
  post({ type: 'ready', model: modelId })
}

function feed(samples, sampleRate) {
  if (!recognizer || !stream) return
  const s = resampleLinear(samples, sampleRate)
  processedSamples += s.length
  utteranceChunks.push(s)
  utteranceSamples += s.length

  stream.acceptWaveform({ samples: s, sampleRate: TARGET_SR })
  while (recognizer.isReady(stream)) recognizer.decode(stream)
  pending = recognizer.getResult(stream).text || ''

  if (vad) {
    vad.acceptWaveform(s)
    drainVad()
    const speechNow = vad.isDetected()
    if (speechNow !== lastSpeech) {
      lastSpeech = speechNow
      post({ type: 'speech', speech: speechNow })
    }
  }

  // 说话过程中周期性探测说话人，让字幕 / 面板能实时标注「谁在说」
  if (utteranceSamples - lastProbeSamples >= PROBE_STEP) {
    lastProbeSamples = utteranceSamples
    const idx = classifyPitch(estimatePitch(recentSamples(2)))
    if (idx !== null) pendingSpeaker = idx
  }

  if (recognizer.isEndpoint(stream)) {
    flushUtterance()
    recognizer.reset(stream)
    segStartSample = processedSamples
  }

  emitPartial()
}

function finalize() {
  if (recognizer && stream) {
    stream.acceptWaveform({ samples: new Float32Array(0), sampleRate: TARGET_SR })
    stream.inputFinished()
    while (recognizer.isReady(stream)) recognizer.decode(stream)
    pending = recognizer.getResult(stream).text || pending
    flushUtterance()
  }
  if (vad) {
    vad.flush()
    drainVad()
  }
  const transcript = {
    text: fullText(),
    segments,
    silences: computeSilences(),
    model: modelId,
    createdAt: Date.now()
  }
  post({ type: 'final', transcript })
}

function reset() {
  segments = []
  speechSpans = []
  pending = ''
  processedSamples = 0
  segStartSample = 0
  lastSpeech = false
  utteranceChunks = []
  utteranceSamples = 0
  pendingSpeaker = null
  activeSpeaker = null
  lastProbeSamples = 0
  speakerCentroids.length = 0
  if (recognizer && stream) recognizer.reset(stream)
  if (vad) vad.reset()
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
      case 'finalize':
        finalize()
        break
      case 'reset':
        reset()
        break
      case 'dispose':
        process.exit(0)
        break
    }
  } catch (err) {
    post({ type: 'error', message: err.message })
  }
})
