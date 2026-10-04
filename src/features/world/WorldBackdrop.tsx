/**
 * Deep space behind the graph: a dark radial field and a vignette, in CSS.
 * Static on purpose. Stars and nebulae move with the camera and belong to
 * the renderer's universe layer; nothing here is drawn in screen space.
 */
export function WorldBackdrop() {
  return <div className="eog-backdrop" aria-hidden="true" />
}
