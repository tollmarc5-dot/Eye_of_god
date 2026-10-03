const ORBIT_RADII = [250, 340, 430] as const
const TICK_ANGLES = [0, 90, 180, 270] as const
const PARTICLE_COUNT = 140
const VIEW_SIZE = 1000

interface Particle {
  readonly x: number
  readonly y: number
  readonly radius: number
  readonly opacity: number
}

/** Small deterministic generator: the same field of particles on every load. */
function makeParticles(count: number): Particle[] {
  let seed = 20261002
  const next = (): number => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
  return Array.from({ length: count }, () => ({
    x: Math.round(next() * VIEW_SIZE),
    y: Math.round(next() * VIEW_SIZE),
    // Mostly sub-pixel dust; a few slightly larger points give depth.
    radius: next() < 0.12 ? 1.1 : 0.6,
    opacity: Number((0.16 + next() * 0.36).toFixed(2)),
  }))
}

const PARTICLES = makeParticles(PARTICLE_COUNT)

/**
 * Static atmosphere behind the graph: glow, grid and vignette in CSS, a fixed
 * field of faint particles and a handful of SVG orbit lines. Nothing here animates or scales with the data.
 */
export function WorldBackdrop() {
  return (
    <div className="eog-backdrop" aria-hidden="true">
      <svg className="eog-particles" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice">
        {PARTICLES.map((particle, index) => (
          <circle key={index} cx={particle.x} cy={particle.y} r={particle.radius} opacity={particle.opacity} />
        ))}
      </svg>
      <svg className="eog-orbits" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice">
        <g fill="none" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke">
          {ORBIT_RADII.map((radius, index) => (
            <circle
              key={radius}
              cx="500"
              cy="500"
              r={radius}
              strokeDasharray={index === 1 ? '2 10' : undefined}
              opacity={1 - index * 0.25}
            />
          ))}
          {TICK_ANGLES.map((angle) => (
            <path key={angle} d="M500 62v16M500 48v6" transform={`rotate(${angle} 500 500)`} />
          ))}
        </g>
      </svg>
    </div>
  )
}
