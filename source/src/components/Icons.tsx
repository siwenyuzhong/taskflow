import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Base({ size = 18, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const IconPlus = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 5v14M5 12h14" />
  </Base>
)

export const IconCheck = (p: IconProps) => (
  <Base {...p}>
    <path d="M20 6 9 17l-5-5" />
  </Base>
)

export const IconCheckCircle = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8.5 12.2 2.4 2.4 4.6-5" />
  </Base>
)

export const IconClock = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5V12l3 1.8" />
  </Base>
)

export const IconHourglass = (p: IconProps) => (
  <Base {...p}>
    <path d="M7 3h10M7 21h10M8 3c0 4 4 5 4 9s-4 5-4 9M16 3c0 4-4 5-4 9s4 5 4 9" />
  </Base>
)

export const IconRenew = (p: IconProps) => (
  <Base {...p}>
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 4v5h-5" />
  </Base>
)

export const IconTrash = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 7h16M10 11v6M14 11v6" />
    <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </Base>
)

export const IconSearch = (p: IconProps) => (
  <Base {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Base>
)

export const IconLayers = (p: IconProps) => (
  <Base {...p}>
    <path d="m12 3 9 5-9 5-9-5 9-5Z" />
    <path d="m3 13 9 5 9-5" />
  </Base>
)

export const IconBolt = (p: IconProps) => (
  <Base {...p}>
    <path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5Z" />
  </Base>
)

export const IconFlame = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 22c4 0 7-2.7 7-6.5 0-4.5-4-6-4.5-11-2.5 1.5-4 4-4 6 0 1-.5 1.5-1 1.5s-1-.5-1-1.5c-1.6 1.4-2.5 3.4-2.5 5C6 19.3 8 22 12 22Z" />
  </Base>
)

export const IconFlower = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="2.1" />
    {[0, 72, 144, 216, 288].map((a) => (
      <ellipse key={a} cx="12" cy="6.5" rx="2" ry="3.3" transform={`rotate(${a} 12 12)`} />
    ))}
  </Base>
)

export const IconSun = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Base>
)

export const IconMoon = (p: IconProps) => (
  <Base {...p}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
  </Base>
)

export const IconVolume = (p: IconProps) => (
  <Base {...p}>
    <path d="M11 5 6.5 9H3v6h3.5L11 19V5Z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 6a9 9 0 0 1 0 12" />
  </Base>
)

export const IconVolumeOff = (p: IconProps) => (
  <Base {...p}>
    <path d="M11 5 6.5 9H3v6h3.5L11 19V5Z" />
    <path d="m16 10 5 5M21 10l-5 5" />
  </Base>
)

export const IconBell = (p: IconProps) => (
  <Base {...p}>
    <path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6Z" />
    <path d="M10.5 19.5a2 2 0 0 0 3 0" />
  </Base>
)

export const IconX = (p: IconProps) => (
  <Base {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Base>
)

export const IconMore = (p: IconProps) => (
  <Base {...p}>
    <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
  </Base>
)

export const IconPencil = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16v4Z" />
    <path d="m13.5 6.5 4 4" />
  </Base>
)

export const IconInbox = (p: IconProps) => (
  <Base {...p}>
    <path d="M3 12h4l2 3h6l2-3h4" />
    <path d="M5 5h14l2 7v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5l2-7Z" />
  </Base>
)

export const IconList = (p: IconProps) => (
  <Base {...p}>
    <path d="M8 6h12" />
    <path d="M8 12h12" />
    <path d="M8 18h12" />
    <path d="M3.5 6h.01" />
    <path d="M3.5 12h.01" />
    <path d="M3.5 18h.01" />
  </Base>
)

export const IconSparkles = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 3.5 13.6 8 18 9.6 13.6 11.2 12 15.7 10.4 11.2 6 9.6 10.4 8 12 3.5Z" />
    <path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" />
  </Base>
)

export const IconTarget = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4.5" />
    <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
  </Base>
)

export const IconChevronDown = (p: IconProps) => (
  <Base {...p}>
    <path d="m6 9 6 6 6-6" />
  </Base>
)

export const IconArrowRight = (p: IconProps) => (
  <Base {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Base>
)

export const IconPalette = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 21a9 9 0 1 1 9-9c0 2.2-1.6 3-3 3h-1.4a1.8 1.8 0 0 0-1.3 3.1A1.8 1.8 0 0 1 12 21Z" />
    <circle cx="8" cy="11" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="12" cy="8" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="16" cy="11" r="1.2" fill="currentColor" stroke="none" />
  </Base>
)

export const IconFolder = (p: IconProps) => (
  <Base {...p}>
    <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10v7.5A1.5 1.5 0 0 1 17.5 19h-13A1.5 1.5 0 0 1 3 17.5v-10Z" />
  </Base>
)

export const IconFilter = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 6h16M7 12h10M10 18h4" />
  </Base>
)

export const IconCalendar = (p: IconProps) => (
  <Base {...p}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
    <path d="M3.5 10h17M8 3.5V7M16 3.5V7" />
  </Base>
)

export const IconCalendarPlus = (p: IconProps) => (
  <Base {...p}>
    <path d="M20.5 12.5V8a3 3 0 0 0-3-3h-11a3 3 0 0 0-3 3v9a3 3 0 0 0 3 3h5" />
    <path d="M3.5 10h17M8 3.5V7M16 3.5V7" />
    <path d="M18 15.5v6M15 18.5h6" />
  </Base>
)

export const IconCalendarWeek = (p: IconProps) => (
  <Base {...p}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
    <path d="M3.5 10h17M8 3.5V7M16 3.5V7" />
    <path d="M8 15h3M13 15h3M8 18h3" />
  </Base>
)

export const IconChevronLeft = (p: IconProps) => (
  <Base {...p}>
    <path d="M15 6l-6 6 6 6" />
  </Base>
)

export const IconChevronRight = (p: IconProps) => (
  <Base {...p}>
    <path d="M9 6l6 6-6 6" />
  </Base>
)

export const IconPin = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 17v4" />
    <path d="M8 3h8l-1 6 3 3v2H6v-2l3-3-1-6Z" />
  </Base>
)

export const IconRepeat = (p: IconProps) => (
  <Base {...p}>
    <path d="m17 2 4 4-4 4" />
    <path d="M3 11V9a4 4 0 0 1 4-4h14" />
    <path d="m7 22-4-4 4-4" />
    <path d="M21 13v2a4 4 0 0 1-4 4H3" />
  </Base>
)

export const IconTable = (p: IconProps) => (
  <Base {...p}>
    <rect x="3.5" y="4" width="17" height="16" rx="2" />
    <path d="M3.5 9.5h17M9.5 9.5V20M15.5 9.5V20M3.5 14.5h17" />
  </Base>
)

export const IconDownload = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 4v11M7.5 11 12 15.5 16.5 11" />
    <path d="M5 20h14" />
  </Base>
)

export const IconUpload = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5" />
    <path d="M5 20h14" />
  </Base>
)

export const IconAlignLeft = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 6h14M4 12h18M4 18h10" />
  </Base>
)

export const IconAlignCenter = (p: IconProps) => (
  <Base {...p}>
    <path d="M5 6h14M2 12h20M7 18h10" />
  </Base>
)

export const IconAlignRight = (p: IconProps) => (
  <Base {...p}>
    <path d="M6 6h14M2 12h18M10 18h10" />
  </Base>
)

export const IconBrush = (p: IconProps) => (
  <Base {...p}>
    <path d="M14.5 3.5l6 6-8 8H7.5V11.5z" />
    <path d="M7.5 14.5C5.5 15 4.5 16.5 3.5 19.5c3-1 4.5-1.5 5.5-3" />
  </Base>
)

export const IconCopy = (p: IconProps) => (
  <Base {...p}>
    <rect x="8.5" y="8.5" width="12" height="12" rx="2.5" />
    <path d="M15.5 5.5A2.5 2.5 0 0 0 13 3H6a3 3 0 0 0-3 3v7a2.5 2.5 0 0 0 2.5 2.5" />
  </Base>
)

export const IconMaximize = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </Base>
)

export const IconMinimize = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5" />
  </Base>
)

export const IconChartBar = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 4v16h16" />
    <path d="M8 16v-4M12 16V8M16 16v-6" />
  </Base>
)

export const IconNote = (p: IconProps) => (
  <Base {...p}>
    <path d="M5 3.5h9.5L20 9v11.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1Z" />
    <path d="M14 3.5V9h5.5" />
    <path d="M7.5 13h9M7.5 16.5h6" />
  </Base>
)

export const IconPlay = (p: IconProps) => (
  <Base {...p}>
    <path d="M7 4.5v15l13-7.5-13-7.5Z" />
  </Base>
)

export const IconPause = (p: IconProps) => (
  <Base {...p}>
    <path d="M9 4.5v15M15 4.5v15" />
  </Base>
)

export const IconMic = (p: IconProps) => (
  <Base {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
  </Base>
)

