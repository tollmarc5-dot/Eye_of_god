/**
 * GLSL shared by the node and the edge programs, so an edge end lands exactly
 * on its node: both compute the same offset from the same base position.
 *
 * A node never leaves its base position by more than `u_amplitude` pixels.
 * 60 % of the drift is shared by its community (one slow orbit per community),
 * 40 % is its own, phased by a hash of the base position.
 */
export const DRIFT_GLSL = /* glsl */ `
uniform float u_time;
uniform float u_amplitude;
uniform vec2 u_resolution;

float eogHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// Offset in clip space for a node at base position p.
vec2 eogDrift(vec2 p, float community) {
  float own = eogHash(p) * 6.2831853;
  float group = community * 2.3999632;
  vec2 shared = vec2(sin(u_time * 0.23 + group), cos(u_time * 0.19 + group * 1.7));
  vec2 self = vec2(sin(u_time * 0.47 + own), cos(u_time * 0.41 + own * 2.0));
  vec2 pixels = (shared * 0.6 + self * 0.4) * u_amplitude;
  return pixels * 2.0 / u_resolution;
}
`
