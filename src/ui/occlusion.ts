import { useEffect, type RefObject } from 'react'
import { quantizeRect, sameRects, type ScreenRect } from '@/renderer/free-area'

/**
 * HUD pieces that cover the graph: header (wordmark, search, status cluster),
 * the two panels (bottom sheets on a phone), their edge tabs, the dock, the
 * zoom read-out and the mode band. The search results list is left out on
 * purpose: it is transient, and typing must never move the camera.
 */
export const HUD_ZONE_SELECTOR = [
  // The wordmark's children: the element itself stretches over its whole grid column.
  '.eog-wordmark > *',
  '.eog-topbar__search',
  '.eog-topbar__end',
  '.eog-explorer',
  '.eog-inspector',
  '.eog-panel-tab',
  '.eog-dock',
  '.eog-readout',
  '.eog-mode',
].join(', ')

/** Measurements closer than this are the same: no churn while a panel settles. */
const QUANTUM_PX = 8

function isShown(element: Element): boolean {
  // A closed panel keeps its box while it fades out. (Other pieces use data-open
  // for something else: the search field for its results list.)
  if (element.classList.contains('eog-panel') && element.getAttribute('data-open') === 'false') return false
  if (element.getClientRects().length === 0) return false
  return getComputedStyle(element).visibility !== 'hidden'
}

/**
 * Rectangles the HUD covers, relative to `root` (the HUD layer, which sits
 * exactly over the graph), quantized and in document order.
 */
export function measureHudZones(root: HTMLElement): ScreenRect[] {
  const origin = root.getBoundingClientRect()
  const rects: ScreenRect[] = []
  for (const element of root.querySelectorAll(HUD_ZONE_SELECTOR)) {
    if (!isShown(element)) continue
    const box = element.getBoundingClientRect()
    if (box.width <= 0 || box.height <= 0) continue
    rects.push(
      quantizeRect(
        {
          left: box.left - origin.left,
          top: box.top - origin.top,
          right: box.right - origin.left,
          bottom: box.bottom - origin.top,
        },
        QUANTUM_PX,
      ),
    )
  }
  return rects
}

/**
 * Keeps `onChange` informed of what the HUD covers. Measures when a HUD piece
 * appears, disappears, opens, closes, resizes or finishes a transition, and
 * when the window resizes; at most once per frame, and only reports a change.
 * Nothing runs while the HUD stays the same.
 */
export function useHudOcclusion(
  hudRef: RefObject<HTMLElement | null>,
  onChange: (rects: readonly ScreenRect[]) => void,
): void {
  useEffect(() => {
    const root = hudRef.current
    if (!root) return
    let last: readonly ScreenRect[] = []
    let frame: number | null = null

    const measure = (): void => {
      frame = null
      const rects = measureHudZones(root)
      if (sameRects(rects, last)) return
      last = rects
      onChange(rects)
    }
    const schedule = (): void => {
      if (frame === null) frame = requestAnimationFrame(measure)
    }

    const resizes = new ResizeObserver(schedule)
    const observeZones = (): void => {
      resizes.disconnect()
      resizes.observe(root)
      for (const element of root.querySelectorAll(HUD_ZONE_SELECTOR)) resizes.observe(element)
    }
    // Pieces mount and unmount (the mode band), panels open and close.
    const mutations = new MutationObserver(() => {
      observeZones()
      schedule()
    })
    mutations.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-open', 'hidden'] })
    observeZones()
    window.addEventListener('resize', schedule)
    // Opening and closing animate a transform, which no observer sees: measure once it lands.
    root.addEventListener('transitionend', schedule)
    measure()

    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      resizes.disconnect()
      mutations.disconnect()
      window.removeEventListener('resize', schedule)
      root.removeEventListener('transitionend', schedule)
    }
  }, [hudRef, onChange])
}
