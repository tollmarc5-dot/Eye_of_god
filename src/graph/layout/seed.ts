export interface LayoutNode {
  readonly id: string
  readonly community: number | null
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
const NODE_SPACING = 12
const COMMUNITY_SPACING = 2.2
const NO_COMMUNITY = -1

/**
 * Deterministic starting positions: communities sit on a Fermat spiral
 * (largest first) and their members on a small spiral around each centre.
 * No randomness, so the force layout that refines it is reproducible.
 *
 * `startRadius` pushes every community centre at least that far from the
 * origin; it is how new nodes are seeded around an already laid-out graph.
 *
 * Returns [x0, y0, x1, y1, …] in the order of `nodes`.
 */
export function seedPositions(nodes: readonly LayoutNode[], startRadius = 0): Float32Array {
  const groups = new Map<number, number[]>()
  nodes.forEach((node, index) => {
    const key = node.community ?? NO_COMMUNITY
    const members = groups.get(key) ?? []
    members.push(index)
    groups.set(key, members)
  })
  const ordered = [...groups.entries()].sort(
    ([idA, a], [idB, b]) => b.length - a.length || idA - idB,
  )

  const positions = new Float32Array(nodes.length * 2)
  let placed = 0
  ordered.forEach(([, members], groupIndex) => {
    // Radius grows with the area already used, so big groups get more room.
    const spiralRadius =
      groupIndex === 0 ? 0 : NODE_SPACING * COMMUNITY_SPACING * Math.sqrt(placed + members.length / 2)
    const centreRadius = startRadius + spiralRadius
    const centreAngle = groupIndex * GOLDEN_ANGLE
    const centreX = centreRadius * Math.cos(centreAngle)
    const centreY = centreRadius * Math.sin(centreAngle)
    members.forEach((nodeIndex, memberIndex) => {
      const radius = NODE_SPACING * Math.sqrt(memberIndex + 0.5)
      const angle = memberIndex * GOLDEN_ANGLE
      positions[nodeIndex * 2] = centreX + radius * Math.cos(angle)
      positions[nodeIndex * 2 + 1] = centreY + radius * Math.sin(angle)
    })
    placed += members.length
  })
  return positions
}
