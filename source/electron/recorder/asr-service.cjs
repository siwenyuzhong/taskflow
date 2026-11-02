'use strict'

const { utilityProcess } = require('electron')
const { IPC } = require('./channels.cjs')
const { ASR_MODEL_ID, resolveAsrModels } = require('./asr-models.cjs')
const { resolveWorkerPath } = require('./resources.cjs')

const WORKER_PATH = resolveWorkerPath('asr-worker.cjs')

/**
 * ASR 服务：常驻一个 utilityProcess 承载 CPU 密集的流式转写，
 * 每个录音会话前 reset，结束后 finalize 取回完整转写。
 */
class AsrService {
  constructor() {
    /** @type {import('electron').UtilityProcess | null} */
    this.child = null
    /** @type {import('electron').WebContents | null} */
    this.sender = null
    this.ready = null
    this.spawning = null
    this.finalPending = null
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

  stop() {
    const child = this.child
    if (!child || !this.active) return Promise.resolve(null)
    this.active = false
    return new Promise((resolve) => {
      let timer
      const finish = (t) => {
        clearTimeout(timer)
        if (this.finalPending === finish) this.finalPending = null
        resolve(t)
      }
      timer = setTimeout(() => finish(null), 12000)
      this.finalPending = finish
      child.postMessage({ type: 'finalize' })
    })
  }

  dispose() {
    this.child?.postMessage({ type: 'dispose' })
    this.child?.kill()
    this.child = null
    this.active = false
    this.ready = null
    this.finalPending = null
  }

  async spawn() {
    const models = resolveAsrModels()
    const child = utilityProcess.fork(WORKER_PATH, [], {
      serviceName: 'speedrec-asr',
      stdio: 'pipe'
    })
    this.child = child
    child.stdout?.on('data', (d) => console.log('[asr]', String(d).trim()))
    child.stderr?.on('data', (d) => console.error('[asr]', String(d).trim()))
    child.on('message', (msg) => this.onMessage(msg))
    child.on('exit', () => {
      this.child = null
      this.active = false
      this.ready = null
      this.emitStatus('stopped')
    })

    this.ready = this.makeReady()
    this.emitStatus('loading')
    child.postMessage({ type: 'init', modelId: ASR_MODEL_ID, models, numThreads: 2 })
    await this.ready.promise
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
    // 避免未处理的 rejection 报警
    promise.catch(() => undefined)
    return { promise, resolve, reject }
  }

  onMessage(msg) {
    switch (msg.type) {
      case 'ready':
        this.ready?.resolve()
        this.emitStatus('ready')
        break
      case 'partial':
        this.send(IPC.asrPartial, {
          text: msg.text ?? '',
          segments: msg.segments ?? [],
          pending: msg.pending ?? '',
          pendingSpeaker: msg.pendingSpeaker ?? null,
          silence: msg.silence
        })
        break
      case 'final':
        this.emitStatus('stopped')
        this.finalPending?.(msg.transcript ?? null)
        this.finalPending = null
        break
      case 'error':
        this.lastError = msg.message ?? '转写引擎错误'
        this.send(IPC.asrError, this.lastError)
        this.emitStatus('error', this.lastError)
        this.ready?.reject(new Error(this.lastError))
        this.finalPending?.(null)
        this.finalPending = null
        break
      default:
        break
    }
  }

  emitStatus(state, message) {
    this.send(IPC.asrStatus, { state, message })
  }

  send(channel, payload) {
    if (this.sender && !this.sender.isDestroyed()) this.sender.send(channel, payload)
  }
}

const asrService = new AsrService()

module.exports = { AsrService, asrService }
