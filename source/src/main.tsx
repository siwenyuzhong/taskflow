import { createRoot } from 'react-dom/client'
import App from './App'
import { FloatRecorder } from './recorder/windows/FloatRecorder'
import { SubtitleOverlay } from './recorder/windows/SubtitleOverlay'
import { LightFly } from './components/LightFly'
import './index.css'

const container = document.getElementById('root')
if (!container) throw new Error('#root 未找到')

// 主窗口之外的辅助窗口复用同一份 index.html，用 hash 区分路由：
//   #float    → 后台录制悬浮球
//   #subtitle → 字幕悬浮窗
//   #lightfly → 轻量模式的「飘过提醒」（屏幕顶部透明窗）
// 这些辅助窗口为透明窗口，需要页面背景透明。
const route = window.location.hash.replace(/^#/, '')
if (route === 'float' || route === 'subtitle' || route === 'lightfly') {
  document.documentElement.classList.add('sr-floating')
}

createRoot(container).render(
  route === 'float' ? (
    <FloatRecorder />
  ) : route === 'subtitle' ? (
    <SubtitleOverlay />
  ) : route === 'lightfly' ? (
    <LightFly />
  ) : (
    <App />
  )
)
