import { useEffect } from 'react'
import { useAppStore } from '@/state/store'

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

/**
 * Global keys of the navigation layer. Escape leaves the temporary mode that
 * is active (path first, then expansion, then the inspected community); "[" and "]" walk the history.
 * A component that already used the key marks the event as handled.
 */
function handleNavigationKeys(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
  if (isTypingTarget(event.target)) return
  const state = useAppStore.getState()
  if (event.key === 'Escape') {
    if (state.path.status !== 'idle') state.clearPath()
    else if (state.expansion && state.selectedNodeId) state.setExpansion(state.selectedNodeId, null)
    else if (state.selectedCommunityId !== null) state.selectCommunity(null)
  } else if (event.key === '[') {
    state.goBack()
  } else if (event.key === ']') {
    state.goForward()
  }
}

/** Installs the global navigation keys for as long as the caller is mounted. */
export function useNavigationKeys(): void {
  useEffect(() => {
    window.addEventListener('keydown', handleNavigationKeys)
    return () => window.removeEventListener('keydown', handleNavigationKeys)
  }, [])
}
