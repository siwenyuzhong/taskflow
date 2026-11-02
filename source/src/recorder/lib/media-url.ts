/**
 * 素材 URL 解析：桌面走主进程注册的 speedrec:// 协议。
 * （安卓 Capacitor 分支已随移植移除——Sloth 为纯桌面应用。）
 */

export async function mediaUrl(id: string, trackKey?: string): Promise<string | null> {
  const path = trackKey
    ? `${encodeURIComponent(id)}/${encodeURIComponent(trackKey)}`
    : encodeURIComponent(id)
  return `speedrec://media/${path}`
}
