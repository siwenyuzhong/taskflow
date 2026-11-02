'use strict'

/**
 * 后台「语音转文字」Worker —— 把资料库里已存在的录音离线转写。
 *
 * 与实时录制的 `asr-worker.cjs` 完全分开，避免影响正在进行的录制。
 *
 * 一个进程内并发多条任务：实测同一个 OnlineRecognizer 上多条流交替解码互不污染
 * （不同音频各自结果与单流解码完全一致），所以共享一个模型实例即可，
 * 常驻内存约 450MB 且不随任务数增长。
 *
 * 协议（父进程 → 本进程）：
 *  - {type:'init', modelId, models, numThreads}
 *  - {type:'open', id}
 *  - {type:'chunk', id, samples, sampleRate}   一段 PCM（父进程按回执节流投递）
 *  - {type:'finish', id}                        该任务音频喂完，出最终结果
 *  - {type:'close', id}                          取消 / 释放
 *  - {type:'dispose'}
 *
 * 回传：ready / opened / partial{id,text,segments,pending,processedMs} / final{id,transcript} / error
 */

const { OnlineRecognizer, Vad } = require('sherpa-onnx-node')

const TARGET_SR = 16000
const MIN_SILENCE_MS = 400

const parentPort = process.parentPort

let recognizer = null
let vadConfig = null
let modelId = ''

/** @type {Map<string, any>} */
const sessions = new Map()

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

function fullText(s) {
  return [...s.segments.map((x) => x.text), s.pending].filter(Boolean).join('')
}

function flushUtterance(s) {
  const text = s.pending.trim()
  if (text) {
    s.segments.push({
      startMs: msOf(s.segStartSample),
      endMs: msOf(s.processedSamples),
      text
    })
  }
  s.pending = ''
}

function drainVad(s) {
  if (!s.vad) return
  while (!s.vad.isEmpty()) {
    // 传 false：返回普通 Float32Array，避免「External buffers are not allowed」
    const seg = s.vad.front(false)
    s.speechSpans.push({ start: seg.start, end: seg.start + seg.samples.length })
    s.vad.pop()
  }
}

function computeSilences(s) {
  const spans = [...s.speechSpans].sort((a, b) => a.start - b.start)
  const out = []
  let cursor = 0
  const minGap = (TARGET_SR * MIN_SILENCE_MS) / 1000
  for (const sp of spans) {
    if (sp.start - cursor > minGap) out.push({ startMs: msOf(cursor), endMs: msOf(sp.start) })
    cursor = Math.max(cursor, sp.end)
  }
  if (s.processedSamples - cursor > minGap) {
    out.push({ startMs: msOf(cursor), endMs: msOf(s.processedSamples) })
  }
  return out
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
      // 2025-06-30 的中文流式模型为 zipformer2（large）架构
      modelType: 'zipformer2'
    },
    decodingMethod: 'modified_beam_search',
    maxActivePaths: 4,
    enableEndpoint: true,
    rule1MinTrailingSilence: 2.4,
    rule2MinTrailingSilence: 1.2,
    rule3MinUtteranceLength: 20
  })
  vadConfig = {
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
  }
  modelId = msg.modelId
  post({ type: 'ready', model: modelId })
}

function open(msg) {
  if (!recognizer) throw new Error('转写引擎尚未就绪')
  if (sessions.has(msg.id)) return
  sessions.set(msg.id, {
    id: msg.id,
    stream: recognizer.createStream(),
    vad: new Vad(vadConfig, 60),
    segments: [],
    speechSpans: [],
    pending: '',
    processedSamples: 0,
    segStartSample: 0
  })
  post({ type: 'opened', id: msg.id })
}

function chunk(msg) {
  const s = sessions.get(msg.id)
  if (!s) return
  const pcm = resampleLinear(msg.samples, msg.sampleRate ?? TARGET_SR)
  s.processedSamples += pcm.length

  s.stream.acceptWaveform({ samples: pcm, sampleRate: TARGET_SR })
  while (recognizer.isReady(s.stream)) recognizer.decode(s.stream)
  s.pending = recognizer.getResult(s.stream).text || ''

  s.vad.acceptWaveform(pcm)
  drainVad(s)

  if (recognizer.isEndpoint(s.stream)) {
    flushUtterance(s)
    recognizer.reset(s.stream)
    s.segStartSample = s.processedSamples
  }

  post({
    type: 'partial',
    id: s.id,
    text: fullText(s),
    segments: s.segments,
    pending: s.pending,
    processedMs: msOf(s.processedSamples)
  })
}

function finish(msg) {
  const s = sessions.get(msg.id)
  if (!s) return
  s.stream.acceptWaveform({ samples: new Float32Array(0), sampleRate: TARGET_SR })
  s.stream.inputFinished()
  while (recognizer.isReady(s.stream)) recognizer.decode(s.stream)
  s.pending = recognizer.getResult(s.stream).text || s.pending
  flushUtterance(s)
  s.vad.flush()
  drainVad(s)

  const transcript = {
    text: fullText(s),
    segments: s.segments,
    silences: computeSilences(s),
    model: modelId,
    createdAt: Date.now()
  }
  post({ type: 'final', id: s.id, transcript })
  release(s)
}

function release(s) {
  sessions.delete(s.id)
  try {
    s.vad?.free?.()
  } catch {
    /* 版本差异：没有 free 就交给 GC */
  }
  try {
    s.stream?.destroy?.()
  } catch {
    /* 同上 */
  }
}

parentPort.on('message', (e) => {
  const msg = e.data
  try {
    switch (msg.type) {
      case 'init':
        init(msg)
        break
      case 'open':
        open(msg)
        break
      case 'chunk':
        chunk(msg)
        break
      case 'finish':
        finish(msg)
        break
      case 'close': {
        const s = sessions.get(msg.id)
        if (s) release(s)
        break
      }
      case 'dispose':
        process.exit(0)
        break
    }
  } catch (err) {
    post({ type: 'error', id: msg.id, message: err.message })
  }
})
