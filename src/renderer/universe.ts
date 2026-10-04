/**
 * The universe behind the graph: two layers of stars that move a little with
 * the camera (parallax) and one faint nebula per community, laid over its real
 * nodes. Nothing here is decoration without data except the stars, and nothing
 * runs on its own: the layer is drawn again only when the camera, the size of
 * the view or the drawn graph changes.
 */
import type { KnowledgeGraph } from '@/graph'
import { communityColor, mutedCommunityColor } from '@/utils/color'

export interface Constellation {
  readonly communityId: number
  /** Drawn nodes of the community. */
  readonly count: number
  /** Centroid of its drawn nodes, in graph coordinates. */
  readonly x: number
  readonly y: number
  /** Root mean square distance of its nodes to the centroid, in graph units. */
  readonly spread: number
  /** Most of it is third-party code: drawn in the muted slate family. */
  readonly isThirdParty: boolean
}

/** Communities smaller than this are not a shape worth a nebula or a name. */
export const MIN_CONSTELLATION_SIZE = 4

/**
 * Every community with enough drawn nodes, largest first (ties by id, so the
 * order never depends on the graph's insertion order).
 */
export function computeConstellations(
  graph: KnowledgeGraph,
  isDrawn: (nodeId: string) => boolean,
): Constellation[] {
  const sums = new Map<number, { n: number; x: number; y: number; xx: number; yy: number; thirdParty: number }>()
  graph.forEachNode((nodeId, attributes) => {
    if (attributes.community === null || !isDrawn(nodeId)) return
    const sum = sums.get(attributes.community) ?? { n: 0, x: 0, y: 0, xx: 0, yy: 0, thirdParty: 0 }
    sum.n += 1
    sum.x += attributes.x
    sum.y += attributes.y
    sum.xx += attributes.x * attributes.x
    sum.yy += attributes.y * attributes.y
    if (attributes.isThirdParty) sum.thirdParty += 1
    sums.set(attributes.community, sum)
  })
  const constellations: Constellation[] = []
  for (const [communityId, sum] of sums) {
    if (sum.n < MIN_CONSTELLATION_SIZE) continue
    const x = sum.x / sum.n
    const y = sum.y / sum.n
    const variance = Math.max(0, sum.xx / sum.n - x * x + (sum.yy / sum.n - y * y))
    constellations.push({
      communityId,
      count: sum.n,
      x,
      y,
      spread: Math.sqrt(variance),
      isThirdParty: sum.thirdParty * 2 > sum.n,
    })
  }
  return constellations.sort((a, b) => b.count - a.count || a.communityId - b.communityId)
}

export interface ScreenProjection {
  /** Graph coordinates → CSS pixels of the view. */
  readonly toViewport: (point: { x: number; y: number }) => { x: number; y: number }
  /** Camera in framed-graph units, for the parallax of the stars. */
  readonly camera: { readonly x: number; readonly y: number; readonly ratio: number }
  /**
   * The eye on screen, in CSS pixels: its centre (the centre of the framed
   * graph) and the radius of the iris (half the framed graph).
   */
  readonly eye?: { readonly x: number; readonly y: number; readonly radius: number }
}


export interface UniverseState {
  readonly constellations: readonly Constellation[]
  /** Radii of the iris rings, as fractions of the iris radius (see irisRings). */
  readonly rings: readonly number[]
  /** Community hovered, inspected or explored: its nebula is one step brighter. */
  readonly highlightedCommunity: number | null
}

export interface UniverseLayer {
  /** Draws again only if something it depends on changed since the last call. */
  draw(projection: ScreenProjection, state: UniverseState): void
  destroy(): void
}

/** At most this many nebulae: the largest communities carry the shape of the universe. */
export const MAX_NEBULAE = 48
const NEBULA_ALPHA = 0.1
const NEBULA_ALPHA_HIGHLIGHTED = 0.2
/** A nebula covers its community and a margin around it, within these limits (CSS pixels). */
const NEBULA_SPREAD_FACTOR = 1.6
const NEBULA_MIN_RADIUS = 28
const NEBULA_MAX_RADIUS_SHARE = 0.45
const SPRITE_SIZE = 128
/** The eye fades out as the camera gets close: whole above this ratio, gone below the next. */
const EYE_FULL_FROM_RATIO = 0.7
const EYE_GONE_BELOW_RATIO = 0.3
/** Upper and lower lids: their corners and their highest point, in iris radii. */
const LID_CORNER = 1.6
const LID_CONTROL_X = 0.75
const LID_CONTROL_Y = 1.55
const LIMBUS = 1.07
const LIMBUS_TICKS = 144
const PUPIL_SHARE = 0.17
const PUPIL_CORE_SHARE = 0.018

/**
 * The iris as the graph draws it: fractions of the iris radius at which a
 * quarter, half and three quarters of the drawn nodes lie from the centre.
 * Pure; real data, so the rings move when the scope or the filters change.
 */
export function irisRings(graph: KnowledgeGraph, isDrawn: (nodeId: string) => boolean): number[] {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  const points: { x: number; y: number }[] = []
  graph.forEachNode((nodeId, { x, y }) => {
    if (!isDrawn(nodeId)) return
    points.push({ x, y })
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  })
  const half = Math.max(maxX - minX, maxY - minY) / 2
  if (points.length < MIN_CONSTELLATION_SIZE || !(half > 0)) return []
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const distances = points.map((p) => Math.hypot(p.x - cx, p.y - cy) / half).sort((a, b) => a - b)
  return [0.25, 0.5, 0.75].map((q) => distances[Math.floor(q * (distances.length - 1))] ?? 0)
}

/** Two depths: far stars move 3 % as much as the graph, near ones 8 %. About 1,100 on a laptop screen. */
const STAR_LAYERS = [
  { count: 155, parallax: 0.03, size: 1, alpha: [0.12, 0.3] },
  { count: 65, parallax: 0.08, size: 1.5, alpha: [0.18, 0.35] },
] as const
/**
 * Stars repeat on a square tile, drawn once into its own canvas: moving the
 * camera only blits a dozen tiles, never thousands of points.
 */
export const STAR_TILE = 512
/** On a phone one sparser layer is enough. */
const COMPACT_WIDTH = 720

interface Star {
  readonly x: number
  readonly y: number
  readonly alpha: number
}

/** Small deterministic generator: the same sky on every load. */
function makeStars(count: number, seed: number, alpha: readonly [number, number]): Star[] {
  let state = seed
  const next = (): number => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
  return Array.from({ length: count }, () => ({
    x: next() * STAR_TILE,
    y: next() * STAR_TILE,
    alpha: alpha[0] + next() * (alpha[1] - alpha[0]),
  }))
}

function wrap(value: number, size: number): number {
  return ((value % size) + size) % size
}

/** 1 from afar, fading to 0 as the camera closes in: the eye is the view of the whole. */
export function eyePresence(cameraRatio: number): number {
  const t = (cameraRatio - EYE_GONE_BELOW_RATIO) / (EYE_FULL_FROM_RATIO - EYE_GONE_BELOW_RATIO)
  return Math.max(0, Math.min(1, t))
}

interface EyeOnScreen {
  readonly x: number
  readonly y: number
  readonly radius: number
}

/**
 * The eye, drawn from the graph: radial connections from the pupil to every
 * large community, iris rings where the nodes really lie, the limbus with its
 * scale, the lids around the whole, and the luminous pupil. Static.
 */
function drawEye(
  context: CanvasRenderingContext2D,
  eye: EyeOnScreen,
  rings: readonly number[],
  communities: readonly { x: number; y: number }[],
  presence: number,
): void {
  const { x, y, radius: r } = eye
  const pupil = r * PUPIL_SHARE

  if (presence > 0) {
    context.globalCompositeOperation = 'lighter'
    context.lineCap = 'round'

    // Radial connections: the pupil looks at every community it can see.
    context.beginPath()
    for (const target of communities) {
      const dx = target.x - x
      const dy = target.y - y
      const length = Math.hypot(dx, dy)
      if (length <= pupil) continue
      context.moveTo(x + (dx / length) * pupil, y + (dy / length) * pupil)
      context.lineTo(target.x, target.y)
    }
    context.globalAlpha = 0.09 * presence
    context.strokeStyle = '#7aa8ff'
    context.lineWidth = 1
    context.stroke()

    // Iris rings, where a quarter, half and three quarters of the nodes lie.
    rings.forEach((fraction, index) => {
      context.beginPath()
      context.arc(x, y, Math.max(pupil * 1.3, fraction * r), 0, Math.PI * 2)
      context.setLineDash(index === 1 ? [] : [2, 6])
      context.globalAlpha = (index === 1 ? 0.16 : 0.12) * presence
      context.strokeStyle = index === 2 ? '#8a6bff' : '#4d86ff'
      context.stroke()
    })
    context.setLineDash([])

    // Limbus: the edge of the iris, with a fine scale like an optical instrument.
    const limbus = r * LIMBUS
    const gradient = context.createLinearGradient(x - limbus, y - limbus, x + limbus, y + limbus)
    gradient.addColorStop(0, '#4fe3ff')
    gradient.addColorStop(0.5, '#4d86ff')
    gradient.addColorStop(1, '#9b6bff')
    context.beginPath()
    context.arc(x, y, limbus, 0, Math.PI * 2)
    context.globalAlpha = 0.34 * presence
    context.strokeStyle = gradient
    context.lineWidth = 1.2
    context.stroke()
    context.beginPath()
    for (let tick = 0; tick < LIMBUS_TICKS; tick++) {
      const angle = (tick / LIMBUS_TICKS) * Math.PI * 2
      const length = tick % 12 === 0 ? 10 : tick % 4 === 0 ? 6 : 3
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      context.moveTo(x + cos * (limbus + 3), y + sin * (limbus + 3))
      context.lineTo(x + cos * (limbus + 3 + length), y + sin * (limbus + 3 + length))
    }
    context.globalAlpha = 0.22 * presence
    context.lineWidth = 1
    context.stroke()

    // Lids: two long arcs that turn the ring of knowledge into an eye.
    const lid = (direction: 1 | -1, offset: number): void => {
      context.moveTo(x - r * LID_CORNER, y)
      context.bezierCurveTo(
        x - r * LID_CONTROL_X,
        y + direction * r * (LID_CONTROL_Y + offset),
        x + r * LID_CONTROL_X,
        y + direction * r * (LID_CONTROL_Y + offset),
        x + r * LID_CORNER,
        y,
      )
    }
    const lidGradient = context.createLinearGradient(x - r * LID_CORNER, y, x + r * LID_CORNER, y)
    lidGradient.addColorStop(0, 'rgba(77, 134, 255, 0)')
    lidGradient.addColorStop(0.3, '#4d86ff')
    lidGradient.addColorStop(0.5, '#4fe3ff')
    lidGradient.addColorStop(0.7, '#8a6bff')
    lidGradient.addColorStop(1, 'rgba(138, 107, 255, 0)')
    context.beginPath()
    lid(-1, 0)
    lid(1, 0)
    context.globalAlpha = 0.62 * presence
    context.strokeStyle = lidGradient
    context.lineWidth = 1.4
    context.stroke()
    context.beginPath()
    lid(-1, 0.07)
    lid(1, 0.07)
    context.setLineDash([1, 7])
    context.globalAlpha = 0.34 * presence
    context.lineWidth = 1
    context.stroke()
    context.setLineDash([])
  }

  // Pupil: the luminous centre, always there, the brightest point of the view.
  context.globalCompositeOperation = 'lighter'
  const halo = context.createRadialGradient(x, y, 0, x, y, pupil * 2.4)
  halo.addColorStop(0, 'rgba(245, 251, 255, 0.75)')
  halo.addColorStop(0.06, 'rgba(190, 240, 255, 0.35)')
  halo.addColorStop(0.3, 'rgba(79, 227, 255, 0.1)')
  halo.addColorStop(1, 'rgba(79, 227, 255, 0)')
  context.globalAlpha = 0.8
  context.fillStyle = halo
  context.fillRect(x - pupil * 2.4, y - pupil * 2.4, pupil * 4.8, pupil * 4.8)
  context.beginPath()
  context.arc(x, y, pupil, 0, Math.PI * 2)
  context.globalAlpha = 0.45 * Math.max(presence, 0.4)
  context.strokeStyle = '#bff3ff'
  context.lineWidth = 1
  context.stroke()
  context.beginPath()
  context.arc(x, y, Math.max(2.5, r * PUPIL_CORE_SHARE), 0, Math.PI * 2)
  context.globalAlpha = 0.95
  context.fillStyle = '#f5fbff'
  context.fill()
}

const INERT_LAYER: UniverseLayer = { draw() {}, destroy() {} }

/**
 * Canvas behind Sigma's own canvases. Inert (draws nothing) without a DOM or a
 * 2D context, as in unit tests.
 */
export function createUniverseLayer(container: HTMLElement): UniverseLayer {
  if (typeof document === 'undefined' || typeof container.prepend !== 'function') return INERT_LAYER
  const canvas = document.createElement('canvas')
  canvas.className = 'eog-universe'
  canvas.setAttribute('aria-hidden', 'true')
  container.prepend(canvas)
  const context = canvas.getContext('2d')
  const stars = STAR_LAYERS.map((layer, index) => ({ ...layer, stars: makeStars(layer.count, 20261004 + index, layer.alpha) }))
  const sprites = new Map<string, HTMLCanvasElement>()
  let tiles: { readonly ratio: number; readonly canvases: readonly HTMLCanvasElement[] } | null = null

  /** One canvas per star layer, at the screen's pixel ratio; rebuilt only if that ratio changes. */
  const starTiles = (ratio: number): readonly HTMLCanvasElement[] => {
    if (tiles?.ratio === ratio) return tiles.canvases
    const canvases = stars.map((layer) => {
      const tile = document.createElement('canvas')
      tile.width = Math.round(STAR_TILE * ratio)
      tile.height = Math.round(STAR_TILE * ratio)
      const tileContext = tile.getContext('2d')
      if (!tileContext) return tile
      tileContext.setTransform(ratio, 0, 0, ratio, 0, 0)
      tileContext.fillStyle = '#cfe0ff'
      for (const star of layer.stars) {
        tileContext.globalAlpha = star.alpha
        tileContext.fillRect(star.x, star.y, layer.size, layer.size)
      }
      return tile
    })
    tiles = { ratio, canvases }
    return canvases
  }
  let lastKey = ''
  let lastState: UniverseState | null = null

  /** A soft round light in one colour, scaled for every nebula of that colour. */
  const spriteFor = (color: string): HTMLCanvasElement | null => {
    const cached = sprites.get(color)
    if (cached) return cached
    const sprite = document.createElement('canvas')
    sprite.width = SPRITE_SIZE
    sprite.height = SPRITE_SIZE
    const spriteContext = sprite.getContext('2d')
    if (!spriteContext) return null
    const half = SPRITE_SIZE / 2
    const gradient = spriteContext.createRadialGradient(half, half, 0, half, half, half)
    gradient.addColorStop(0, color)
    gradient.addColorStop(0.45, `${color}80`)
    gradient.addColorStop(1, `${color}00`)
    spriteContext.fillStyle = gradient
    spriteContext.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE)
    sprites.set(color, sprite)
    return sprite
  }

  return {
    draw(projection, state) {
      if (!context) return
      const width = container.clientWidth
      const height = container.clientHeight
      const ratio = window.devicePixelRatio || 1
      const { camera, eye } = projection
      const key = `${width}|${height}|${ratio}|${camera.x}|${camera.y}|${camera.ratio}`
      if (key === lastKey && state === lastState) return
      lastKey = key
      lastState = state
      if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
        canvas.width = Math.round(width * ratio)
        canvas.height = Math.round(height * ratio)
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, width, height)
      const isCompact = width <= COMPACT_WIDTH

      // Stars: far away, so they only drift a few percent of what the graph moves.
      context.globalCompositeOperation = 'source-over'
      context.globalAlpha = 1
      const layerCount = isCompact ? 1 : stars.length
      const canvases = starTiles(ratio)
      const unit = Math.min(width, height) / camera.ratio
      for (let index = 0; index < layerCount; index++) {
        const layer = stars[index]
        const tile = canvases[index]
        if (!layer || !tile) continue
        const offsetX = wrap(-camera.x * unit * layer.parallax, STAR_TILE)
        const offsetY = wrap(camera.y * unit * layer.parallax, STAR_TILE)
        for (let x = offsetX - STAR_TILE; x < width; x += STAR_TILE) {
          for (let y = offsetY - STAR_TILE; y < height; y += STAR_TILE) {
            context.drawImage(tile, x, y, STAR_TILE, STAR_TILE)
          }
        }
      }

      // Nebulae: real communities, real extent, barely there.
      context.globalCompositeOperation = 'lighter'
      const maxRadius = Math.min(width, height) * NEBULA_MAX_RADIUS_SHARE
      const nebulae = state.constellations.slice(0, MAX_NEBULAE)
      const centres: { x: number; y: number }[] = []
      for (const constellation of nebulae) {
        const centre = projection.toViewport(constellation)
        centres.push(centre)
        const edge = projection.toViewport({ x: constellation.x + constellation.spread, y: constellation.y })
        const radius = Math.min(
          maxRadius,
          Math.max(NEBULA_MIN_RADIUS, Math.hypot(edge.x - centre.x, edge.y - centre.y) * NEBULA_SPREAD_FACTOR),
        )
        if (centre.x + radius < 0 || centre.y + radius < 0 || centre.x - radius > width || centre.y - radius > height) {
          continue
        }
        const color = constellation.isThirdParty
          ? mutedCommunityColor(constellation.communityId)
          : communityColor(constellation.communityId)
        const sprite = spriteFor(color)
        if (!sprite) continue
        context.globalAlpha =
          constellation.communityId === state.highlightedCommunity ? NEBULA_ALPHA_HIGHLIGHTED : NEBULA_ALPHA
        context.drawImage(sprite, centre.x - radius, centre.y - radius, radius * 2, radius * 2)
      }

      if (eye && eye.radius > 0) drawEye(context, eye, state.rings, centres, eyePresence(camera.ratio))
      context.globalCompositeOperation = 'source-over'
      context.globalAlpha = 1
    },
    destroy() {
      canvas.remove()
      sprites.clear()
      tiles = null
    },
  }
}
