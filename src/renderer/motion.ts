import type { ZoomLevel } from './zoom-level'

/**
 * How much the renderer is allowed to animate. It only ever steps down, when
 * frames get slow: 'full' → 'calm' (no ambient data flow, smaller drift) →
 * 'still' (no continuous animation at all, nothing runs per frame).
 */
export type MotionQuality = 'full' | 'calm' | 'still'

/** Visual effects of one frame. All of it is presentation: no graph data lives here. */
export interface Effects {
  /** Largest drift of a node around its base position, in CSS pixels. */
  readonly amplitude: number
  /** Halo strength multiplier, 0..1. */
  readonly glow: number
  /** Strength of the data pulses on resting edges, 0..1. */
  readonly ambientFlow: number
  /** Strength of the data pulses on the edges of the hovered / selected node, 0..1. */
  readonly focusFlow: number
}

/** Level of detail: the closer the camera, the more each effect shows. */
// No pulses on resting edges: a pulse says a relation is active (hover,
// selection, path), never decoration.
const EFFECTS_BY_LEVEL: Readonly<Record<ZoomLevel, Effects>> = {
  universe: { amplitude: 1.2, glow: 0.75, ambientFlow: 0, focusFlow: 1 },
  structure: { amplitude: 1.9, glow: 0.9, ambientFlow: 0, focusFlow: 1 },
  detail: { amplitude: 3, glow: 1, ambientFlow: 0, focusFlow: 1 },
}

const CALM_AMPLITUDE_FACTOR = 0.6

/** The effects for a zoom level, reduced by the quality the device can hold. */
export function resolveEffects(level: ZoomLevel, quality: MotionQuality): Effects {
  const base = EFFECTS_BY_LEVEL[level]
  if (quality === 'full') return base
  if (quality === 'calm') {
    return { ...base, amplitude: base.amplitude * CALM_AMPLITUDE_FACTOR, ambientFlow: 0 }
  }
  // Static states stay: halos, rings and focus still read without any motion.
  return { ...base, amplitude: 0, ambientFlow: 0, focusFlow: 0 }
}

/** Reduced motion starts, and stays, at the level with no continuous animation. */
export function initialQuality(prefersReducedMotion: boolean): MotionQuality {
  return prefersReducedMotion ? 'still' : 'full'
}

export function isAnimated(quality: MotionQuality): boolean {
  return quality !== 'still'
}

const NEXT_LOWER: Readonly<Record<MotionQuality, MotionQuality>> = {
  full: 'calm',
  calm: 'still',
  still: 'still',
}

/** Frames per measuring window (~1.5 s at 60 FPS). */
export const MONITOR_WINDOW_FRAMES = 90
/** Average frame time above which the quality steps down (~42 FPS). */
export const SLOW_FRAME_MS = 24
/** Longer gaps are a hidden tab or a breakpoint, not slow rendering. */
const IGNORED_GAP_MS = 250

export interface FrameMonitor {
  /** Feeds one frame duration; returns the quality to use from now on. */
  sample(frameMs: number): MotionQuality
  readonly quality: MotionQuality
}

/**
 * Watches frame times and lowers the quality when a whole window is slow.
 * It never raises it again: flipping back and forth would be worse than calm.
 */
export function createFrameMonitor(initial: MotionQuality): FrameMonitor {
  let quality = initial
  let frames = 0
  let total = 0
  return {
    get quality() {
      return quality
    },
    sample(frameMs) {
      if (frameMs > IGNORED_GAP_MS) return quality
      frames += 1
      total += frameMs
      if (frames < MONITOR_WINDOW_FRAMES) return quality
      if (total / frames > SLOW_FRAME_MS) quality = NEXT_LOWER[quality]
      frames = 0
      total = 0
      return quality
    },
  }
}

/**
 * Values the shaders read every frame. Deliberately mutable and shared by
 * reference: it is the per-frame channel between the render loop and the
 * WebGL programs, and never touches React or the store.
 */
export interface MotionUniforms {
  /** Seconds since the renderer started; frozen while nothing animates. */
  time: number
  amplitude: number
  glow: number
  ambientFlow: number
  focusFlow: number
}

export function createMotionUniforms(effects: Effects): MotionUniforms {
  return { time: 0, ...effects }
}

/** Fraction of the gap to the target covered per frame: level changes ease in, never jump. */
const EASING_PER_FRAME = 0.08
const SETTLED = 0.001

function ease(current: number, target: number): number {
  const next = current + (target - current) * EASING_PER_FRAME
  return Math.abs(target - next) < SETTLED ? target : next
}

/** Moves the uniforms one frame towards `target`. Mutates `uniforms` (see MotionUniforms). */
export function stepUniforms(uniforms: MotionUniforms, target: Effects, timeSeconds: number): void {
  uniforms.time = timeSeconds
  uniforms.amplitude = ease(uniforms.amplitude, target.amplitude)
  uniforms.glow = ease(uniforms.glow, target.glow)
  uniforms.ambientFlow = ease(uniforms.ambientFlow, target.ambientFlow)
  uniforms.focusFlow = ease(uniforms.focusFlow, target.focusFlow)
}
