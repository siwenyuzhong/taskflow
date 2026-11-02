/**
 * 「碎片飘散」删除动效
 * ------------------------------------------------------------------
 * 把目标元素切成 cols × rows 的网格碎片，每块碎片里放一份目标元素的
 * 克隆副本，并用负偏移把它挪到正确位置——碎片外层 overflow:hidden，
 * 于是每块碎片正好显示卡片对应位置的像素，视觉上就是卡片被击碎。
 * 随后每块碎片带着随机方向/旋转/缩放，从左往右飘散并淡出。
 *
 * 纯 DOM + CSS 关键帧，无第三方依赖；关键帧定义在 index.css（shatter-fly）。
 */

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

export interface ShatterOptions {
  /** 碎片全部飞散后的回调 */
  onDone?: () => void
  /** 整体缩放（小卡片可以放大碎片比例） */
  scale?: number
}

/**
 * 执行碎片飘散动画。
 * @returns 手动清理函数（也会在动画结束后自动清理）
 */
export function shatterElement(el: HTMLElement, opts: ShatterOptions = {}): () => void {
  const cleanup = () => {
    /* 占位，下面会重新赋值 */
  }

  if (prefersReducedMotion()) {
    opts.onDone?.()
    return cleanup
  }

  const rect = el.getBoundingClientRect()
  if (rect.width < 8 || rect.height < 8) {
    opts.onDone?.()
    return cleanup
  }

  // 碎片密度：目标每块约 17px（细密碎裂感），并限制总块数避免拖慢渲染
  const TARGET = 17
  const MAX_PIECES = 240
  let cols = Math.max(10, Math.min(28, Math.round(rect.width / TARGET)))
  let rows = Math.max(8, Math.min(16, Math.round(rect.height / TARGET)))
  while (cols * rows > MAX_PIECES && (cols > 10 || rows > 8)) {
    if (cols >= rows && cols > 10) cols -= 1
    else if (rows > 8) rows -= 1
    else break
  }
  const tileW = rect.width / cols
  const tileH = rect.height / rows

  const layer = document.createElement('div')
  layer.setAttribute('aria-hidden', 'true')
  layer.setAttribute('data-shatter', '1')
  layer.style.cssText = [
    'position:fixed',
    `left:${rect.left}px`,
    `top:${rect.top}px`,
    `width:${rect.width}px`,
    `height:${rect.height}px`,
    'z-index:130',
    'pointer-events:none',
  ].join(';')

  // 一份完整克隆，供每块碎片裁切使用
  const source = el.cloneNode(true) as HTMLElement
  source.removeAttribute('id')
  source.removeAttribute('data-task-id')
  source.style.animation = 'none'
  source.style.transition = 'none'
  source.style.transform = 'none'
  source.style.opacity = '1'
  source.style.margin = '0'
  source.style.width = `${rect.width}px`
  source.style.height = `${rect.height}px`
  // 40 份克隆各自再叠 backdrop-filter 会非常吃 GPU，这里换成不透明的主题底色，
  // 视觉上与磨砂卡片几乎一致，但渲染成本低得多。
  source.style.backdropFilter = 'none'
  ;(source.style as CSSStyleDeclaration & { webkitBackdropFilter?: string }).webkitBackdropFilter = 'none'
  source.style.background =
    'linear-gradient(160deg, color-mix(in srgb, var(--ink-700) 94%, transparent), color-mix(in srgb, var(--ink-800) 90%, transparent))'

  let total = 0
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const tile = document.createElement('div')
      tile.style.cssText = [
        'position:absolute',
        `left:${(c * tileW).toFixed(2)}px`,
        `top:${(r * tileH).toFixed(2)}px`,
        `width:${(tileW + 0.5).toFixed(2)}px`,
        `height:${(tileH + 0.5).toFixed(2)}px`,
        'overflow:hidden',
        'will-change:transform,opacity',
      ].join(';')

      const piece = source.cloneNode(true) as HTMLElement
      piece.style.position = 'absolute'
      piece.style.left = `${(-c * tileW).toFixed(2)}px`
      piece.style.top = `${(-r * tileH).toFixed(2)}px`
      tile.appendChild(piece)

      // 向左到右的波次 + 逐块更远的水平位移 = "从左到右飘散"
      // 位移/波次按列数归一化，块数变多时节奏与幅度依然稳定
      const fx = cols > 1 ? c / (cols - 1) : 1
      const delay = fx * 560 + Math.random() * 110
      const dur = 1250 + Math.random() * 550
      const dx = 55 + fx * 340 + Math.random() * 70
      const dy = (Math.random() * 2 - 1) * 58 - 12
      const rot = (Math.random() * 2 - 1) * 48
      const sc = 0.4 + Math.random() * 0.35

      tile.style.setProperty('--dx', `${dx.toFixed(1)}px`)
      tile.style.setProperty('--dy', `${dy.toFixed(1)}px`)
      tile.style.setProperty('--rot', `${rot.toFixed(1)}deg`)
      tile.style.setProperty('--sc', sc.toFixed(3))
      tile.style.animation = `shatter-fly ${Math.round(dur)}ms cubic-bezier(.45,.06,.3,1) ${Math.round(delay)}ms both`

      total = Math.max(total, delay + dur)
      layer.appendChild(tile)
    }
  }

  document.body.appendChild(layer)

  let removed = false
  let timer = 0
  const dispose = () => {
    if (removed) return
    removed = true
    window.clearTimeout(timer)
    layer.remove()
  }

  timer = window.setTimeout(() => {
    dispose()
    opts.onDone?.()
  }, total + 90)

  return dispose
}

/**
 * 清空回收站「全屏粉碎」动效
 * ------------------------------------------------------------------
 * 碎片从应用窗口中心的一小团开始，按「内圈→外圈」的波次不断增多、
 * 向四周散开，最后铺满整个窗口，然后整层一起缓缓淡出消失。
 * 碎片的位置、尺寸、旋转、玻璃渐变角度都随机——像被敲碎飞溅的碎屑，
 * 不再是整齐的网格。样式与单卡「彻底删除」一致（磨砂玻璃质感）。
 *
 * @returns 手动清理函数（也会在动画结束后自动清理）
 */
export function shatterScreen(opts: { onDone?: () => void } = {}): () => void {
  const cleanup = () => {
    /* 占位，下面会重新赋值 */
  }
  if (prefersReducedMotion()) {
    opts.onDone?.()
    return cleanup
  }

  const vw = window.innerWidth
  const vh = window.innerHeight

  const cx = vw / 2
  const cy = vh / 2

  // 碎片数量：铺满画面但保留有机感的空隙；密度约每 3600px² 一块
  const pieces = Math.max(240, Math.min(380, Math.round((vw * vh) / 3600)))

  // 先生成随机的碎片参数（位置/大小/角度/渐变），再按「距中心距离」排好，
  // 让内圈的先出现、外圈后出现
  interface Shard {
    x: number
    y: number
    w: number
    h: number
    tx: number
    ty: number
    dist: number
    rot: number
    sc: number
    delay: number
    dur: number
    grad: number
    radius: number
  }
  const shards: Shard[] = []
  for (let i = 0; i < pieces; i += 1) {
    const w = 26 + Math.random() * 78 // 26–104px，大小随机
    const h = w * (0.6 + Math.random() * 0.8) // 高宽比随机（近似方 → 细长条）
    const x = Math.random() * (vw - w)
    const y = Math.random() * (vh - h)
    const pcx = x + w / 2
    const pcy = y + h / 2
    const dist = Math.hypot(pcx - cx, pcy - cy) / Math.hypot(cx, cy) // 0（中心）→ ~1（角落）
    shards.push({
      x,
      y,
      w,
      h,
      tx: pcx - cx,
      ty: pcy - cy,
      dist,
      rot: (Math.random() * 2 - 1) * 60,
      sc: 0.88 + Math.random() * 0.28,
      delay: 0,
      dur: 380 + Math.random() * 260,
      grad: 140 + Math.random() * 55,
      radius: Math.random() * 16,
    })
  }
  shards.sort((a, b) => a.dist - b.dist)
  // 距中心越远出现越晚（按距离加权），叠加少量随机抖动，避免像整齐的水波纹
  const WAVE = 900
  shards.forEach((s) => {
    s.delay = s.dist * s.dist * WAVE + Math.random() * 90
  })

  // 与单卡「彻底删除」一致的玻璃质感，只是每块的渐变角度随机
  const glass = (angle: number) =>
    `linear-gradient(${angle}deg, color-mix(in srgb, var(--ink-700) 94%, transparent), color-mix(in srgb, var(--ink-800) 90%, transparent))`

  const layer = document.createElement('div')
  layer.setAttribute('aria-hidden', 'true')
  layer.setAttribute('data-shatter-page', '1')
  layer.style.cssText = 'position:fixed;inset:0;z-index:200;pointer-events:none;overflow:hidden'

  for (const s of shards) {
    const tile = document.createElement('div')
    tile.style.cssText = [
      'position:absolute',
      `left:${s.x.toFixed(1)}px`,
      `top:${s.y.toFixed(1)}px`,
      `width:${s.w.toFixed(1)}px`,
      `height:${s.h.toFixed(1)}px`,
      'will-change:transform,opacity',
    ].join(';')
    tile.style.background = glass(s.grad)
    tile.style.borderRadius = `${s.radius.toFixed(1)}px`

    tile.style.setProperty('--tx', `${s.tx.toFixed(1)}px`)
    tile.style.setProperty('--ty', `${s.ty.toFixed(1)}px`)
    tile.style.setProperty('--rot', `${s.rot.toFixed(1)}deg`)
    tile.style.setProperty('--sc', s.sc.toFixed(3))
    // 出现时从中心方向弹到自己的位置，然后保持不透明，等待整层一起淡出
    tile.style.animation = `shatter-pop ${Math.round(s.dur)}ms cubic-bezier(.45,.06,.3,1) ${Math.round(s.delay)}ms both`

    layer.appendChild(tile)
  }

  // 铺满一圈（最远碎片约 dist²*WAVE ≈ 900ms）后再等片刻，整层一起缓缓消失
  const FADE_DELAY = 980
  layer.style.animation = `shatter-layer-fade 1100ms ease ${FADE_DELAY}ms both`

  document.body.appendChild(layer)

  let removed = false
  let timer = 0
  const dispose = () => {
    if (removed) return
    removed = true
    window.clearTimeout(timer)
    layer.remove()
  }

  timer = window.setTimeout(() => {
    dispose()
    opts.onDone?.()
  }, FADE_DELAY + 1100 + 160)

  return dispose
}
