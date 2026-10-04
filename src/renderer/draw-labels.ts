import type { NodeDisplayData } from 'sigma/types'
import { CANVAS_THEME } from '@/styles/canvas-theme'
import {
  createLabelPlacer,
  LABEL_RANK,
  PLATE_PADDING_X,
  plateBox,
  type LabelBounds,
  type LabelCandidate,
  type LabelRank,
} from './label-layout'
import { SELECTED_ACCENT } from './reducers'

const HALO_WIDTH = 3
const PLATE_RADIUS = 3

interface LabelSettings {
  readonly labelSize: number
  readonly labelFont: string
  readonly labelWeight: string
}

/** What Sigma hands to a label drawing function: the reducer output, in viewport pixels. */
export type LabelData = Pick<NodeDisplayData, 'x' | 'y' | 'size'> & {
  key?: string
  label?: string | null
  highlighted?: boolean
  forceLabel?: boolean
  accent?: number
  aggregate?: number
}

function setFont(context: CanvasRenderingContext2D, settings: LabelSettings): void {
  context.font = `${settings.labelWeight} ${settings.labelSize}px ${settings.labelFont}`
  context.textBaseline = 'middle'
}

/** Where a node's label stands in the order of the frame, from what the reducers decided. */
export function labelRankOf(data: LabelData): LabelRank {
  if (data.highlighted) return (data.accent ?? 0) >= SELECTED_ACCENT ? LABEL_RANK.selected : LABEL_RANK.hovered
  if (data.forceLabel) return LABEL_RANK.forced
  if (data.aggregate) return LABEL_RANK.aggregate
  return LABEL_RANK.regular
}

/**
 * Selected / hovered node: the label on a dark plate. The ring and the glow
 * are drawn by the node program in WebGL, where they follow the node's drift.
 */
export function drawNodeHover(
  context: CanvasRenderingContext2D,
  data: LabelData,
  settings: LabelSettings,
): void {
  if (!data.label) return
  setFont(context, settings)
  const width = context.measureText(data.label).width
  const box = plateBox(
    { key: data.key ?? '', label: data.label, x: data.x, y: data.y, size: data.size, rank: LABEL_RANK.selected },
    width,
    settings.labelSize,
  )

  context.beginPath()
  context.roundRect(box.left, box.top, box.right - box.left, box.bottom - box.top, PLATE_RADIUS)
  context.fillStyle = CANVAS_THEME.plate
  context.fill()
  context.lineWidth = 1
  context.strokeStyle = CANVAS_THEME.accent
  context.stroke()

  context.fillStyle = CANVAS_THEME.label
  context.fillText(data.label, box.left + PLATE_PADDING_X, data.y)
}

/** Regular label: light text with a dark halo, readable over nodes and edges. */
function drawLabelText(context: CanvasRenderingContext2D, label: string, x: number, y: number): void {
  context.lineJoin = 'round'
  context.lineWidth = HALO_WIDTH
  context.strokeStyle = CANVAS_THEME.labelHalo
  context.strokeText(label, x, y)
  context.fillStyle = CANVAS_THEME.label
  context.fillText(label, x, y)
}

/** A point the label layer names on its own, centred: a constellation at universe scale. */
export interface NamedPoint {
  readonly key: string
  readonly name: string
  readonly x: number
  readonly y: number
}

/** Constellation names: spaced mono capitals, quieter than node labels. */
const CONSTELLATION_FONT = `500 ${CANVAS_THEME.constellationSize}px ${CANVAS_THEME.monoFont}`
const CONSTELLATION_TRACKING = '2px'
const CONSTELLATION_MAX_CHARS = 28

function constellationText(name: string): string {
  const upper = name.toUpperCase()
  return upper.length > CONSTELLATION_MAX_CHARS ? `${upper.slice(0, CONSTELLATION_MAX_CHARS - 1).trimEnd()}…` : upper
}

function withConstellationType<T>(context: CanvasRenderingContext2D, run: () => T): T {
  const font = context.font
  const tracking = context.letterSpacing
  context.font = CONSTELLATION_FONT
  context.letterSpacing = CONSTELLATION_TRACKING
  try {
    return run()
  } finally {
    context.font = font
    context.letterSpacing = tracking
  }
}

function drawConstellationText(context: CanvasRenderingContext2D, label: string, x: number, y: number): void {
  withConstellationType(context, () => {
    context.lineJoin = 'round'
    context.lineWidth = HALO_WIDTH
    context.strokeStyle = CANVAS_THEME.labelHalo
    context.strokeText(label, x, y)
    context.fillStyle = CANVAS_THEME.constellation
    context.fillText(label, x, y)
  })
}

export interface LabelLayer {
  /** Sigma's `defaultDrawNodeLabel`: records the candidate, draws nothing yet. */
  collect(context: CanvasRenderingContext2D, data: LabelData, settings: LabelSettings): void
  /** Before each Sigma render: a new frame starts with no candidate. */
  reset(): void
  /**
   * After Sigma has handed over every candidate of the frame: places and draws
   * them, inside `bounds` (the viewport minus the HUD) when given.
   */
  draw(bounds?: LabelBounds, named?: readonly NamedPoint[]): void
  /** How far a selected node's plate reaches right of the node centre, in pixels; 0 before the first frame. */
  plateReach(data: Pick<LabelData, 'size' | 'label'>): number
}

/**
 * Collision-free labels on top of Sigma's own selection. Sigma still decides
 * which nodes may be labelled (label grid, size threshold, screen bounds) and
 * calls `collect` for each; the frame's labels are then placed together, in
 * priority order (see label-layout), and drawn once. Selected and hovered
 * nodes keep their plate on Sigma's hover layer: here they only reserve room.
 */
export function createLabelLayer(
  /** The label canvas and Sigma's label settings, for frames where Sigma hands over no candidate. */
  fallback: () => { context: CanvasRenderingContext2D; settings: LabelSettings } | null = () => null,
): LabelLayer {
  const place = createLabelPlacer()
  const widths = new Map<string, number>()
  const namedWidths = new Map<string, number>()
  let widthFont = ''
  let candidates: LabelCandidate[] = []
  let target: { context: CanvasRenderingContext2D; settings: LabelSettings } | null = null

  return {
    collect(context, data, settings) {
      target = { context, settings }
      if (!data.label) return
      candidates.push({
        key: data.key ?? data.label,
        label: data.label,
        x: data.x,
        y: data.y,
        size: data.size,
        rank: labelRankOf(data),
      })
    },
    reset() {
      candidates = []
    },
    draw(bounds, named = []) {
      if (candidates.length === 0 && named.length === 0) return
      target ??= fallback()
      if (!target) return
      const { context, settings } = target
      setFont(context, settings)
      // Text widths only depend on the font: measured once per label.
      if (context.font !== widthFont) {
        widths.clear()
        widthFont = context.font
      }
      const measure = (label: string): number => {
        let width = widths.get(label)
        if (width === undefined) {
          width = context.measureText(label).width
          widths.set(label, width)
        }
        return width
      }
      const names = named.map((point): LabelCandidate => {
        const label = constellationText(point.name)
        let width = namedWidths.get(label)
        if (width === undefined) {
          width = withConstellationType(context, () => context.measureText(label).width)
          namedWidths.set(label, width)
        }
        const { key, x, y } = point
        return { key, label, x, y, size: 0, rank: LABEL_RANK.constellation, style: 'constellation', width }
      })
      const all = names.length === 0 ? candidates : [...candidates, ...names]
      for (const { candidate, textX } of place(all, { labelSize: settings.labelSize, measure }, bounds)) {
        if (candidate.style === 'constellation') drawConstellationText(context, candidate.label, textX, candidate.y)
        else drawLabelText(context, candidate.label, textX, candidate.y)
      }
    },
    plateReach(data) {
      if (!target || !data.label) return 0
      setFont(target.context, target.settings)
      const box = plateBox(
        { key: '', label: data.label, x: 0, y: 0, size: data.size, rank: LABEL_RANK.selected },
        target.context.measureText(data.label).width,
        target.settings.labelSize,
      )
      return box.right
    },
  }
}
