import { useId, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react'
import { ChevronIcon } from './icons'

/** Arrow keys walk the buttons of a list; Tab still leaves it as usual. */
export function moveBetweenRows(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  const rows = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
  const current = rows.indexOf(document.activeElement as HTMLButtonElement)
  if (current < 0) return
  event.preventDefault()
  rows[(current + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]?.focus()
}

interface PanelProps {
  readonly title: string
  readonly className: string
  readonly isOpen: boolean
  /** Buttons shown at the right of the header (close, collapse…). */
  readonly actions?: ReactNode
  /** The scrolling body, for panels that need to move its scroll position. */
  readonly bodyRef?: Ref<HTMLDivElement>
  /** Anchor for skip links. */
  readonly id?: string
  readonly children: ReactNode
}

/** Floating HUD surface. When closed it is hidden AND removed from the tab order. */
export function Panel({ title, className, isOpen, actions, bodyRef, id, children }: PanelProps) {
  const titleId = useId()
  return (
    <section
      id={id}
      tabIndex={id ? -1 : undefined}
      className={`eog-panel ${className}`}
      aria-labelledby={titleId}
      data-open={isOpen}
      inert={!isOpen}
    >
      <header className="eog-panel__header">
        <h2 id={titleId} className="eog-panel__title">
          {title}
        </h2>
        {actions}
      </header>
      <div className="eog-panel__body" ref={bodyRef}>
        {children}
      </div>
    </section>
  )
}

interface SectionProps {
  readonly title: string
  readonly count?: number
  readonly defaultOpen?: boolean
  /** Name other parts of the HUD use to reach this section (the explorer rail). */
  readonly anchor?: string
  readonly children: ReactNode
}

/** Collapsible group inside a panel (disclosure pattern). */
export function Section({ title, count, defaultOpen = true, anchor, children }: SectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const contentId = useId()
  return (
    <div className="eog-section" data-section={anchor}>
      <h3>
        <button
          type="button"
          className="eog-section__toggle"
          aria-expanded={isOpen}
          aria-controls={contentId}
          onClick={() => setIsOpen((open) => !open)}
        >
          <span className="eog-section__chevron">
            <ChevronIcon size={12} />
          </span>
          <span className="eog-heading">{title}</span>
          {count !== undefined && <span className="eog-section__count">{count}</span>}
        </button>
      </h3>
      <div id={contentId} className="eog-section__content" hidden={!isOpen}>
        {children}
      </div>
    </div>
  )
}

interface HudButtonProps {
  /** Accessible name; also shown as the tooltip. */
  readonly label: string
  readonly onClick: () => void
  readonly disabled?: boolean
  /** Set for toggle buttons. */
  readonly pressed?: boolean
  readonly tooltipSide?: 'top' | 'bottom' | 'right'
  readonly tooltipAlign?: 'start' | 'end'
  /** Icon and/or short visible text. */
  readonly children: ReactNode
  readonly iconOnly?: boolean
}

/** Small HUD control with an accessible name and a hover/focus tooltip. */
export function HudButton({
  label,
  onClick,
  disabled,
  pressed,
  tooltipSide = 'top',
  tooltipAlign,
  children,
  iconOnly = false,
}: HudButtonProps) {
  return (
    <button
      type="button"
      className={iconOnly ? 'eog-button eog-button--icon' : 'eog-button'}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
      <span className="eog-tip" data-side={tooltipSide} data-align={tooltipAlign} aria-hidden="true">
        {label}
      </span>
    </button>
  )
}

interface SwitchProps {
  readonly label: string
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
}

/** On/off control. State is shown by position, colour and the ON/OFF text. */
export function Switch({ label, checked, onChange }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      className="eog-switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span className="eog-switch__label">{label}</span>
      <span className="eog-switch__state" aria-hidden="true">
        {checked ? 'ON' : 'OFF'}
      </span>
      <span className="eog-switch__track" aria-hidden="true" />
    </button>
  )
}

interface EmptyStateProps {
  readonly title: string
  readonly hint?: string
  readonly compact?: boolean
  readonly mark?: ReactNode
}

export function EmptyState({ title, hint, compact = false, mark }: EmptyStateProps) {
  return (
    <div className={compact ? 'eog-empty eog-empty--compact' : 'eog-empty'}>
      {mark && <span className="eog-empty__mark">{mark}</span>}
      <p className="eog-empty__title">{title}</p>
      {hint && <p className="eog-empty__hint">{hint}</p>}
    </div>
  )
}

interface StatProps {
  readonly label: string
  readonly value: string
  /** Secondary figure shown after the value, e.g. "/ 3,271". */
  readonly detail?: string
}

export function Stat({ label, value, detail }: StatProps) {
  return (
    <div className="eog-stat">
      <dt className="eog-label">{label}</dt>
      <dd className="eog-stat__value">
        {value}
        {detail && <small> {detail}</small>}
      </dd>
    </div>
  )
}

export type StatusTone = 'ok' | 'busy' | 'error'

interface StatusIndicatorProps {
  readonly tone: StatusTone
  readonly label: string
  readonly details?: readonly string[]
}

/** System status: the text carries the meaning, the dot only reinforces it. */
export function StatusIndicator({ tone, label, details = [] }: StatusIndicatorProps) {
  return (
    <div className="eog-status" data-tone={tone} role="status">
      <span className="eog-status__main">
        <span className="eog-status__dot" aria-hidden="true" />
        {label}
      </span>
      {details.length > 0 && (
        <span className="eog-status__detail">
          {details.map((detail) => (
            <span key={detail} className="eog-tag">
              {detail}
            </span>
          ))}
        </span>
      )}
    </div>
  )
}

const NUMBER_FORMAT = new Intl.NumberFormat('en-US')

export function formatCount(value: number): string {
  return NUMBER_FORMAT.format(value)
}
