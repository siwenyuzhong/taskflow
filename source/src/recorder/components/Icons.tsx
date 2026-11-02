import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement>

const base = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const
}

export const MicIcon = (p: P) => (
  <svg {...base} {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0" />
    <path d="M12 18v3" />
  </svg>
)

export const DiscIcon = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)

export const LibraryIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 5v14" />
    <path d="M9 5v14" />
    <path d="M14.5 6.2l4.2 12.2" />
  </svg>
)

export const PauseIcon = (p: P) => (
  <svg {...base} {...p}>
    <rect x="7" y="5" width="3.5" height="14" rx="1.2" />
    <rect x="13.5" y="5" width="3.5" height="14" rx="1.2" />
  </svg>
)

export const StopIcon = (p: P) => (
  <svg {...base} {...p}>
    <rect x="6.5" y="6.5" width="11" height="11" rx="2" />
  </svg>
)

export const PlayIcon = (p: P) => (
  <svg {...base} {...p} fill="currentColor" stroke="none">
    <path d="M8 5.5v13l11-6.5z" />
  </svg>
)

export const TrashIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 7h16" />
    <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
  </svg>
)

export const FolderIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 7a2 2 0 0 1 2-2h3.5l2 2H18a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
  </svg>
)

export const WaveIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3 12h2l2-5 3 12 3-16 3 13 2-4h3" />
  </svg>
)

export const TextIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M5 6h14" />
    <path d="M5 12h10" />
    <path d="M5 18h7" />
  </svg>
)

export const MinusIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M5 12h14" />
  </svg>
)

export const SquareIcon = (p: P) => (
  <svg {...base} {...p} width={12} height={12}>
    <rect x="5" y="5" width="14" height="14" rx="2" />
  </svg>
)

export const CloseIcon = (p: P) => (
  <svg {...base} {...p} width={12} height={12}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
)

export const SearchIcon = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4 4" />
  </svg>
)

export const ChevronIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M9 6l6 6-6 6" />
  </svg>
)

export const CloudIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M7 18a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 9.5a3.5 3.5 0 0 1-.5 6.96z" />
    <path d="M12 12v5" />
    <path d="M9.5 15.5 12 18l2.5-2.5" />
  </svg>
)

export const SunIcon = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
  </svg>
)

export const MoonIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" />
  </svg>
)

export const AutoThemeIcon = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none" />
  </svg>
)

export const ExpandIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M9 4H4v5" />
    <path d="M15 4h5v5" />
    <path d="M9 20H4v-5" />
    <path d="M15 20h5v-5" />
  </svg>
)

export const CollapseIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 9h5V4" />
    <path d="M20 9h-5V4" />
    <path d="M4 15h5v5" />
    <path d="M20 15h-5v5" />
  </svg>
)
