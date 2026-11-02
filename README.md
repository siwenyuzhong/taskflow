Electron + electron-builder，具体栈：
- 桌面框架: Electron 33
- 打包工具: electron-builder 25（electron-builder.yml mac / electron-builder-win.yml windows）
- 前端: React 18 + TypeScript + Vite 5 + Tailwind CSS 3
- 产物: mac 出 dmg（arm64），windows 配置在 electron-builder-win.yml
- 打包命令: npm run dist → vite build + electron-builder --mac dmg
