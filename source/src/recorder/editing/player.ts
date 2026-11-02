/**
 * 编辑器的回放控制桥。
 * 真正的 WaveSurfer 实例在组件里，挂载时把实现注入到这里，
 * 工具栏等非组件代码即可直接调用。
 */
export const editorPlayer = {
  play: (): void => undefined,
  pause: (): void => undefined,
  toggle: (): void => undefined,
  setRate: (_r: number): void => undefined,
  seek: (_t: number): void => undefined,
  getTime: (): number => 0
}
