'use strict'

const { utilityProcess } = require('electron')
const { IPC } = require('./channels.cjs')
const { DENOISE_MODEL_ID, resolveDenoiseModel } = require('./denoise-models.cjs')
const { resolveWorkerPath } = require('./resources.cjs')

const WORKER_PATH = resolveWorkerPath('denoise-worker.cjs')

/**
 * 降噪服务：常驻一个 utilityProcess 承载 GTCRN 降噪。
 *
 * 使用「累积 -> 一次性降噪」模式（OfflineSpeechDenoiser）：
 *  - 会话开始 reset；feed 分片被 worker 缓存；
 *  - finish 时合并整段送入模型，回传降噪后 PCM；
 *  - 录音原文件完全不被修改（是否落盘由 IPC 层决定）。
 */
class DenoiseService {
  constructor() {
    /** @type {import('electron').UtilityProcess | null} */
    this.child = null
    /** @type {import('electron').WebContents | null} */
    this.sender = null
    this.ready = null
    this.spawning = null
    this.resultPending = null
    this.active = false
    this.lastError = null
  }

  isActive() {
    return this.active
  }

  getLastError() {
    return this.lastError
  }

  async start(sender) {
    this.sender = sender
    this.lastError = null
    // 并发 start 复用同一次 spawn，避免派生两个 utilityProcess
    if (!this.child) {
      this.spawning = this.spawning ?? this.spawn().finally(() => { this.spawning = null })
      await this.spawning
    }
    await this.ready?.promise
    this.child?.postMessage({ type: 'reset' })
    this.active = true
  }

  feed(samples, sampleRate) {
    if (!this.child || !this.active) return
    this.child.postMessage({ type: 'feed', samples, sampleRate })
  }

  finish() {
    const child = this.child
    if (!child || !this.active) return Promise.resolve(null)
    this.active = false
    this.emitStatus('working')
    return new Promise((resolve) => {
      let timer
      const done = (r) => {
        clearTimeout(timer)
        if (this.resultPending === done) this.resultPending = null
        resolve(r)
      }
      timer = setTimeout(() => done(null), 120000)
      this.resultPending = done
      child.postMessage({ type: 'finish' })
    })
  }

  dispose() {
    this.child?.postMessage({ type: 'dispose' })
    this.child?.kill()
    this.child = null
    this.active = false
    this.ready = null
    this.resultPending = null
  }

  async spawn() {
    const model = resolveDenoiseModel()
    const child = utilityProcess.fork(WORKER_PATH, [], {
      serviceName: 'speedrec-denoise',
      stdio: 'pipe'
    })
    this.child = child
    child.stdout?.on('data', (d) => console.log('[denoise]', String(d).trim()))
    child.stderr?.on('data', (d) => console.error('[denoise]', String(d).trim()))
    child.on('message', (msg) => this.onMessage(msg))
    child.on('exit', () => {
      this.child = null
      this.active = false
      this.ready = null
      this.emitStatus('stopped')
    })

    this.ready = this.makeReady()
    this.emitStatus('loading')
    child.postMessage({ type: 'init', modelId: DENOISE_MODEL_ID, model, numThreads: 2 })
    await this.ready.promise
  }

  makeReady() {
    let resolve
    let reject
    const raw = new Promise((res, rej) => {
      resolve = res
      reject = rej
    })
    const timer = setTimeout(() => reject(new Error('降噪引擎启动超时')), 30000)
    const promise = raw.finally(() => clearTimeout(timer))
    promise.catch(() => undefined)
    return { promise, resolve, reject }
  }

  onMessage(msg) {
    switch (msg.type) {
      case 'ready':
        this.ready?.resolve()
        this.emitStatus('ready')
        break
      case 'result':
        this.emitStatus('done')
        this.resultPending?.({
          samples: msg.samples ?? new Float32Array(0),
          sampleRate: msg.sampleRate ?? 16000
        })
        this.resultPending = null
        break
      case 'error':
        this.lastError = msg.message ?? '降噪引擎错误'
        this.emitStatus('error', this.lastError)
        this.ready?.reject(new Error(this.lastError))
        this.resultPending?.(null)
        this.resultPending = null
        break
      default:
        break
    }
  }

  emitStatus(state, message) {
    this.send(IPC.denoiseStatus, { state, message })
  }

  send(channel, payload) {
    if (this.sender && !this.sender.isDestroyed()) this.sender.send(channel, payload)
  }
}

const denoiseService = new DenoiseService()

module.exports = { DenoiseService, denoiseService }
