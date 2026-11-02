/**
 * 将任意采样率 / 声道数的 AudioBuffer 重采样为 16kHz 单声道 Float32。
 * 使用 OfflineAudioContext 完成高质量重采样（含声道下混）。
 */
export async function toMono16k(buffer: AudioBuffer): Promise<Float32Array> {
  const SR = 16000
  if (buffer.sampleRate === SR && buffer.numberOfChannels === 1) {
    return new Float32Array(buffer.getChannelData(0))
  }
  const frames = Math.max(1, Math.ceil(buffer.duration * SR))
  const ctx = new OfflineAudioContext(1, frames, SR)
  const src = ctx.createBufferSource()
  src.buffer = buffer
  src.connect(ctx.destination)
  src.start()
  const rendered = await ctx.startRendering()
  return new Float32Array(rendered.getChannelData(0))
}
