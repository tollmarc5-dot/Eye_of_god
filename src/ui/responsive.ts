import type { AppState } from '@/state/store'

// Must match the breakpoints in layout.css.
export const COMPACT_QUERY = '(max-width: 1100px)'
export const MOBILE_QUERY = '(max-width: 720px)'

/**
 * On a phone the explorer and the inspector are the same bottom sheet, one
 * on top of the other: when one opens, the one that was already open closes.
 * Meant for `useAppStore.subscribe`.
 */
export function keepOneSheetOnPhones(state: AppState, previous: AppState): void {
  const { explorer, inspector } = state.panels
  if (!explorer || !inspector || !window.matchMedia(MOBILE_QUERY).matches) return
  state.setPanel(previous.panels.inspector ? 'inspector' : 'explorer', false)
}
