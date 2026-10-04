import type { ReactNode } from 'react'
import { useAppStore } from '@/state/store'
import { ConstellationIcon, FiltersIcon, FolderIcon, HubIcon, PanelIcon } from '@/ui/icons'
import { HudButton } from '@/ui/primitives'

interface RailEntry {
  /** `data-section` of the explorer section it opens; none: the explorer as it was. */
  readonly anchor: string | null
  readonly label: string
  readonly icon: ReactNode
}

const ENTRIES: readonly RailEntry[] = [
  { anchor: null, label: 'Open explorer', icon: <PanelIcon /> },
  { anchor: 'projects', label: 'Projects and folders', icon: <FolderIcon /> },
  { anchor: 'communities', label: 'Communities', icon: <ConstellationIcon /> },
  { anchor: 'key-nodes', label: 'Key nodes', icon: <HubIcon /> },
  { anchor: 'filters', label: 'Filters', icon: <FiltersIcon /> },
]

/** Opens the explorer on one of its sections, expanded, scrolled to and focused. */
function revealSection(anchor: string): void {
  const section = document.querySelector<HTMLElement>(`.eog-explorer [data-section="${anchor}"]`)
  const toggle = section?.querySelector<HTMLButtonElement>('.eog-section__toggle')
  if (!section || !toggle) return
  if (toggle.getAttribute('aria-expanded') === 'false') toggle.click()
  section.scrollIntoView({ block: 'start' })
  toggle.focus({ preventScroll: true })
}

/**
 * The explorer folded into a column of 44 px buttons: the universe gets the
 * room back, and every part of the explorer stays one click away.
 */
export function ExplorerRail() {
  const setPanel = useAppStore((state) => state.setPanel)
  const open = (anchor: string | null): void => {
    setPanel('explorer', true)
    // The panel is rendered open in the next frame.
    if (anchor !== null) requestAnimationFrame(() => revealSection(anchor))
  }
  return (
    <nav className="eog-panel-tab eog-panel-tab--left eog-rail" aria-label="Explorer sections">
      {ENTRIES.map((entry) => (
        <HudButton
          key={entry.label}
          label={entry.label}
          iconOnly
          tooltipSide="right"
          onClick={() => open(entry.anchor)}
        >
          {entry.icon}
        </HudButton>
      ))}
    </nav>
  )
}
