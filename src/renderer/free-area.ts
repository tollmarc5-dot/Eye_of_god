import type { Position } from '@/types/graph'

/**
 * The part of the screen the graph can really be seen in.
 *
 * The HUD floats over the graph: header, panels, dock, read-outs. It reports
 * the rectangles it covers; the renderer keeps labels out of them and centres
 * the camera in what is left. Pure geometry, in CSS pixels of the graph's
 * viewport (its container), so it is the same at every screen size.
 */

/** A rectangle in CSS pixels of the graph's viewport. */
export interface ScreenRect {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

/** How far the free area starts from each edge of the viewport. */
export interface FreeInsets {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

export const NO_INSETS: FreeInsets = { left: 0, top: 0, right: 0, bottom: 0 }

/** A side panel: at least this share of the viewport's height. */
const TALL_SHARE = 0.4
/** A bottom or top sheet: at least this share of the viewport's width. */
const WIDE_SHARE = 0.6
/** A bar (header piece, dock, read-out, mode band): at most this share of the height. */
const BAR_SHARE = 0.15
/** Bars this close to the top or bottom edge push that edge in. */
const EDGE_BAND_SHARE = 0.2
/** Whatever the HUD covers, the graph keeps at least this much room. */
const MIN_FREE_WIDTH_SHARE = 0.3
const MIN_FREE_HEIGHT_SHARE = 0.25

function clip(rect: ScreenRect, width: number, height: number): ScreenRect | null {
  const left = Math.max(0, rect.left)
  const top = Math.max(0, rect.top)
  const right = Math.min(width, rect.right)
  const bottom = Math.min(height, rect.bottom)
  return right > left && bottom > top ? { left, top, right, bottom } : null
}

/** Shrinks two opposite insets in proportion until at least `minFree` remains between them. */
function keepRoom(start: number, end: number, size: number, minFree: number): [number, number] {
  const covered = start + end
  const allowed = Math.max(0, size - minFree)
  if (covered <= allowed || covered === 0) return [start, end]
  const scale = allowed / covered
  return [start * scale, end * scale]
}

/**
 * Turns the HUD's rectangles into insets. Tall pieces push the side they sit
 * on, wide pieces the top or bottom, and thin bars near the top or bottom
 * edge (header, dock, read-outs, mode band) push that edge. Anything else (a
 * short panel in a corner) does not move the framing: the label layer avoids
 * it, and a selected node under it still counts as hidden.
 */
export function freeInsets(width: number, height: number, rects: readonly ScreenRect[]): FreeInsets {
  if (!(width > 0) || !(height > 0)) return NO_INSETS
  let left = 0
  let top = 0
  let right = 0
  let bottom = 0
  for (const raw of rects) {
    const rect = clip(raw, width, height)
    if (!rect) continue
    const isTall = rect.bottom - rect.top >= height * TALL_SHARE
    const isWide = rect.right - rect.left >= width * WIDE_SHARE
    const centreX = (rect.left + rect.right) / 2
    const centreY = (rect.top + rect.bottom) / 2
    if (isWide) {
      if (centreY < height / 2) top = Math.max(top, rect.bottom)
      else bottom = Math.max(bottom, height - rect.top)
    } else if (isTall) {
      if (centreX < width / 2) left = Math.max(left, rect.right)
      else right = Math.max(right, width - rect.left)
    } else if (rect.bottom - rect.top <= height * BAR_SHARE) {
      if (rect.top < height * EDGE_BAND_SHARE) top = Math.max(top, rect.bottom)
      else if (rect.bottom > height * (1 - EDGE_BAND_SHARE)) bottom = Math.max(bottom, height - rect.top)
    }
  }
  const [freeLeft, freeRight] = keepRoom(left, right, width, width * MIN_FREE_WIDTH_SHARE)
  const [freeTop, freeBottom] = keepRoom(top, bottom, height, height * MIN_FREE_HEIGHT_SHARE)
  return { left: freeLeft, top: freeTop, right: freeRight, bottom: freeBottom }
}

/** Centre of the free area. */
export function freeCentre(width: number, height: number, insets: FreeInsets): Position {
  return {
    x: (insets.left + width - insets.right) / 2,
    y: (insets.top + height - insets.bottom) / 2,
  }
}

/** Whether a point lies inside the free area, `margin` pixels away from its edges. */
export function isInFreeArea(point: Position, width: number, height: number, insets: FreeInsets, margin = 0): boolean {
  return (
    point.x >= insets.left + margin &&
    point.x <= width - insets.right - margin &&
    point.y >= insets.top + margin &&
    point.y <= height - insets.bottom - margin
  )
}

/** Whether a point lies under one of the rectangles, grown by `margin` pixels. */
export function isUnderRects(point: Position, rects: readonly ScreenRect[], margin = 0): boolean {
  return rects.some(
    (rect) =>
      point.x >= rect.left - margin &&
      point.x <= rect.right + margin &&
      point.y >= rect.top - margin &&
      point.y <= rect.bottom + margin,
  )
}

/** Rectangles that differ by less than a step are the same: no churn while a panel settles. */
export function quantizeRect(rect: ScreenRect, step: number): ScreenRect {
  return {
    left: Math.floor(rect.left / step) * step,
    top: Math.floor(rect.top / step) * step,
    right: Math.ceil(rect.right / step) * step,
    bottom: Math.ceil(rect.bottom / step) * step,
  }
}

export function sameRects(a: readonly ScreenRect[], b: readonly ScreenRect[]): boolean {
  if (a.length !== b.length) return false
  return a.every((rect, index) => {
    const other = b[index]
    return (
      other !== undefined &&
      rect.left === other.left &&
      rect.top === other.top &&
      rect.right === other.right &&
      rect.bottom === other.bottom
    )
  })
}
