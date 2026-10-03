import type { Position, PositionMap } from '@/types/graph'

/** The part of the Web Storage API the cache needs (injectable for tests). */
export interface PositionStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

// Bump the version whenever the layout algorithm or its settings change, so
// positions computed by an older layout are not mixed with new ones.
export const POSITION_CACHE_KEY = 'eye-of-god:positions:v1'

const COORDINATE_DECIMALS = 2

function isCoordinatePair(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  )
}

/**
 * Reads cached positions, keeping only ids that still exist in the graph.
 * The cache is disposable: missing, corrupt or unreadable data yields an
 * empty map and the layout is simply computed again.
 */
export function readPositionCache(
  storage: PositionStorage,
  knownIds: ReadonlySet<string>,
): PositionMap {
  const positions = new Map<string, Position>()
  let parsed: unknown
  try {
    const stored = storage.getItem(POSITION_CACHE_KEY)
    if (stored === null) return positions
    parsed = JSON.parse(stored)
  } catch {
    return positions
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return positions
  for (const [id, value] of Object.entries(parsed)) {
    if (knownIds.has(id) && isCoordinatePair(value)) {
      positions.set(id, { x: value[0], y: value[1] })
    }
  }
  return positions
}

/** Persists positions by node id. Returns false when storage refuses (quota, privacy mode). */
export function writePositionCache(storage: PositionStorage, positions: PositionMap): boolean {
  const scale = 10 ** COORDINATE_DECIMALS
  const round = (value: number): number => Math.round(value * scale) / scale
  const serialisable: Record<string, [number, number]> = {}
  for (const [id, position] of positions) {
    serialisable[id] = [round(position.x), round(position.y)]
  }
  try {
    storage.setItem(POSITION_CACHE_KEY, JSON.stringify(serialisable))
    return true
  } catch {
    return false
  }
}
