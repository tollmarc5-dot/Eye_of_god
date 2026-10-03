/**
 * Colours and type used INSIDE the WebGL/canvas layers, where CSS variables
 * are not available. This is the only place that mirrors tokens.css: keep the
 * two in sync (see DESIGN_SYSTEM.md).
 */
export const CANVAS_THEME = {
  /** --eog-cyan: selection ring, focused edges. */
  accent: '#4fe3ff',
  /** --eog-text */
  label: '#e9f2ff',
  /** --eog-bg: halo behind labels so they stay readable over nodes and edges. */
  labelHalo: '#04070d',
  /** --eog-surface-solid */
  plate: '#0a1322',
  edge: '#20325a',
  edgeDimmed: '#0b1322',
  edgeFocus: '#6fe6ff',
  nodeDimmed: '#182448',
  labelFont: '"IBM Plex Sans", system-ui, sans-serif',
  labelSize: 12,
  labelWeight: '500',
} as const
