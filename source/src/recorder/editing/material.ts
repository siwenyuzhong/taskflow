import { loadSourceBuffer, releaseSourceBuffer } from '@renderer/audio/sources'

/**
 * 素材标识：`<录音 id>` 或 `<录音 id>#<轨道 key>`。
 *
 * 工程里的 `Segment.sourceId` 就是素材标识；多轨录音的每一路是一个独立素材，
 * 因此一次录音会话可以派生出多个素材。渲染时据此取对应的 AudioBuffer。
 */
export function materialKey(id: string, trackKey?: string): string {
  return trackKey ? `${id}#${trackKey}` : id
}

/** 拆出录音 id 与轨道 key（单轨时 trackKey 为 undefined）。 */
export function parseMaterialKey(key: string): { id: string; trackKey?: string } {
  const i = key.indexOf('#')
  return i < 0 ? { id: key } : { id: key.slice(0, i), trackKey: key.slice(i + 1) }
}

export async function loadMaterial(key: string): Promise<AudioBuffer> {
  const { id, trackKey } = parseMaterialKey(key)
  return loadSourceBuffer(id, trackKey)
}

/** 素材文件被替换（如降噪）后，丢弃解码缓存。 */
export function releaseMaterial(key: string): void {
  const { id, trackKey } = parseMaterialKey(key)
  releaseSourceBuffer(id, trackKey)
}
