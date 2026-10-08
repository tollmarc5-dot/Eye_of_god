import { memo, type RefObject, useCallback, useEffect, useMemo, useRef } from 'react';

import { ZOOM_MAX, ZOOM_MIN } from '../constants.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { TILE_SIZE } from '../office/types.js';

interface StageNavProps {
  officeState: OfficeState;
  stageRef: RefObject<HTMLDivElement | null>;
  onZoomChange: (zoom: number) => void;
  /** Bumped when the layout changes, so zones are recomputed. */
  layoutKey: unknown;
}

interface Zone {
  label: string;
  color: string;
  x: number;
  y: number;
}

/**
 * Fraction of the next whole zoom step at which VISTA GENERAL rounds up: the
 * station then fills the view and only its outer hull slips under the panels.
 */
const FIT_ROUND_UP = 0.6;

/** CSS pixels of the stage hidden under the floating panels on each side. */
function panelInsets(stage: HTMLElement): { left: number; right: number } {
  const body = stage.parentElement;
  const box = stage.getBoundingClientRect();
  const left = body?.querySelector('.cc-directory')?.getBoundingClientRect();
  const right = body?.querySelector('.cc-rightcol')?.getBoundingClientRect();
  // Stacked (narrow) layouts put the panels below the stage: no side insets.
  const overlaps = (r: DOMRect | undefined) => !!r && r.top < box.bottom && r.bottom > box.top;
  return {
    left: overlaps(left) && left ? Math.max(0, left.right - box.left) : 0,
    right: overlaps(right) && right ? Math.max(0, box.right - right.left) : 0,
  };
}

/** Whole zoom (crisp pixels) that frames the entire station in the visible gap. */
function fitZoom(officeState: OfficeState, stage: HTMLElement): number {
  const layout = officeState.getLayout();
  const dpr = window.devicePixelRatio || 1;
  const { left, right } = panelInsets(stage);
  const fit = Math.min(
    ((stage.clientWidth - left - right) * dpr) / (layout.cols * TILE_SIZE),
    (stage.clientHeight * dpr) / (layout.rows * TILE_SIZE),
  );
  const whole = fit - Math.floor(fit) >= FIT_ROUND_UP ? Math.ceil(fit) : Math.floor(fit);
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, whole));
}

/**
 * Camera navigation over the office: OVERVIEW frames the whole headquarters,
 * zone buttons glide the camera to a department. Both use the office's own
 * eased camera (cameraPointTarget), so nothing teleports.
 */
export const StageNav = memo(function StageNav({
  officeState,
  stageRef,
  onZoomChange,
  layoutKey,
}: StageNavProps) {
  const zones = useMemo<Zone[]>(() => {
    void layoutKey;
    const layout = officeState.getLayout();
    const areaTiles = layout.areaTiles ?? [];
    const sums = new Map<string, { x: number; y: number; n: number }>();
    areaTiles.forEach((label, i) => {
      if (!label) return;
      const acc = sums.get(label) ?? { x: 0, y: 0, n: 0 };
      acc.x += i % layout.cols;
      acc.y += Math.floor(i / layout.cols);
      acc.n += 1;
      sums.set(label, acc);
    });
    return (layout.areas ?? []).flatMap((area) => {
      const acc = sums.get(area.label);
      if (!acc) return [];
      return [
        {
          label: area.label,
          color: area.color,
          x: (acc.x / acc.n + 0.5) * TILE_SIZE,
          y: (acc.y / acc.n + 0.5) * TILE_SIZE,
        },
      ];
    });
  }, [officeState, layoutKey]);

  const overview = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const layout = officeState.getLayout();
    const zoom = fitZoom(officeState, stage);
    onZoomChange(zoom);
    // Centre the station in the gap between the panels, not under them.
    const { left, right } = panelInsets(stage);
    const cssPerWorldPx = zoom / (window.devicePixelRatio || 1);
    officeState.cameraFollowId = null;
    officeState.cameraPointTarget = {
      x: (layout.cols * TILE_SIZE) / 2 + (right - left) / 2 / cssPerWorldPx,
      y: (layout.rows * TILE_SIZE) / 2,
    };
  }, [officeState, onZoomChange, stageRef]);

  // Open on the whole headquarters, once.
  const framed = useRef(false);
  useEffect(() => {
    if (framed.current) return;
    framed.current = true;
    overview();
  }, [overview]);

  const focusZone = useCallback(
    (zone: Zone) => {
      officeState.cameraFollowId = null;
      officeState.cameraPointTarget = { x: zone.x, y: zone.y };
    },
    [officeState],
  );

  return (
    <div className="cc-stagenav" role="toolbar" aria-label="Cámara">
      <button
        type="button"
        className="cc-stagenav__btn cc-stagenav__btn--primary"
        onClick={overview}
      >
        VISTA GENERAL
      </button>
      {zones.map((zone) => (
        <button
          key={zone.label}
          type="button"
          className="cc-stagenav__btn"
          style={{ borderColor: zone.color, color: zone.color }}
          onClick={() => focusZone(zone)}
        >
          {zone.label}
        </button>
      ))}
    </div>
  );
});
