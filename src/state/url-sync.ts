import { snapshotView, useAppStore } from './store'
import { decodeViewState, encodeViewState, type ViewState } from './url-state'

/** Camera moves arrive in bursts: the URL waits for them to settle. */
export const CAMERA_SETTLE_MS = 400

/** The address of a view, relative to the current page. */
function toUrl(query: string, location: Location): string {
  return `${location.pathname}${query ? `?${query}` : ''}`
}

/**
 * What counts as going somewhere: these changes add a browser history entry.
 * Everything else (switches, collapse, expansion, camera) rewrites the current one.
 */
function navigationKey(view: ViewState): string {
  return JSON.stringify([
    view.nodeId,
    view.communityId,
    view.path,
    view.aggregation.mode,
    view.project,
    view.folder,
    view.onlyCommunity,
  ])
}

/** Applies the view in the address bar to the store. A no-op until the graph is loaded. */
export function restoreViewFromUrl(search: string): void {
  const state = useAppStore.getState()
  if (state.data.status !== 'ready') return
  state.restoreView(decodeViewState(search, state.data))
}

/** The full link to the current view, for sharing. */
export function currentViewUrl(win: Window = window): string {
  const query = encodeViewState(snapshotView(useAppStore.getState()))
  return `${win.location.origin}${toUrl(query, win.location)}`
}

/**
 * Keeps the address bar in step with the store, one way at a time:
 *   store change → URL (pushState for navigation, replaceState otherwise);
 *   browser Back / Forward → store.
 * The store never reads the URL by itself, so the two cannot feed each other.
 * Returns the function that stops it.
 */
export function startUrlSync(win: Window = window): () => void {
  let isRestoring = false
  let cameraTimer: ReturnType<typeof setTimeout> | null = null
  let lastView = snapshotView(useAppStore.getState())
  let lastQuery = encodeViewState(lastView)
  // The address is rewritten once with the valid, canonical form of what was restored.
  win.history.replaceState(null, '', toUrl(lastQuery, win.location))

  const remember = (view: ViewState, query: string): void => {
    lastView = view
    lastQuery = query
  }

  const write = (view: ViewState, query: string): void => {
    const isNavigation = navigationKey(view) !== navigationKey(lastView)
    remember(view, query)
    if (isNavigation) win.history.pushState(null, '', toUrl(query, win.location))
    else win.history.replaceState(null, '', toUrl(query, win.location))
  }

  const cancelCameraWrite = (): void => {
    if (cameraTimer !== null) clearTimeout(cameraTimer)
    cameraTimer = null
  }

  const unsubscribe = useAppStore.subscribe((state) => {
    if (isRestoring || state.data.status !== 'ready') return
    const view = snapshotView(state)
    const query = encodeViewState(view)
    if (query === lastQuery) return
    cancelCameraWrite()
    const withoutCamera = (target: ViewState): string => encodeViewState({ ...target, camera: null })
    if (withoutCamera(view) !== withoutCamera(lastView)) {
      write(view, query)
      return
    }
    // Only the camera moved: wait until it rests, then rewrite the current entry.
    cameraTimer = setTimeout(() => {
      cameraTimer = null
      const settled = snapshotView(useAppStore.getState())
      const settledQuery = encodeViewState(settled)
      if (settledQuery !== lastQuery) write(settled, settledQuery)
    }, CAMERA_SETTLE_MS)
  })

  const onPopState = (): void => {
    isRestoring = true
    try {
      restoreViewFromUrl(win.location.search)
    } finally {
      isRestoring = false
    }
    // The browser already moved: remember where it is, write nothing.
    cancelCameraWrite()
    const restored = snapshotView(useAppStore.getState())
    remember(restored, encodeViewState(restored))
  }
  win.addEventListener('popstate', onPopState)

  return () => {
    cancelCameraWrite()
    unsubscribe()
    win.removeEventListener('popstate', onPopState)
  }
}
