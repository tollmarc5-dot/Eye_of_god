/**
 * Label placement: which labels of a frame are drawn, and on which side of
 * their node, so that no two of them overlap.
 *
 * Sigma picks the candidates (its label grid, the size threshold, the screen
 * bounds); this module only arbitrates between them. It is pure and
 * deterministic: the same candidates give the same picture, in any order.
 */
import { sameRects } from './free-area'

/** Lower ranks are placed first and win every conflict. */
export const LABEL_RANK = {
  /** Selected node: its label sits on a plate drawn by Sigma's hover layer. */
  selected: 0,
  /** Hovered node: also on a plate. */
  hovered: 1,
  /** Labels the view insists on (the waypoints of a shown path). */
  forced: 2,
  /** A collapsed community: one label stands for many nodes. */
  aggregate: 3,
  /** Everything else, by node size, which encodes the degree. */
  regular: 4,
} as const

export type LabelRank = (typeof LABEL_RANK)[keyof typeof LABEL_RANK]

export interface LabelCandidate {
  readonly key: string
  readonly label: string
  /** Node centre and rendered radius, in CSS pixels of the viewport. */
  readonly x: number
  readonly y: number
  readonly size: number
  readonly rank: LabelRank
}

export interface LabelBox {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

/** A label that will be drawn: text starts at `textX`, vertically centred on `y`. */
export interface PlacedLabel {
  readonly candidate: LabelCandidate
  readonly side: 'right' | 'left'
  readonly textX: number
  readonly box: LabelBox
}

export interface LabelMetrics {
  /** Rendered text height (the label font size). */
  readonly labelSize: number
  /** Width of a label's text in the current font. */
  measure(label: string): number
}

/** Gap between a node and its label. */
export const LABEL_GAP = 4
/** Room for the selection ring the node program draws around the core. */
export const RING_ROOM = 8
export const PLATE_PADDING_X = 7
export const PLATE_PADDING_Y = 5
/** Free space kept around every label so neighbours never touch. */
const LABEL_MARGIN = 2
/** Side of the cells of the collision grid, in pixels. */
const GRID_CELL = 64

/** Selected and hovered nodes: their label is a plate, drawn by Sigma, never dropped. */
export function isPlateRank(rank: LabelRank): boolean {
  return rank === LABEL_RANK.selected || rank === LABEL_RANK.hovered
}

/** The plate of a selected or hovered node, as drawn by drawNodeHover. */
export function plateBox(candidate: LabelCandidate, textWidth: number, labelSize: number): LabelBox {
  const left = candidate.x + candidate.size + RING_ROOM + LABEL_GAP
  const height = labelSize + PLATE_PADDING_Y * 2
  return {
    left,
    top: candidate.y - height / 2,
    right: left + textWidth + PLATE_PADDING_X * 2,
    bottom: candidate.y + height / 2,
  }
}

/**
 * The node itself with its selection ring. Sigma draws selected and hovered
 * nodes on a layer above the labels, so a label under them would be cut.
 */
export function ringBox(candidate: LabelCandidate): LabelBox {
  const reach = candidate.size + RING_ROOM
  return {
    left: candidate.x - reach,
    top: candidate.y - reach,
    right: candidate.x + reach,
    bottom: candidate.y + reach,
  }
}

function textBox(candidate: LabelCandidate, side: PlacedLabel['side'], textWidth: number, labelSize: number): PlacedLabel {
  const offset = candidate.size + LABEL_GAP
  const textX = side === 'right' ? candidate.x + offset : candidate.x - offset - textWidth
  return {
    candidate,
    side,
    textX,
    box: {
      left: textX - LABEL_MARGIN,
      top: candidate.y - labelSize / 2 - LABEL_MARGIN,
      right: textX + textWidth + LABEL_MARGIN,
      bottom: candidate.y + labelSize / 2 + LABEL_MARGIN,
    },
  }
}

/** Priority order: rank, then larger nodes, then the key, so ties never depend on input order. */
export function compareCandidates(a: LabelCandidate, b: LabelCandidate): number {
  if (a.rank !== b.rank) return a.rank - b.rank
  if (a.size !== b.size) return b.size - a.size
  if (a.key === b.key) return 0
  return a.key < b.key ? -1 : 1
}

/** Boxes already taken in this frame, bucketed in a coarse grid for cheap lookups. */
class Occupancy {
  private readonly cells = new Map<number, LabelBox[]>()

  private *cellKeys(box: LabelBox): Generator<number> {
    const x0 = Math.floor(box.left / GRID_CELL)
    const x1 = Math.floor(box.right / GRID_CELL)
    const y0 = Math.floor(box.top / GRID_CELL)
    const y1 = Math.floor(box.bottom / GRID_CELL)
    for (let cx = x0; cx <= x1; cx++) {
      // Two 16-bit halves: unique for any realistic viewport, negative cells included.
      for (let cy = y0; cy <= y1; cy++) yield ((cx & 0xffff) << 16) | (cy & 0xffff)
    }
  }

  collides(box: LabelBox): boolean {
    for (const key of this.cellKeys(box)) {
      for (const other of this.cells.get(key) ?? []) {
        if (box.left < other.right && other.left < box.right && box.top < other.bottom && other.top < box.bottom) {
          return true
        }
      }
    }
    return false
  }

  add(box: LabelBox): void {
    for (const key of this.cellKeys(box)) {
      const cell = this.cells.get(key)
      if (cell) cell.push(box)
      else this.cells.set(key, [box])
    }
  }
}

/** Where labels may go: the viewport, minus what the HUD covers. */
export interface LabelBounds {
  /** Rectangles covered by the HUD. No label is ever drawn into one. */
  readonly reserved: readonly LabelBox[]
  /** Viewport size; a label must fit inside it entirely. Omitted: no edge check. */
  readonly width?: number
  readonly height?: number
}

export const NO_BOUNDS: LabelBounds = { reserved: [] }

/**
 * Greedy placement in priority order:
 * - plates (selected, hovered) are never moved or dropped; they only reserve
 *   room, for the plate and for the node with its ring;
 * - every other label tries the right of its node, then the left;
 * - no label goes into the HUD or past the edge of the viewport;
 * - forced labels are drawn even when both sides are taken by other labels
 *   (on the first side that is clear of the HUD and the edges);
 * - any other label that fits on neither side is left out of this frame.
 * Returns the labels to draw, plates excluded, in priority order.
 */
export function placeLabels(
  candidates: readonly LabelCandidate[],
  metrics: LabelMetrics,
  bounds: LabelBounds = NO_BOUNDS,
): PlacedLabel[] {
  const ordered = [...candidates].sort(compareCandidates)
  const occupancy = new Occupancy()
  const hud = new Occupancy()
  for (const rect of bounds.reserved) hud.add(rect)
  const { width: viewportWidth, height: viewportHeight } = bounds
  const isAllowed = (box: LabelBox): boolean =>
    !hud.collides(box) &&
    (viewportWidth === undefined || (box.left >= 0 && box.right <= viewportWidth)) &&
    (viewportHeight === undefined || (box.top >= 0 && box.bottom <= viewportHeight))
  const placed: PlacedLabel[] = []
  for (const candidate of ordered) {
    const width = metrics.measure(candidate.label)
    if (isPlateRank(candidate.rank)) {
      occupancy.add(plateBox(candidate, width, metrics.labelSize))
      occupancy.add(ringBox(candidate))
      continue
    }
    const sides = [
      textBox(candidate, 'right', width, metrics.labelSize),
      textBox(candidate, 'left', width, metrics.labelSize),
    ].filter((side) => isAllowed(side.box))
    const fit =
      sides.find((side) => !occupancy.collides(side.box)) ??
      (candidate.rank === LABEL_RANK.forced ? sides[0] : undefined)
    if (!fit) continue
    occupancy.add(fit.box)
    placed.push(fit)
  }
  return placed
}

function sameBounds(a: LabelBounds, b: LabelBounds): boolean {
  return a.width === b.width && a.height === b.height && sameRects(a.reserved, b.reserved)
}

function sameCandidates(a: readonly LabelCandidate[], b: readonly LabelCandidate[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const p = a[i]
    const q = b[i]
    if (!p || !q) return false
    if (p.key !== q.key || p.x !== q.x || p.y !== q.y || p.size !== q.size || p.rank !== q.rank || p.label !== q.label) {
      return false
    }
  }
  return true
}

/**
 * placeLabels with a one-frame memory. The living graph redraws every frame
 * while the camera rests: the candidates are then identical, and the previous
 * placement is reused instead of sorted and checked again.
 */
export function createLabelPlacer(): (
  candidates: readonly LabelCandidate[],
  metrics: LabelMetrics,
  bounds?: LabelBounds,
) => PlacedLabel[] {
  let previous: {
    candidates: readonly LabelCandidate[]
    labelSize: number
    bounds: LabelBounds
    placed: PlacedLabel[]
  } | null = null
  return (candidates, metrics, bounds = NO_BOUNDS) => {
    if (
      previous &&
      previous.labelSize === metrics.labelSize &&
      sameBounds(previous.bounds, bounds) &&
      sameCandidates(previous.candidates, candidates)
    ) {
      return previous.placed
    }
    const placed = placeLabels(candidates, metrics, bounds)
    previous = { candidates, labelSize: metrics.labelSize, bounds, placed }
    return placed
  }
}
