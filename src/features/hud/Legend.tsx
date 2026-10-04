import { useEffect, useId, useRef, useState } from 'react'
import { LegendIcon } from '@/ui/icons'

interface LegendEntry {
  /** Class of the little sample drawn in CSS (see components.css, .eog-legend__mark). */
  readonly mark: string
  readonly term: string
  readonly meaning: string
}

/** What every mark of the graph means. Identity never rests on colour alone. */
const ENTRIES: readonly LegendEntry[] = [
  { mark: 'size', term: 'Size and brightness', meaning: 'connections (degree)' },
  { mark: 'family', term: 'Blue to violet', meaning: 'project code, one tone per community' },
  { mark: 'muted', term: 'Dim slate', meaning: 'third-party code' },
  { mark: 'nebula', term: 'Haze and capital names', meaning: 'a community and its extent' },
  { mark: 'aggregate', term: 'Disc with a rim', meaning: 'a collapsed community' },
  { mark: 'selected', term: 'Cyan ring and plate', meaning: 'the selected node' },
  { mark: 'flow', term: 'Moving cyan pulses', meaning: 'relations of the active node, source to target' },
]

/**
 * Compact key, bottom-left. Folded by default: one button; open, a small
 * card above it. Escape or a click elsewhere folds it again.
 */
export function Legend() {
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!isOpen) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setIsOpen(false)
      buttonRef.current?.focus()
    }
    const onPointer = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer)
    }
  }, [isOpen])

  return (
    <div className="eog-legend" ref={rootRef}>
      <div id={panelId} className="eog-legend__panel" role="region" aria-label="Legend" hidden={!isOpen}>
        <p className="eog-legend__title">Reading the universe</p>
        <dl className="eog-legend__list">
          {ENTRIES.map((entry) => (
            <div key={entry.mark} className="eog-legend__item">
              <dt>
                <span className={`eog-legend__mark eog-legend__mark--${entry.mark}`} aria-hidden="true" />
                {entry.term}
              </dt>
              <dd>{entry.meaning}</dd>
            </div>
          ))}
        </dl>
      </div>
      <button
        ref={buttonRef}
        type="button"
        className="eog-button eog-legend__toggle"
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={() => setIsOpen((open) => !open)}
      >
        <LegendIcon />
        Legend
      </button>
    </div>
  )
}
