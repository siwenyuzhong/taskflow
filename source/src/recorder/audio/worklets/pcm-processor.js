/**
 * PCM 采集 + 电平计算 + 16kHz 分片转发。
 *
 * - 输出静音到 output（避免回声），仅用于保持音频处理图活跃；
 * - 每约 16ms 通过 port 上报一次 rms/peak 供 UI 波形使用；
 * - 通过 gate 消息开启后，把输入按比例块平均降采样到 16kHz 单声道，
 *   按约 200ms 分片回传（零拷贝 transfer），供离线流式转写使用。
 */
class PcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this._sum = 0
    this._frames = 0
    this._peak = 0
    this._counter = 0

    // 16k 降采样：按 ratio 累积求平均，跨 process() 保留余量，避免漂移。
    this._ratio = sampleRate / 16000
    this._carry = 0
    this._carryN = 0
    // 分片大小要单独保存：transfer 后 this._pcm.buffer 会被 detach，length 归零
    this._pcmSize = Math.round(16000 * 0.2)
    this._pcm = new Float32Array(this._pcmSize)
    this._pcmLen = 0
    this._gate = false

    this.port.onmessage = (e) => {
      const msg = e.data
      if (msg && msg.type === 'gate') {
        this._gate = !!msg.on
        if (!this._gate) {
          this._carry = 0
          this._carryN = 0
          this._pcmLen = 0
        }
      }
    }
  }

  process(inputs, outputs) {
    const output = outputs[0]
    if (output) {
      for (let c = 0; c < output.length; c++) output[c].fill(0)
    }

    const input = inputs[0]
    const ch0 = input && input[0]
    if (ch0) {
      for (let i = 0; i < ch0.length; i++) {
        const s = ch0[i]
        this._sum += s * s
        const a = s < 0 ? -s : s
        if (a > this._peak) this._peak = a
        if (this._gate) this._push(s)
      }
      this._frames += ch0.length
    }

    this._counter++
    if (this._counter >= 6) {
      const rms = this._frames > 0 ? Math.sqrt(this._sum / this._frames) : 0
      this.port.postMessage({ type: 'level', rms, peak: this._peak })
      this._sum = 0
      this._frames = 0
      this._peak = 0
      this._counter = 0
    }

    return true
  }

  _push(sample) {
    this._carry += sample
    this._carryN++
    if (this._carryN >= this._ratio) {
      this._pcm[this._pcmLen++] = this._carry / this._carryN
      this._carry = 0
      this._carryN = 0
      if (this._pcmLen >= this._pcmSize) {
        this.port.postMessage({ type: 'pcm', samples: this._pcm }, [this._pcm.buffer])
        this._pcm = new Float32Array(this._pcmSize)
        this._pcmLen = 0
      }
    }
  }
}

registerProcessor('pcm-processor', PcmProcessor)
