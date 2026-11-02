/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Sora', '"PingFang SC"', '"Hiragino Sans GB"', 'sans-serif'],
        sans: ['Manrope', '"PingFang SC"', '"Hiragino Sans GB"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        ink: {
          950: 'var(--ink-950)',
          900: 'var(--ink-900)',
          800: 'var(--ink-800)',
          700: 'var(--ink-700)',
        },
        t1: 'var(--text-1)',
        t2: 'var(--text-2)',
        t3: 'var(--text-3)',
        line: 'var(--line)',
        surface: 'var(--surface)',
        surface2: 'var(--surface-2)',
        accent: {
          DEFAULT: 'var(--accent)',
          soft: 'var(--accent-soft)',
          glow: 'var(--accent-glow)',
          fg: 'var(--accent-fg)',
        },
        cy: 'var(--cy)',
        warn: 'var(--warn)',
        danger: 'var(--danger)',
        ok: 'var(--ok)',

        // 「工作速录」(SpeedRec) 语义色 —— 复用 autoRec 调色板，前缀 sr- 避免与上方令牌冲突
        sr: {
          base: 'rgb(var(--c-base) / <alpha-value>)',
          surface: 'rgb(var(--c-surface) / <alpha-value>)',
          elevated: 'rgb(var(--c-elevated) / <alpha-value>)',
          canvas: 'rgb(var(--c-canvas) / <alpha-value>)',
          line: 'rgb(var(--c-line) / <alpha-value>)',
          ink: 'rgb(var(--c-ink) / <alpha-value>)',
          'ink-muted': 'rgb(var(--c-ink-muted) / <alpha-value>)',
          'ink-faint': 'rgb(var(--c-ink-faint) / <alpha-value>)',
          accent: 'rgb(var(--c-accent) / <alpha-value>)',
          'accent-strong': 'rgb(var(--c-accent-strong) / <alpha-value>)',
          'accent-soft': 'var(--c-accent-soft)',
          rec: 'rgb(var(--c-rec) / <alpha-value>)',
          'rec-soft': 'var(--c-rec-soft)',
          warn: 'rgb(var(--c-warn) / <alpha-value>)',
          'warn-soft': 'var(--c-warn-soft)',
        },
      },
      borderRadius: {
        '4xl': '2rem',
        '5xl': '2.75rem',
      },
      boxShadow: {
        glass: '0 1px 0 0 rgba(255,255,255,0.05) inset, 0 24px 60px -34px rgba(0,0,0,0.7)',
        lift: '0 34px 70px -44px rgba(0,0,0,0.85), 0 1px 0 0 rgba(255,255,255,0.06) inset',
        accent: '0 18px 44px -20px var(--accent-glow)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(14px) scale(0.985)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'pop-in': {
          '0%': { opacity: '0', transform: 'scale(0.9) translateY(10px)' },
          '62%': { opacity: '1', transform: 'scale(1.02) translateY(0)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'slide-in': {
          '0%': { opacity: '0', transform: 'translateX(30px) scale(0.96)' },
          '100%': { opacity: '1', transform: 'translateX(0) scale(1)' },
        },
        drift: {
          '0%,100%': { transform: 'translate3d(0,0,0) scale(1)' },
          '33%': { transform: 'translate3d(5%,-4%,0) scale(1.1)' },
          '66%': { transform: 'translate3d(-4%,5%,0) scale(0.94)' },
        },
        breathe: {
          '0%,100%': { opacity: '0.5', transform: 'scale(1)' },
          '50%': { opacity: '0.95', transform: 'scale(1.05)' },
        },
        sweep: {
          '0%': { transform: 'translateX(-130%)' },
          '100%': { transform: 'translateX(230%)' },
        },
        'pulse-warn': {
          '0%': { boxShadow: '0 0 0 0 rgba(245,165,36,0.5)' },
          '70%': { boxShadow: '0 0 0 14px rgba(245,165,36,0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(245,165,36,0)' },
        },
        burst: {
          '0%': { opacity: '1', transform: 'translate(-50%,-50%) rotate(var(--a)) translateY(-6px) scale(1)' },
          '100%': { opacity: '0', transform: 'translate(-50%,-50%) rotate(var(--a)) translateY(-64px) scale(0.15)' },
        },
        'spin-slow': { to: { transform: 'rotate(360deg)' } },
        'check-draw': { to: { strokeDashoffset: '0' } },
        'sheen-x': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'shake-no': {
          '0%,100%': { transform: 'translateX(0)' },
          '25%': { transform: 'translateX(-5px)' },
          '75%': { transform: 'translateX(5px)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.5s cubic-bezier(0.22,1,0.36,1) both',
        'pop-in': 'pop-in 0.42s cubic-bezier(0.22,1.2,0.36,1) both',
        'slide-in': 'slide-in 0.34s cubic-bezier(0.22,1,0.36,1) both',
        drift: 'drift 24s ease-in-out infinite',
        breathe: 'breathe 5s ease-in-out infinite',
        sweep: 'sweep 2.6s cubic-bezier(0.5,0,0.2,1) infinite',
        'pulse-warn': 'pulse-warn 2s ease-out infinite',
        burst: 'burst 0.8s cubic-bezier(0.2,0.7,0.3,1) forwards',
        'spin-slow': 'spin-slow 16s linear infinite',
        'check-draw': 'check-draw 0.45s 0.05s cubic-bezier(0.65,0,0.35,1) forwards',
        'sheen-x': 'sheen-x 2.6s linear infinite',
        'shake-no': 'shake-no 0.35s ease-in-out',
      },
    },
  },
  plugins: [],
}
