/** 通过素材 URL（桌面自定义协议 / 安卓文件 URL）加载并解码录音音频，按素材标识缓存解码结果。 */

import { mediaUrl } from '../lib/media-url'

const cache = new Map<string, AudioBuffer>()
let ctx: AudioContext | null = null

function audioCtx(): AudioContext {
  if (!ctx || ctx.state === 'closed') ctx = new AudioContext()
  return ctx
}

/**
 * 加载并解码一路素材。
 * `trackKey` 为多轨录音的轨道标识；单轨录音不传。
 */
export async function loadSourceBuffer(id: string, trackKey?: string): Promise<AudioBuffer> {
  const cacheKey = trackKey ? `${id}/${trackKey}` : id
  const hit = cache.get(cacheKey)
  if (hit) return hit
  const url = await mediaUrl(id, trackKey)
  if (!url) throw new Error('找不到速录文件')
  const res = await fetch(url)
  if (!res.ok) throw new Error(`无法读取音频（${res.status}）`)
  const data = await res.arrayBuffer()
  const buf = await audioCtx().decodeAudioData(data)
  cache.set(cacheKey, buf)
  return buf
}

export function peekSourceBuffer(id: string, trackKey?: string): AudioBuffer | null {
  return cache.get(trackKey ? `${id}/${trackKey}` : id) ?? null
}

export function releaseSourceBuffer(id: string, trackKey?: string): void {
  cache.delete(trackKey ? `${id}/${trackKey}` : id)
}
