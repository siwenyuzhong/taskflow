/**
 * 降噪流程（渲染层）：
 *  1. 取当前录音素材并重采样为 16kHz 单声道；
 *  2. 分片推送给主进程 -> GTCRN worker（累积 + 一次性降噪）；
 *  3. finish 由主进程写入 audio.denoised.wav 并更新元数据（原始文件保留）；
 *  4. 使渲染层素材缓存失效，供调用方重新加载。
 *
 * 纯管线，不含 UI 状态；编辑器 / 资料库均可复用。
 */
import { releaseSourceBuffer, loadSourceBuffer } from '@renderer/audio/sources'
import { toMono16k } from '@renderer/audio/resample'
import type { RecordingMeta } from '@shared/types'

/** 分片大小（16kHz 下约 1 秒）。 */
const CHUNK = 16000

export async function denoiseAvailability(): ReturnType<Window['api']['denoise']['availability']> {
  return window.api.denoise.availability()
}

/**
 * 对指定录音执行降噪，返回更新后的元数据。
 * 成功后会释放渲染层的素材缓存（下次 loadSourceBuffer 会读取降噪文件）。
 */
export async function runDenoise(id: string): Promise<RecordingMeta | null> {
  const availability = await window.api.denoise.availability()
  if (!availability.available) {
    throw new Error(availability.message ?? '降噪模型不可用')
  }

  const buffer = await loadSourceBuffer(id)
  const pcm = await toMono16k(buffer)

  try {
    await window.api.denoise.start()
    for (let offset = 0; offset < pcm.length; offset += CHUNK) {
      window.api.denoise.feed(pcm.subarray(offset, offset + CHUNK), 16000)
    }
    const meta = await window.api.denoise.finish(id)
    return meta
  } finally {
    // 无论成功与否都释放缓存：成功后需读降噪文件，失败也避免残留脏缓冲。
    releaseSourceBuffer(id)
  }
}

/** 还原为原始音频，返回更新后的元数据。 */
export async function revertDenoise(id: string): Promise<RecordingMeta | null> {
  const meta = await window.api.denoise.revert(id)
  releaseSourceBuffer(id)
  return meta
}
