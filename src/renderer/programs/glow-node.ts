import { NodeProgram } from 'sigma/rendering'
import type { NodeDisplayData, RenderParams } from 'sigma/types'
import { floatColor } from 'sigma/utils'
import type { ProgramInfo } from 'sigma/rendering'
import type { EdgeAttributes, NodeAttributes } from '@/graph'
import type { MotionUniforms } from '../motion'
import { DRIFT_GLSL } from './drift.glsl'

/** Extra per-node values the reducers add for this program. */
export interface NodeFx {
  /** 0..1: brightness of the core and strength of the halo. */
  glow?: number
  /** 0 none, HOVER_ACCENT hovered, 1 selected (adds the ring). */
  accent?: number
  community?: number | null
  /** 1 = this node stands for a whole collapsed community. */
  aggregate?: number
  /** Collapsed member: id of the node its relations are drawn to instead. */
  anchor?: string
}

/** The halo reaches this many core radii from the centre. */
const HALO_REACH = 3.2
/**
 * A collapsed community is already a large disc: a short, weaker halo keeps it
 * from blooming over the whole view when the camera gets close.
 */
const AGGREGATE_HALO_REACH = 1.7
const AGGREGATE_HALO_STRENGTH = 0.55
const NO_COMMUNITY = -1

const VERTEX_SHADER = /* glsl */ `
attribute vec4 a_id;
attribute vec4 a_color;
attribute vec2 a_position;
attribute float a_size;
attribute vec4 a_fx;
attribute float a_angle;

uniform mat3 u_matrix;
uniform float u_sizeRatio;
uniform float u_correctionRatio;
${DRIFT_GLSL}

varying vec4 v_color;
varying vec2 v_diffVector;
varying float v_radius;
varying float v_glow;
varying float v_accent;
varying float v_aggregate;

const float bias = 255.0 / 254.0;
const float reach = ${HALO_REACH.toFixed(1)};

void main() {
  float size = a_size * u_correctionRatio / u_sizeRatio * 4.0;
  // The triangle is larger than the node: the halo is drawn in the extra room.
  vec2 diffVector = size * reach * vec2(cos(a_angle), sin(a_angle));
  vec2 clip = (u_matrix * vec3(a_position + diffVector, 1)).xy;
  gl_Position = vec4(clip + eogDrift(a_position, a_fx.z), 0, 1);

  v_diffVector = diffVector;
  v_radius = size / 2.0;
  v_glow = a_fx.x;
  v_accent = a_fx.y;
  v_aggregate = a_fx.w;

  #ifdef PICKING_MODE
  v_color = a_id;
  #else
  v_color = a_color;
  #endif

  v_color.a *= bias;
}
`

const FRAGMENT_SHADER = /* glsl */ `
precision highp float;

varying vec4 v_color;
varying vec2 v_diffVector;
varying float v_radius;
varying float v_glow;
varying float v_accent;
varying float v_aggregate;

uniform float u_correctionRatio;
uniform float u_glowLevel;
uniform float u_pulse;
uniform vec3 u_accentColor;

const float reach = ${HALO_REACH.toFixed(1)};

void main(void) {
  float dist = length(v_diffVector);

  #ifdef PICKING_MODE
  // Only the core is clickable; the halo is light, not surface.
  gl_FragColor = dist > v_radius ? vec4(0.0) : v_color;
  #else
  float border = u_correctionRatio * 2.0;
  float core = 1.0 - smoothstep(v_radius - border, v_radius, dist);

  // Core: the community colour, lifted towards white at the centre.
  float centre = 1.0 - smoothstep(0.0, v_radius, dist);
  vec3 coreColor = v_color.rgb * (0.7 + 0.3 * v_glow);
  coreColor = mix(coreColor, vec3(1.0), centre * 0.6 * v_glow);

  // Halo: fades out smoothly to nothing at the edge of the triangle, tinted cyan while the node is active.
  float isAggregate = step(0.5, v_aggregate);
  float haloReach = mix(reach, ${AGGREGATE_HALO_REACH.toFixed(2)}, isAggregate);
  float falloff = 1.0 - clamp((dist - v_radius) / (v_radius * (haloReach - 1.0)), 0.0, 1.0);
  float halo = pow(falloff, 2.4) * 0.55 * v_glow * u_glowLevel * (1.0 - core)
    * mix(1.0, ${AGGREGATE_HALO_STRENGTH.toFixed(2)}, isAggregate);
  vec3 haloColor = mix(v_color.rgb, u_accentColor, v_accent * 0.75);

  // Ring: selected node only, thin, a fixed gap outside the core, breathing slowly.
  float ringRadius = v_radius + border * 4.5;
  float ring = (1.0 - smoothstep(border * 0.6, border * 1.6, abs(dist - ringRadius)))
    * step(0.75, v_accent) * u_pulse;

  // Aggregate (a collapsed community): a translucent disc with a bright rim
  // and a solid centre, so it never reads as one very large node.
  float rim = smoothstep(v_radius - border * 3.5, v_radius - border * 2.0, dist) * core;
  float centreDot = 1.0 - smoothstep(v_radius * 0.16, v_radius * 0.16 + border, dist);
  float body = mix(1.0, clamp(0.26 + rim + centreDot, 0.0, 1.0), isAggregate);
  core *= body;

  float alpha = clamp(core + halo + ring, 0.0, 1.0);
  vec3 rgb = coreColor * core + haloColor * halo + u_accentColor * ring;
  // Premultiplied output, as Sigma's blending expects.
  gl_FragColor = vec4(min(rgb, vec3(alpha)), alpha) * v_color.a;
  #endif
}
`

const UNIFORMS = [
  'u_sizeRatio',
  'u_correctionRatio',
  'u_matrix',
  'u_time',
  'u_amplitude',
  'u_resolution',
  'u_glowLevel',
  'u_pulse',
  'u_accentColor',
] as const

type Uniform = (typeof UNIFORMS)[number]

const RING_PULSE_DEPTH = 0.22
const RING_PULSE_SPEED = 2.1

/**
 * Node = bright core + soft halo (+ cyan ring when selected), in one WebGL
 * program and one triangle per node. The position drifts around its base in
 * the vertex shader, so animating costs no CPU work per node.
 */
export function createGlowNodeProgram(motion: MotionUniforms, accentColor: readonly [number, number, number]) {
  return class GlowNodeProgram extends NodeProgram<Uniform, NodeAttributes, EdgeAttributes> {
    static readonly ANGLE_1 = 0
    static readonly ANGLE_2 = (2 * Math.PI) / 3
    static readonly ANGLE_3 = (4 * Math.PI) / 3

    getDefinition() {
      const { FLOAT, UNSIGNED_BYTE, TRIANGLES } = WebGLRenderingContext
      return {
        VERTICES: 3,
        VERTEX_SHADER_SOURCE: VERTEX_SHADER,
        FRAGMENT_SHADER_SOURCE: FRAGMENT_SHADER,
        METHOD: TRIANGLES,
        UNIFORMS,
        ATTRIBUTES: [
          { name: 'a_position', size: 2, type: FLOAT },
          { name: 'a_size', size: 1, type: FLOAT },
          { name: 'a_color', size: 4, type: UNSIGNED_BYTE, normalized: true },
          { name: 'a_id', size: 4, type: UNSIGNED_BYTE, normalized: true },
          { name: 'a_fx', size: 4, type: FLOAT },
        ],
        CONSTANT_ATTRIBUTES: [{ name: 'a_angle', size: 1, type: FLOAT }],
        CONSTANT_DATA: [
          [GlowNodeProgram.ANGLE_1],
          [GlowNodeProgram.ANGLE_2],
          [GlowNodeProgram.ANGLE_3],
        ],
      }
    }

    processVisibleItem(nodeIndex: number, startIndex: number, data: NodeDisplayData & NodeFx) {
      const { array } = this
      let at = startIndex
      array[at++] = data.x
      array[at++] = data.y
      array[at++] = data.size
      array[at++] = floatColor(data.color)
      array[at++] = nodeIndex
      array[at++] = data.glow ?? 0
      array[at++] = data.accent ?? 0
      array[at++] = data.community ?? NO_COMMUNITY
      array[at++] = data.aggregate ?? 0
    }

    setUniforms(params: RenderParams, { gl, uniformLocations }: ProgramInfo<Uniform>) {
      gl.uniform1f(uniformLocations.u_correctionRatio, params.correctionRatio)
      gl.uniform1f(uniformLocations.u_sizeRatio, params.sizeRatio)
      gl.uniformMatrix3fv(uniformLocations.u_matrix, false, params.matrix)
      gl.uniform1f(uniformLocations.u_time, motion.time)
      gl.uniform1f(uniformLocations.u_amplitude, motion.amplitude)
      gl.uniform2f(uniformLocations.u_resolution, params.width, params.height)
      gl.uniform1f(uniformLocations.u_glowLevel, motion.glow)
      gl.uniform1f(
        uniformLocations.u_pulse,
        1 - RING_PULSE_DEPTH * (0.5 + 0.5 * Math.sin(motion.time * RING_PULSE_SPEED)),
      )
      gl.uniform3f(uniformLocations.u_accentColor, ...accentColor)
    }
  }
}
