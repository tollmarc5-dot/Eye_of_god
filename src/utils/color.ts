const GOLDEN_RATIO_CONJUGATE = 0.618033988749895
const NO_COMMUNITY_COLOR = '#7f8fb5'
/**
 * Every community colour lives in one family: cyan → electric blue → indigo →
 * violet → purple. Communities differ by where they sit in this arc, never by
 * leaving it, so the graph reads as one system.
 */
export const PALETTE_HUE_START = 190
export const PALETTE_HUE_END = 280
// Hue alone cannot separate 169 communities inside a 90° arc, so lightness
// and saturation cycle too: neighbouring hues land on different bands.
const LIGHTNESS_BANDS = [0.64, 0.55, 0.73, 0.6, 0.69] as const
const SATURATION_BANDS = [0.84, 0.62, 0.74] as const
// Third-party code: slate blues only. A desaturated violet reads as pink and a
// desaturated cyan as green, which would break the family.
const MUTED_HUE_START = 214
const MUTED_HUE_END = 244
const MUTED_SATURATION = 0.24
const MUTED_LIGHTNESS = 0.38
const EDGE_TINT_SATURATION = 0.5
const EDGE_TINT_LIGHTNESS = 0.25
const EDGE_ACTIVE_LIGHTNESS = 0.38

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const chroma = saturation * Math.min(lightness, 1 - lightness)
  const channel = (offset: number): string => {
    const k = (offset + hue / 30) % 12
    const value = lightness - chroma * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(value * 255).toString(16).padStart(2, '0')
  }
  return `#${channel(0)}${channel(8)}${channel(4)}`
}

/** Hue of a community, spread evenly over the palette arc by the golden ratio. */
export function communityHue(community: number): number {
  const position = (Math.abs(community) * GOLDEN_RATIO_CONJUGATE) % 1
  return PALETTE_HUE_START + position * (PALETTE_HUE_END - PALETTE_HUE_START)
}

const colorCache = new Map<number, string>()
const edgeColorCache = new Map<number, string>()
const activeEdgeColorCache = new Map<number, string>()
const mutedColorCache = new Map<number, string>()

/**
 * Deterministic colour per community id, as hex because Sigma's WebGL
 * programs do not parse hsl(). Cached: reducers call this for every node.
 */
export function communityColor(community: number | null): string {
  if (community === null) return NO_COMMUNITY_COLOR
  const cached = colorCache.get(community)
  if (cached) return cached
  const index = Math.abs(community)
  const color = hslToHex(
    communityHue(community),
    SATURATION_BANDS[index % SATURATION_BANDS.length] ?? SATURATION_BANDS[0],
    LIGHTNESS_BANDS[index % LIGHTNESS_BANDS.length] ?? LIGHTNESS_BANDS[0],
  )
  colorCache.set(community, color)
  return color
}

/** Hue of a community inside the narrow slate-blue band used for third-party code. */
function mutedHue(community: number): number {
  const position = (Math.abs(community) * GOLDEN_RATIO_CONJUGATE) % 1
  return MUTED_HUE_START + position * (MUTED_HUE_END - MUTED_HUE_START)
}

/** Dim slate blue: marks third-party code as background structure, still told apart by community. */
export function mutedCommunityColor(community: number | null): string {
  if (community === null) return NO_COMMUNITY_COLOR
  const cached = mutedColorCache.get(community)
  if (cached) return cached
  const color = hslToHex(mutedHue(community), MUTED_SATURATION, MUTED_LIGHTNESS)
  mutedColorCache.set(community, color)
  return color
}

/**
 * Dark tint of the community hue for edges that stay inside one community:
 * clusters read as constellations without drawing any region over the graph.
 * `isActive` lifts it a little for the community being explored.
 */
export function communityEdgeColor(community: number, isActive = false): string {
  const cache = isActive ? activeEdgeColorCache : edgeColorCache
  const cached = cache.get(community)
  if (cached) return cached
  const color = hslToHex(
    communityHue(community),
    EDGE_TINT_SATURATION,
    isActive ? EDGE_ACTIVE_LIGHTNESS : EDGE_TINT_LIGHTNESS,
  )
  cache.set(community, color)
  return color
}

/** '#rrggbb' → [r, g, b] in 0..1, for WebGL uniforms. */
export function hexToUnitRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16)
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255]
}
