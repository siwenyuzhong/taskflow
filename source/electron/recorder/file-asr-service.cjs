'use strict'

const { spawn } = require('child_process')
const { utilityProcess } = require('electron')
const { IPC } = require('./channels.cjs')
const { ASR_MODEL_ID, checkAsrAvailability, resolveAsrModels } = require('./asr-models.cjs')
const { resolveWorkerPath, resolveFfmpegPath } = require('./resources.cjs')
const { recordingDir } = require('./paths.cjs')
const { getRecordingAudioPath, readMeta, updateMeta } = require('./library.cjs')

/** 可执行 ffmpeg 路径（打包后指向 asar 解包副本，见 resources.cjs） */
const ffmpegPath = resolveFfmpegPath()

const WORKER_PATH = resolveWorkerPath('transcribe-worker.cjs')

/** 转写采样率：worker 内部就是 16kHz，交给 ffmpeg 下采样，省内存。 */
const ASR_SR = 16000
/** 每次投递 0.5 秒音频（s16le） */
const CHUNK_SAMPLES = 8000
const CHUNK_BYTES = CHUNK_SAMPLES * 2
/** 同时在转写的录音条数（共享一个模型实例，多一条流只多几十 MB） */
const MAX_CONCURRENT = 4
/** 进度回推的最小间隔，避免高频 IPC */
const NOTIFY_MS = 120
/** 解码远快于识别：攒够这么多分片先让 ffmpeg 歇会儿，防止内存无限涨 */
const QUEUE_HIGH = 60
const QUEUE_LOW = 20
/** 没事做多久就释放 worker：模型常驻要 400 多 MB，别为了偶尔的转写一直占着 */
const IDLE_DISPOSE_MS = 90000

/**
 * 资料库「语音转文字」服务（离线转写已存盘的录音）。
 *
 *  - 内置 ffmpeg 把录音解码成 16kHz 单声道 PCM；
 *  - 投给一个常驻 utilityProcess（transcribe-worker）里的独立会话；
 *  - 一片一回执，天然背压；识别多少就往外推多少，不等全部完成；
 *  - 多条录音并发转写，超出上限的排队。
 *
 * 与实时录制的 asrService 完全分开，互不影响正在进行的录制。
 * 结果直接写回 meta.json，渲染层收到 done 事件后更新列表项。
 */
class FileAsrService {
  constructor() {
    /** @type {import('electron').UtilityProcess | null} */
    this.child = null
    /** @type {{promise: Promise, resolve: Function, reject: Function} | null} */
    this.ready = null
    /** @type {import('electron').WebContents | null} */
    this.sender = null
    /** @type {Map<string, any>} */
    this.jobs = new Map()
    /** 提交顺序，按 FIFO 拉起排队任务 */
    this.order = []
    /** @type {NodeJS.Timeout | null} */
    this.idleTimer = null
  }

  /** 开始（或排队）一条录音的离线转写。 */
  start(id, sender) {
    this.sender = sender
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    const existing = this.jobs.get(id)
    if (existing) return { queued: existing.phase === 'queued' }

    const availability = checkAsrAvailability()
    if (!availability.available) throw new Error(availability.message ?? '转写模型不可用')
    if (!ffmpegPath) throw new Error('未找到内置 ffmpeg，无法离线转写')
    const abs = getRecordingAudioPath(id)
    if (!abs) throw new Error('找不到这条速录的音频文件')

    const meta = readMeta(recordingDir(id))
    const job = {
      id,
      abs,
      durationMs: meta?.durationMs ?? 0,
      phase: 'queued',
      buf: null,
      chunks: [],
      paused: false,
      inFlight: false,
      eof: false,
      proc: null,
      settled: false,
      lastNotify: 0,
      snapshot: { text: '', pending: '', segments: [], processedMs: 0 }
    }
    this.jobs.set(id, job)
    this.order.push(id)
    this.pump()
    return { queued: job.phase === 'queued' }
  }

  /** 取消：排队中的直接出队，正在跑的杀掉解码并释放会话。 */
  cancel(id) {
    const job = this.jobs.get(id)
    if (!job) return false
    this.cleanup(job)
    this.pump()
    return true
  }

  /** 当前在跑 / 排队的任务，供渲染层重载后恢复状态。 */
  list() {
    return [...this.order]
      .map((id) => this.jobs.get(id))
      .filter(Boolean)
      .map((j) => ({
        id: j.id,
        phase: j.phase,
        progressMs: j.snapshot.processedMs,
        durationMs: j.durationMs,
        text: j.snapshot.text,
        pending: j.snapshot.pending
      }))
  }

  dispose() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    for (const job of [...this.jobs.values()]) this.cleanup(job)
    this.killWorker()
  }

  /** 关掉转写进程，释放模型占的内存。 */
  killWorker() {
    const child = this.child
    this.child = null
    this.ready = null
    if (!child) return
    try {
      child.postMessage({ type: 'dispose' })
      child.kill()
    } catch {
      /* 已经退出了 */
    }
  }

  /** 没有任务了就倒计时收摊；期间来新任务会取消。 */
  armIdleRelease() {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
    if (!this.child || this.jobs.size > 0) return
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      if (this.jobs.size === 0) this.killWorker()
    }, IDLE_DISPOSE_MS)
    // 定时器本身不该阻止应用退出
    this.idleTimer.unref?.()
  }

  // --------------------------------------------------------------------------

  /** 有空位就按提交顺序把排队任务拉起来。 */
  pump() {
    let running = 0
    for (const j of this.jobs.values()) if (j.phase === 'running') running += 1
    for (const id of this.order) {
      if (running >= MAX_CONCURRENT) break
      const job = this.jobs.get(id)
      if (job && job.phase === 'queued') {
        running += 1
        void this.runJob(job)
      }
    }
  }

  async runJob(job) {
    if (job.settled) return
    job.phase = 'running'
    this.notify(job, { phase: 'running' })
    try {
      await this.ensureWorker()
      if (job.settled || !this.child) return
      this.child.postMessage({ type: 'open', id: job.id })
      this.decode(job)
    } catch (err) {
      this.fail(job, err?.message ?? '转写引擎启动失败')
    }
  }

  /** ffmpeg：任意音频 → s16le / 16kHz / 单声道，从 stdout 流式读出。 */
  decode(job) {
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-i',
      job.abs,
      '-f',
      's16le',
      '-acodec',
      'pcm_s16le',
      '-ac',
      '1',
      '-ar',
      String(ASR_SR),
      '-'
    ]
    let proc
    try {
      proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      this.fail(job, err?.message ?? '无法启动音频解码')
      return
    }
    job.proc = proc

    proc.stdout.on('data', (piece) => {
      if (job.settled) return
      job.buf = job.buf ? Buffer.concat([job.buf, piece]) : piece
      while (job.buf.length >= CHUNK_BYTES) {
        job.chunks.push(toFloat32(job.buf.subarray(0, CHUNK_BYTES)))
        job.buf = job.buf.subarray(CHUNK_BYTES)
      }
      if (!job.paused && job.chunks.length > QUEUE_HIGH) {
        job.paused = true
        proc.stdout.pause()
      }
      this.feedNext(job)
    })

    let stderr = ''
    proc.stderr.on('data', (d) => {
      stderr += String(d)
    })

    proc.on('error', (err) => this.fail(job, err?.message ?? '音频解码失败'))

    proc.on('close', (code) => {
      if (job.settled) return
      job.proc = null
      if (code !== 0 && !job.chunks.length && !job.snapshot.processedMs) {
        this.fail(job, describeDecodeError(stderr))
        return
      }
      if (job.buf && job.buf.length) {
        job.chunks.push(toFloat32(job.buf))
        job.buf = null
      }
      job.eof = true
      this.feedNext(job)
    })
  }

  /** 一片一片投：上一片没回执就不发下一片，顺带做背压。 */
  feedNext(job) {
    if (job.settled || job.inFlight || job.phase !== 'running' || !this.child) return
    const chunk = job.chunks.shift()
    if (chunk) {
      job.inFlight = true
      this.child.postMessage({ type: 'chunk', id: job.id, samples: chunk, sampleRate: ASR_SR })
      if (job.paused && job.chunks.length < QUEUE_LOW) {
        job.paused = false
        job.proc?.stdout.resume()
      }
      return
    }
    if (job.eof) {
      job.inFlight = true
      this.child.postMessage({ type: 'finish', id: job.id })
    }
  }

  ensureWorker() {
    if (this.child && this.ready && !this.ready.failed) return this.ready.promise
    // 上一次初始化失败：换一个新进程重试，别让一个坏错误永久卡住后面的任务
    if (this.child) this.killWorker()
    const models = resolveAsrModels()
    const child = utilityProcess.fork(WORKER_PATH, [], {
      serviceName: 'speedrec-transcribe',
      stdio: 'pipe'
    })
    this.child = child
    child.stdout?.on('data', (d) => console.log('[transcribe]', String(d).trim()))
    child.stderr?.on('data', (d) => console.error('[transcribe]', String(d).trim()))
    child.on('message', (msg) => this.onMessage(msg))
    child.on('exit', () => {
      this.child = null
      this.ready = null
      // 进程没了：所有任务如实报错，不留永远不动的进度条
      for (const job of [...this.jobs.values()]) this.fail(job, '转写进程意外退出，请重试')
    })

    const ready = this.makeReady()
    this.ready = ready
    child.postMessage({ type: 'init', modelId: ASR_MODEL_ID, models, numThreads: 2 })
    return ready.promise
  }

  makeReady() {
    let resolve
    let reject
    const raw = new Promise((res, rej) => {
      resolve = res
      reject = rej
    })
    const timer = setTimeout(() => reject(new Error('转写引擎启动超时')), 30000)
    const promise = raw.finally(() => clearTimeout(timer))
    promise.catch(() => undefined)
    const ready = { promise, resolve, reject, failed: false }
    // 记下失败状态：ensureWorker 据此决定要不要换新进程
    raw.catch(() => {
      ready.failed = true
    })
    return ready
  }

  onMessage(msg) {
    if (msg.type === 'ready') {
      this.ready?.resolve()
      return
    }
    if (msg.type === 'error') {
      const job = msg.id ? this.jobs.get(msg.id) : null
      if (job) this.fail(job, msg.message ?? '转写引擎错误')
      else this.ready?.reject(new Error(msg.message ?? '转写引擎错误'))
      return
    }
    const job = msg.id ? this.jobs.get(msg.id) : null
    if (!job) return

    if (msg.type === 'partial') {
      job.inFlight = false
      job.snapshot = {
        text: msg.text ?? '',
        pending: msg.pending ?? '',
        segments: msg.segments ?? [],
        processedMs: msg.processedMs ?? 0
      }
      const now = Date.now()
      if (now - job.lastNotify >= NOTIFY_MS) {
        job.lastNotify = now
        this.notify(job, { phase: 'running' })
      }
      this.feedNext(job)
      return
    }

    if (msg.type === 'final') {
      const transcript = msg.transcript ?? {
        text: '',
        segments: [],
        silences: [],
        model: ASR_MODEL_ID,
        createdAt: Date.now()
      }
      try {
        updateMeta(job.id, { transcript })
      } catch (err) {
        this.fail(job, `转写结果保存失败：${err?.message ?? err}`)
        return
      }
      this.notify(job, { phase: 'done', transcript })
      this.cleanup(job)
      this.pump()
    }
  }

  notify(job, extra) {
    if (!this.sender || this.sender.isDestroyed()) return
    this.sender.send(IPC.asrFilePartial, {
      id: job.id,
      phase: extra.phase,
      text: job.snapshot.text,
      pending: job.snapshot.pending,
      segments: job.snapshot.segments,
      progressMs: job.snapshot.processedMs,
      durationMs: job.durationMs,
      error: extra.error,
      transcript: extra.transcript
    })
  }

  fail(job, message) {
    if (job.settled) return
    this.notify(job, { phase: 'error', error: message })
    this.cleanup(job)
    this.pump()
  }

  /** 杀解码进程、释放 worker 会话、出队（不发通知）。 */
  cleanup(job) {
    job.settled = true
    const proc = job.proc
    job.proc = null
    if (proc) {
      try {
        proc.stdout?.destroy()
        proc.kill('SIGKILL')
      } catch {
        /* 已经退出了 */
      }
    }
    if (this.child) this.child.postMessage({ type: 'close', id: job.id })
    this.jobs.delete(job.id)
    this.order = this.order.filter((x) => x !== job.id)
    this.armIdleRelease()
  }
}

function toFloat32(buf) {
  const n = Math.floor(buf.length / 2)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(i * 2) / 32768
  return out
}

function describeDecodeError(stderr) {
  const text = String(stderr || '')
  if (/Invalid data|Output file is empty/i.test(text)) return '音频文件无法解码，可能已损坏'
  if (/No such file/i.test(text)) return '找不到音频文件'
  const last = text.split('\n').filter(Boolean).pop()
  return last ? `音频解码失败：${last}` : '音频解码失败'
}

const fileAsrService = new FileAsrService()

module.exports = { FileAsrService, fileAsrService, MAX_CONCURRENT }
