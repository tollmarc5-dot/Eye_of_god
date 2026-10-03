import type { ReactNode } from 'react'

interface IconProps {
  readonly size?: number
}

function Icon({ size = 16, children }: IconProps & { readonly children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

export const PlusIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 3v10M3 8h10" />
  </Icon>
)

export const MinusIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 8h10" />
  </Icon>
)

export const ChevronIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6 3.5 10.5 8 6 12.5" />
  </Icon>
)

export const CloseIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m4 4 8 8M12 4l-8 8" />
  </Icon>
)

export const SearchIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="7" cy="7" r="4" />
    <path d="m10 10 3.5 3.5" />
  </Icon>
)

export const PanelIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="2" y="3" width="12" height="10" rx="1" />
    <path d="M6 3v10" />
  </Icon>
)

export const TargetIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="8" cy="8" r="2.5" />
    <path d="M8 1.5v2.5M8 12v2.5M1.5 8H4M12 8h2.5" />
  </Icon>
)

export const ResetIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2.5 6V2.5M2.5 6H6M13.5 10v3.5M13.5 10H10" />
    <path d="M3 6a5.5 5.5 0 0 1 10-1M13 10a5.5 5.5 0 0 1-10 1" />
  </Icon>
)

export const ExpandIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />
  </Icon>
)

export const ArrowInIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M13 8H4M7.5 4.5 4 8l3.5 3.5" />
  </Icon>
)

export const ArrowOutIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" />
  </Icon>
)

export const PathIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="3" cy="12.5" r="1.5" />
    <circle cx="13" cy="3.5" r="1.5" />
    <path d="M4.5 12.5H8a2 2 0 0 0 2-2v-3a2 2 0 0 1 2-2h-.5" />
  </Icon>
)

/** "Show only this": a funnel. */
export const IsolateIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2.5 3.5h11L9.5 8.5v4l-3 1.2V8.5Z" />
  </Icon>
)

export const LinkIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6.8 9.2a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-.9.9" />
    <path d="M9.2 6.8a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l.9-.9" />
  </Icon>
)

export const LoopIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12.5 8a4.5 4.5 0 1 1-1.6-3.4M11 2v3H8" />
  </Icon>
)

export const NeighborsIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="8" cy="8" r="2" />
    <circle cx="2.8" cy="3.5" r="1.2" />
    <circle cx="13.2" cy="3.5" r="1.2" />
    <circle cx="8" cy="14" r="1.2" />
    <path d="M6.4 6.8 3.7 4.4M9.6 6.8l2.7-2.4M8 10v2.8" />
  </Icon>
)

/** Minimal eye / orbit mark. Swap this component for the final logo later. */
export function EyeSymbol({ size = 28 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="14" cy="14" r="12.5" opacity="0.35" strokeDasharray="2 3" />
      <path d="M3 14c3-5 7-7.5 11-7.5S22 9 25 14c-3 5-7 7.5-11 7.5S6 19 3 14Z" />
      <circle cx="14" cy="14" r="3.6" />
      <circle cx="14" cy="14" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  )
}
