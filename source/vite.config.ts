import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      // 「工作速录」移植代码使用的路径别名（对应 autoRec 的 @shared / @renderer）
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/recorder'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome128',
    // AudioWorklet 处理器必须作为独立文件加载（addModule 不能吃 data: URL），
    // 因此对 pcm-processor.js 禁用内联。
    assetsInlineLimit: (filePath) => {
      if (filePath.endsWith('pcm-processor.js')) return false
      return undefined
    },
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
})
