/**
 * 说话人标签：本地音色在线聚类给每个「识别对象」分一个序号，
 * 这里统一配色与文案，供字幕悬浮窗与转写面板共用。
 */
export const SPEAKER_COLORS = ['#5b8cff', '#ff9f45', '#34d399', '#c084fc'] as const

export function speakerColor(index: number): string {
  const n = SPEAKER_COLORS.length
  return SPEAKER_COLORS[((index % n) + n) % n]
}

export function speakerLabel(index: number): string {
  return `说话人 ${index + 1}`
}
