/**
 * 音频修复：咔哒 / 爆音（click / pop）与破损拼接缝的检测与修复（非破坏）。
 *
 * 基于**一阶差分** d[i] = |x[i] - x[i-1]|（每个声道独立）：
 * - **局部自适应阈值** t[i] = max(绝对下限, 倍率 × 邻域 RMS(d))，邻域取 ±window/2 并
 *   剔除候选点附近 maxRun+2 个样本（避免毛刺自身抬高基线）。
 *   这样安静处阈值低、宽带噪声 / 高频明亮处阈值高，不会把正常内容当爆音。
 * - **尖峰 / 毛刺**：两个跳变点带**反号且近似抵消**的阶跃（进入与离开），相距 ≤ maxRun
 *   → 判定为瞬时毛刺（含单样本“咔哒”与几毫秒的平顶脉冲），
 *   修复：在两个跳变点外侧取真实电平，整段线性插值抹平。
 * - **拼接台阶**：只有一个跳变点、无抵消伙伴，且进入陡峭、两侧局部趋势不连续
 *   → 判定为破损拼接缝，修复：把瞬时阶跃 Δ 从跳变点起摊成约 2ms 的线性斜坡
 *   （波形局部形状不变，只去掉“咔”的一声，整体仍落到新电平）。
 * - 安全边界：渐强起音、锯齿 / 方波等周期波形（跳变前后局部斜率延续）、宽带噪声段
 *   都不会命中上述两类。
 */

export interface RepairOptions {
  /** 一阶差分绝对下限（线性幅度） */
  minAbsolute?: number
  /** 局部 RMS 阈值倍率 */
  thresholdFactor?: number
  /** 邻域窗口长度（样本），建议 ~20ms */
  windowSamples?: number
  /** 拼接台阶“进入陡峭”判定的比较倍率 */
  neighborFactor?: number
  /** 尖峰两个跳变点最大允许间距（样本），更长视为真实瞬态不修 */
  maxRun?: number
  /** 拼接台阶修复的斜坡长度（样本数） */
  seamRamp?: number
}

export interface RepairResult {
  /** 修复后的数据（未发现异常时为原数组，无复制） */
  data: Float32Array
  /** 修复总数（尖峰 + 台阶） */
  count: number
  /** 其中尖峰 / 毛刺数 */
  spikes: number
  /** 其中拼接台阶数 */
  seams: number
}

export function repairClicks(input: Float32Array, opts: RepairOptions = {}): RepairResult {
  const {
    minAbsolute = 0.05,
    thresholdFactor = 8,
    windowSamples = 1024,
    neighborFactor = 3,
    maxRun = 8,
    seamRamp = 96
  } = opts

  const empty: RepairResult = { data: input, count: 0, spikes: 0, seams: 0 }
  const n = input.length
  if (n < 16) return empty

  // 一阶差分
  const d = new Float32Array(n)
  for (let i = 1; i < n; i++) d[i] = Math.abs(input[i] - input[i - 1])

  // d² 前缀和，用于 O(1) 取邻域均方
  const sq = new Float64Array(n + 1)
  for (let i = 1; i < n; i++) sq[i + 1] = sq[i] + d[i] * d[i]
  const half = Math.max(16, Math.round(windowSamples / 2))
  const guard = maxRun + 2

  /** 候选点 i 的局部阈值（剔除自身邻域） */
  const localThreshold = (i: number): number => {
    const a = Math.max(1, i - half)
    const b = Math.min(n - 1, i + half)
    const ea = Math.max(a, i - guard)
    const eb = Math.min(b, i + guard)
    let sum = sq[b + 1] - sq[a]
    let cnt = b - a + 1
    if (eb >= ea) {
      sum -= sq[eb + 1] - sq[ea]
      cnt -= eb - ea + 1
    }
    const rms = cnt > 0 ? Math.sqrt(Math.max(0, sum) / cnt) : 0
    return Math.max(minAbsolute, thresholdFactor * rms)
  }

  // 跳变点（差分索引 i 表示样本 i-1 → i 处发生阶跃）
  const jumps: number[] = []
  const thr = new Float32Array(n)
  for (let i = 1; i < n; i++) {
    thr[i] = localThreshold(i)
    if (d[i] > thr[i]) jumps.push(i)
  }
  if (jumps.length === 0) return empty

  const data = input.slice()
  const used = new Uint8Array(jumps.length)
  let spikes = 0
  let seams = 0

  for (let k = 0; k < jumps.length; k++) {
    if (used[k]) continue
    const a = jumps[k]
    const deltaA = input[a] - input[a - 1]

    // ① 寻找反号抵消的伙伴跳变点 → 尖峰 / 毛刺
    let partner = -1
    for (let m = k + 1; m < jumps.length; m++) {
      const b = jumps[m]
      if (b - a > maxRun + 1) break
      const deltaB = input[b] - input[b - 1]
      if (deltaA * deltaB >= 0) continue
      if (Math.abs(deltaA + deltaB) <= Math.max(thr[a], 0.4 * Math.abs(deltaA))) {
        partner = b
        break
      }
    }

    if (partner !== -1) {
      const from = input[a - 1]
      const to = input[partner]
      const span = partner - (a - 1)
      for (let j = a; j < partner; j++) data[j] = from + (to - from) * ((j - (a - 1)) / span)
      spikes++
      for (let m = k + 1; m < jumps.length && jumps[m] <= partner; m++) used[m] = 1
      used[k] = 1
      continue
    }

    // ② 无伙伴 → 拼接台阶候选：进入陡峭 + 两侧局部趋势不连续
    used[k] = 1
    const prevDiff = a > 1 ? d[a - 1] : 0
    if (d[a] <= neighborFactor * prevDiff) continue

    // 趋势连续性：锯齿 / 方波等周期波形的瞬时跳变是正常谐波，跳变前后局部斜率延续；
    // 真实拼接缝则是“相位 / 电平断裂”，两侧斜率明显不一致。
    const K = 32
    if (a - 1 - K < 0 || a + K >= n) continue
    const slopeBefore = (input[a - 1] - input[a - 1 - K]) / K
    const slopeAfter = (input[a + K] - input[a + 1]) / K
    if (Math.abs(slopeAfter - slopeBefore) * K < 0.25 * Math.abs(deltaA)) continue

    // 把瞬时阶跃摊成斜坡：x[a..a+r] 减去按线性衰减的 Δ
    const r = Math.min(seamRamp, n - 1 - (a + K))
    if (r < 4) continue
    for (let j = 0; j <= r; j++) data[a + j] -= deltaA * ((r - j) / (r + 1))
    seams++
  }

  const count = spikes + seams
  if (count === 0) return empty
  return { data, count, spikes, seams }
}