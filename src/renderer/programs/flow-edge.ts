import { EdgeProgram } from 'sigma/rendering'
import type { ProgramInfo } from 'sigma/rendering'
import type { EdgeDisplayData, NodeDisplayData, RenderParams } from 'sigma/types'
import { floatColor } from 'sigma/utils'
import type { EdgeAttributes, NodeAttributes } from '@/graph'
import { anchoredDisplay } from '../anchoring'
import type { MotionUniforms } from '../motion'
import { DRIFT_GLSL } from './drift.glsl'
import type { NodeFx } from './glow-node'

/** Extra per-edge value the reducers add for this program. */
export interface EdgeFx {
  /** 1 = edge of the hovered / selected node: clear pulses and a direction fade. */
  flow?: number
}

const NO_COMMUNITY = -1
/** Distance between two pulses on the same edge, and their length, in CSS pixels. */
const PULSE_SPACING = 120
const PULSE_LENGTH = 9
const PULSE_SPEED = 26
/** Share of resting edges that carry ambient pulses when the zoom level allows them. */
const AMBIENT_SHARE = 0.3

const VERTEX_SHADER = /* glsl */ `
attribute vec4 a_id;
attribute vec4 a_color;
attribute vec2 a_normal;
attribute float a_normalCoef;
attribute vec2 a_positionStart;
attribute vec2 a_positionEnd;
attribute float a_positionCoef;
attribute vec3 a_fx;

uniform mat3 u_matrix;
uniform float u_sizeRatio;
uniform float u_zoomRatio;
uniform float u_pixelRatio;
uniform float u_correctionRatio;
uniform float u_minEdgeThickness;
uniform float u_feather;
${DRIFT_GLSL}

varying vec4 v_color;
varying vec2 v_normal;
varying float v_thickness;
varying float v_feather;
varying float v_along;
varying float v_pixels;
varying float v_flow;
varying float v_seed;

const float bias = 255.0 / 254.0;

void main() {
  vec2 normal = a_normal * a_normalCoef;
  vec2 position = mix(a_positionStart, a_positionEnd, a_positionCoef);

  float normalLength = length(normal);
  vec2 unitNormal = normal / normalLength;
  float pixelsThickness = max(normalLength, u_minEdgeThickness * u_sizeRatio);
  float webGLThickness = pixelsThickness * u_correctionRatio / u_sizeRatio;

  // Each end follows its own node: same drift function, same base position.
  vec2 driftStart = eogDrift(a_positionStart, a_fx.x);
  vec2 driftEnd = eogDrift(a_positionEnd, a_fx.y);
  vec2 clip = (u_matrix * vec3(position + unitNormal * webGLThickness, 1)).xy;
  gl_Position = vec4(clip + mix(driftStart, driftEnd, a_positionCoef), 0, 1);

  vec2 startClip = (u_matrix * vec3(a_positionStart, 1)).xy;
  vec2 endClip = (u_matrix * vec3(a_positionEnd, 1)).xy;
  v_pixels = length((endClip - startClip) * u_resolution * 0.5);
  v_along = a_positionCoef;
  v_flow = a_fx.z;
  v_seed = eogHash(a_positionStart + a_positionEnd);

  v_thickness = webGLThickness / u_zoomRatio;
  v_normal = unitNormal;
  v_feather = u_feather * u_correctionRatio / u_zoomRatio / u_pixelRatio * 2.0;

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
varying vec2 v_normal;
varying float v_thickness;
varying float v_feather;
varying float v_along;
varying float v_pixels;
varying float v_flow;
varying float v_seed;

uniform float u_flowTime;
uniform float u_ambientFlow;
uniform float u_focusFlow;
uniform vec3 u_accentColor;

void main(void) {
  #ifdef PICKING_MODE
  gl_FragColor = v_color;
  #else
  float dist = length(v_normal) * v_thickness;
  float line = 1.0 - smoothstep(v_thickness - v_feather, v_thickness, dist);

  float isFocus = step(0.5, v_flow);
  // Only some resting edges carry data, so the graph never looks wired with light.
  float isCarrier = step(${(1 - AMBIENT_SHARE).toFixed(2)}, v_seed);
  float strength = mix(u_ambientFlow * isCarrier * 0.55, u_focusFlow, isFocus);

  // Pulses travel from source to target, a fixed number of pixels apart.
  float travelled = v_along * v_pixels - u_flowTime * ${PULSE_SPEED.toFixed(1)};
  float phase = fract(travelled / ${PULSE_SPACING.toFixed(1)} + v_seed);
  float head = 1.0 - smoothstep(0.0, ${(PULSE_LENGTH / PULSE_SPACING).toFixed(4)}, 1.0 - phase);
  float pulse = head * strength * smoothstep(0.0, 24.0, v_pixels);

  // Static direction cue on focused edges: they brighten towards the target.
  float fade = mix(1.0, 0.45 + 0.55 * v_along, isFocus);

  vec3 rgb = mix(v_color.rgb * fade, u_accentColor, pulse);
  gl_FragColor = vec4(rgb, 1.0) * line * v_color.a;
  #endif
}
`

const UNIFORMS = [
  'u_matrix',
  'u_zoomRatio',
  'u_sizeRatio',
  'u_correctionRatio',
  'u_pixelRatio',
  'u_feather',
  'u_minEdgeThickness',
  'u_time',
  'u_amplitude',
  'u_resolution',
  'u_flowTime',
  'u_ambientFlow',
  'u_focusFlow',
  'u_accentColor',
] as const

type Uniform = (typeof UNIFORMS)[number]

/**
 * Edge = thin line whose ends follow the drifting nodes, with optional data
 * pulses computed in the fragment shader: no particle objects, no CPU work
 * per edge and per frame.
 */
export function createFlowEdgeProgram(motion: MotionUniforms, accentColor: readonly [number, number, number]) {
  return class FlowEdgeProgram extends EdgeProgram<Uniform, NodeAttributes, EdgeAttributes> {
    getDefinition() {
      const { FLOAT, UNSIGNED_BYTE, TRIANGLES } = WebGLRenderingContext
      return {
        VERTICES: 6,
        VERTEX_SHADER_SOURCE: VERTEX_SHADER,
        FRAGMENT_SHADER_SOURCE: FRAGMENT_SHADER,
        METHOD: TRIANGLES,
        UNIFORMS,
        ATTRIBUTES: [
          { name: 'a_positionStart', size: 2, type: FLOAT },
          { name: 'a_positionEnd', size: 2, type: FLOAT },
          { name: 'a_normal', size: 2, type: FLOAT },
          { name: 'a_color', size: 4, type: UNSIGNED_BYTE, normalized: true },
          { name: 'a_id', size: 4, type: UNSIGNED_BYTE, normalized: true },
          { name: 'a_fx', size: 3, type: FLOAT },
        ],
        CONSTANT_ATTRIBUTES: [
          { name: 'a_positionCoef', size: 1, type: FLOAT },
          { name: 'a_normalCoef', size: 1, type: FLOAT },
        ],
        CONSTANT_DATA: [
          [0, 1],
          [0, -1],
          [1, 1],
          [1, 1],
          [0, -1],
          [1, -1],
        ],
      }
    }

    anchored(node: NodeDisplayData & NodeFx): NodeDisplayData {
      return anchoredDisplay<NodeDisplayData & NodeFx>(node, (nodeId) => this.renderer.getNodeDisplayData(nodeId))
    }

    processVisibleItem(
      edgeIndex: number,
      startIndex: number,
      source: NodeDisplayData & NodeFx,
      target: NodeDisplayData & NodeFx,
      data: EdgeDisplayData & EdgeFx,
    ) {
      const thickness = data.size || 1
      // An end inside a collapsed community is drawn on its aggregate.
      const from = this.anchored(source)
      const to = this.anchored(target)
      const dx = to.x - from.x
      const dy = to.y - from.y
      const squared = dx * dx + dy * dy
      const scale = squared ? thickness / Math.sqrt(squared) : 0

      const { array } = this
      let at = startIndex
      array[at++] = from.x
      array[at++] = from.y
      array[at++] = to.x
      array[at++] = to.y
      array[at++] = -dy * scale
      array[at++] = dx * scale
      array[at++] = floatColor(data.color)
      array[at++] = edgeIndex
      array[at++] = source.community ?? NO_COMMUNITY
      array[at++] = target.community ?? NO_COMMUNITY
      array[at++] = data.flow ?? 0
    }

    setUniforms(params: RenderParams, { gl, uniformLocations }: ProgramInfo<Uniform>) {
      gl.uniformMatrix3fv(uniformLocations.u_matrix, false, params.matrix)
      gl.uniform1f(uniformLocations.u_zoomRatio, params.zoomRatio)
      gl.uniform1f(uniformLocations.u_sizeRatio, params.sizeRatio)
      gl.uniform1f(uniformLocations.u_correctionRatio, params.correctionRatio)
      gl.uniform1f(uniformLocations.u_pixelRatio, params.pixelRatio)
      gl.uniform1f(uniformLocations.u_feather, params.antiAliasingFeather)
      gl.uniform1f(uniformLocations.u_minEdgeThickness, params.minEdgeThickness)
      gl.uniform1f(uniformLocations.u_time, motion.time)
      gl.uniform1f(uniformLocations.u_amplitude, motion.amplitude)
      gl.uniform2f(uniformLocations.u_resolution, params.width, params.height)
      gl.uniform1f(uniformLocations.u_flowTime, motion.time)
      gl.uniform1f(uniformLocations.u_ambientFlow, motion.ambientFlow)
      gl.uniform1f(uniformLocations.u_focusFlow, motion.focusFlow)
      gl.uniform3f(uniformLocations.u_accentColor, ...accentColor)
    }
  }
}
