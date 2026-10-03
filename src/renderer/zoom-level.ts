/**
 * Three semantic zoom levels. Today they only drive label density; later
 * phases hang community / folder / detail behaviour on the same levels.
 */
export type ZoomLevel = 'universe' | 'structure' | 'detail'

export interface ViewInfo {
  readonly level: ZoomLevel
  /** 100 = whole graph fits the viewport, 500 = five times closer. */
  readonly zoomPercent: number
}

// Sigma's camera ratio: 1 = default framing, smaller = closer.
/**
 * How far the camera may go: 50× closer than the default framing, or 4× farther.
 * Beyond that the graph is a dot or a single blurred node, and the view is lost.
 */
export const CAMERA_RATIO_LIMITS = { min: 0.02, max: 4 } as const
const STRUCTURE_BELOW_RATIO = 0.7
const DETAIL_BELOW_RATIO = 0.25

/** Minimum on-screen node size for its label to be drawn, per level. */
export const LABEL_THRESHOLD_BY_LEVEL: Readonly<Record<ZoomLevel, number>> = {
  universe: 13,
  structure: 8,
  detail: 4,
}

export function zoomLevelForRatio(ratio: number): ZoomLevel {
  if (ratio < DETAIL_BELOW_RATIO) return 'detail'
  if (ratio < STRUCTURE_BELOW_RATIO) return 'structure'
  return 'universe'
}

export function viewInfoForRatio(ratio: number): ViewInfo {
  return { level: zoomLevelForRatio(ratio), zoomPercent: Math.round(100 / ratio) }
}
