import { Solar } from 'lunar-typescript'

/** 按天缓存，避免日历每帧重复换算 */
const cache = new Map<string, string>()

/**
 * 公历时刻 → 农历角标：
 * 农历初一显示月名（如「正月」「闰二月」「冬月」），其余显示农历日（如「初十」「廿三」「三十」）
 */
export function lunarLabel(ts: number): string {
  const d = new Date(ts)
  const id = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
  const hit = cache.get(id)
  if (hit) return hit
  const lunar = Solar.fromYmd(d.getFullYear(), d.getMonth() + 1, d.getDate()).getLunar()
  const month = lunar.getMonth()
  const label =
    lunar.getDay() === 1
      ? `${month < 0 ? '闰' : ''}${lunar.getMonthInChinese()}月`
      : lunar.getDayInChinese()
  cache.set(id, label)
  return label
}
