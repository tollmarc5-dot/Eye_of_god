import { SPACE_COLORS as C } from '../../../constants.js';
import type { AreaDefinition, Character } from '../../types.js';
import { TILE_SIZE } from '../../types.js';
import { characterStatus } from '../commandCenterFx.js';

/**
 * The station itself: a hull framing the office in space, and zones that
 * light up in proportion to the agents really working inside them.
 */

const HULL_MARGIN_TILES = 0.75;
/** Seconds for a zone to reach a new brightness (rise and fall). */
const ZONE_EASE_SEC = 1.4;
const ZONE_MAX_ALPHA = 0.2;
const HALO_STEPS = 4;

const WORKING: ReadonlySet<string> = new Set(['active', 'thinking', 'tool']);

interface ZoneMasks {
  key: unknown;
  masks: Map<string, HTMLCanvasElement>;
  colors: Map<string, string>;
}

let zoneMasks: ZoneMasks | null = null;
const zoneLevel = new Map<string, number>();
/** Agents really working (active / thinking / tool) per zone, as of the last frame. */
let zoneWorking = new Map<string, number>();
let lastZoneUpdate = 0;

/** One pixel per tile, coloured where the tile belongs to the zone. Rebuilt only when the layout changes. */
function masksFor(
  areaTiles: Array<string | null>,
  areas: AreaDefinition[],
  cols: number,
  rows: number,
): ZoneMasks {
  if (zoneMasks && zoneMasks.key === areaTiles) return zoneMasks;
  const masks = new Map<string, HTMLCanvasElement>();
  const colors = new Map(areas.map((a) => [a.label, a.color]));
  for (const area of areas) {
    const canvas = document.createElement('canvas');
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    ctx.fillStyle = area.color;
    areaTiles.forEach((label, i) => {
      if (label === area.label) ctx.fillRect(i % cols, Math.floor(i / cols), 1, 1);
    });
    masks.set(area.label, canvas);
  }
  zoneMasks = { key: areaTiles, masks, colors };
  return zoneMasks;
}

/** The hull around the map: dark plating, neon edge, blinking beacons. */
export function renderStationHull(
  ctx: CanvasRenderingContext2D,
  offsetX: number,
  offsetY: number,
  mapW: number,
  mapH: number,
  zoom: number,
  now: number,
): void {
  const m = HULL_MARGIN_TILES * TILE_SIZE * zoom;
  const x = offsetX - m;
  const y = offsetY - m;
  const w = mapW + m * 2;
  const h = mapH + m * 2;
  ctx.save();
  // Soft blue halo where the station lights spill into space: stepped strokes
  // instead of shadowBlur, which costs a full-canvas blur every frame.
  ctx.strokeStyle = C.hullGlow;
  for (let i = 1; i <= HALO_STEPS; i++) {
    const g = i * 4 * zoom;
    ctx.globalAlpha = 0.55 * (1 - i / (HALO_STEPS + 1));
    ctx.lineWidth = 4 * zoom;
    ctx.strokeRect(x - g, y - g, w + g * 2, h + g * 2);
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = C.hull;
  ctx.fillRect(x, y, w, h);
  // Plating seams.
  ctx.fillStyle = C.hullPanel;
  const step = TILE_SIZE * zoom * 4;
  for (let px = x + step; px < x + w; px += step)
    ctx.fillRect(Math.round(px), y, Math.max(1, zoom), m);
  for (let px = x + step; px < x + w; px += step)
    ctx.fillRect(Math.round(px), y + h - m, Math.max(1, zoom), m);
  // Neon edge.
  ctx.strokeStyle = C.hullEdge;
  ctx.lineWidth = Math.max(1, zoom);
  ctx.globalAlpha = 0.65 + 0.2 * Math.sin(now / 1400);
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  // Beacons at the corners, alternating, each with a small gradient glow.
  const blink = Math.floor(now / 900) % 2;
  const b = Math.max(2, zoom * 2);
  ctx.globalAlpha = 1;
  const corners: [number, number, string][] = [
    [x, y, blink ? C.beaconRed : C.beaconCyan],
    [x + w - b, y, blink ? C.beaconCyan : C.beaconRed],
    [x, y + h - b, blink ? C.beaconCyan : C.beaconRed],
    [x + w - b, y + h - b, blink ? C.beaconRed : C.beaconCyan],
  ];
  for (const [cx, cy, color] of corners) {
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(cx - b), Math.round(cy - b), b * 3, b * 3);
    ctx.globalAlpha = 1;
    ctx.fillRect(Math.round(cx), Math.round(cy), b, b);
  }
  ctx.restore();
}

/**
 * Zones react to real work: each zone's floor brightens with the number of
 * agents working inside it (active / thinking / tool) and fades back when
 * they stop. Zones with nobody working stay dark.
 */
export function renderZoneActivity(
  ctx: CanvasRenderingContext2D,
  characters: readonly Character[],
  areaTiles: Array<string | null> | undefined,
  areas: AreaDefinition[] | undefined,
  cols: number,
  rows: number,
  offsetX: number,
  offsetY: number,
  zoom: number,
  now: number,
): void {
  if (!areaTiles || !areas || areas.length === 0) return;
  const { masks } = masksFor(areaTiles, areas, cols, rows);

  const working = new Map<string, number>();
  for (const ch of characters) {
    const status = characterStatus(ch);
    if (!status || !WORKING.has(status)) continue;
    const label = areaTiles[ch.tileRow * cols + ch.tileCol];
    if (label) working.set(label, (working.get(label) ?? 0) + 1);
  }
  zoneWorking = working;

  const dt = lastZoneUpdate === 0 ? 0 : Math.min(0.1, (now - lastZoneUpdate) / 1000);
  lastZoneUpdate = now;
  const ease = Math.min(1, dt / ZONE_EASE_SEC);

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.globalCompositeOperation = 'lighter';
  for (const [label, mask] of masks) {
    // One agent lights a zone; more agents push it brighter, with diminishing returns.
    const count = working.get(label) ?? 0;
    const target = count === 0 ? 0 : Math.min(1, 0.55 + 0.15 * count);
    const level = (zoneLevel.get(label) ?? 0) + (target - (zoneLevel.get(label) ?? 0)) * ease;
    zoneLevel.set(label, level);
    if (level < 0.01) continue;
    ctx.globalAlpha = level * ZONE_MAX_ALPHA * (0.85 + 0.15 * Math.sin(now / 700));
    ctx.drawImage(mask, offsetX, offsetY, cols * TILE_SIZE * zoom, rows * TILE_SIZE * zoom);
  }
  ctx.restore();
}

/** Current brightness (0–1) of a zone — exported for tests and the zone UI. */
export function zoneActivityLevel(label: string): number {
  return zoneLevel.get(label) ?? 0;
}

/** Agents really working in a zone right now (0 when nobody is). */
export function zoneWorkingCount(label: string): number {
  return zoneWorking.get(label) ?? 0;
}

// ── Zone trim: floor plating + a neon edge where each zone meets another ──

let trim: { key: unknown; canvas: HTMLCanvasElement } | null = null;

/** Art-resolution (1 px = 1 sprite px) trim layer, rebuilt only when the layout changes. */
function trimLayer(
  areaTiles: Array<string | null>,
  areas: AreaDefinition[],
  cols: number,
  rows: number,
): HTMLCanvasElement {
  if (trim && trim.key === areaTiles) return trim.canvas;
  const T = TILE_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = cols * T;
  canvas.height = rows * T;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const colors = new Map(areas.map((a) => [a.label, a.color]));
    const at = (c: number, r: number) =>
      c < 0 || r < 0 || c >= cols || r >= rows ? null : areaTiles[r * cols + c];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const label = at(c, r);
        if (!label) continue;
        const x = c * T;
        const y = r * T;
        // Floor plates: a faint seam on two edges and a shaded corner.
        ctx.globalAlpha = 1;
        ctx.fillStyle = C.floorSeam;
        ctx.fillRect(x, y, T, 1);
        ctx.fillRect(x, y, 1, T);
        ctx.fillStyle = C.floorShade;
        ctx.fillRect(x + T - 1, y + 1, 1, T - 1);
        // Neon trim on every edge that borders another zone (or the hull).
        const color = colors.get(label);
        if (!color) continue;
        ctx.fillStyle = color;
        const edges: [boolean, number, number, number, number][] = [
          [at(c, r - 1) !== label, x, y, T, 1],
          [at(c, r + 1) !== label, x, y + T - 1, T, 1],
          [at(c - 1, r) !== label, x, y, 1, T],
          [at(c + 1, r) !== label, x + T - 1, y, 1, T],
        ];
        for (const [isEdge, ex, ey, ew, eh] of edges) {
          if (!isEdge) continue;
          ctx.globalAlpha = 0.55;
          ctx.fillRect(ex, ey, ew, eh);
          // Soft inner spill, one pixel further in.
          ctx.globalAlpha = 0.16;
          ctx.fillRect(
            ex + (ew === 1 ? (ex === x ? 1 : -1) : 0),
            ey + (eh === 1 ? (ey === y ? 1 : -1) : 0),
            ew,
            eh,
          );
        }
      }
    }
  }
  trim = { key: areaTiles, canvas };
  return canvas;
}

export function renderZoneTrim(
  ctx: CanvasRenderingContext2D,
  areaTiles: Array<string | null> | undefined,
  areas: AreaDefinition[] | undefined,
  cols: number,
  rows: number,
  offsetX: number,
  offsetY: number,
  zoom: number,
): void {
  if (!areaTiles || !areas || areas.length === 0) return;
  const layer = trimLayer(areaTiles, areas, cols, rows);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(layer, offsetX, offsetY, cols * TILE_SIZE * zoom, rows * TILE_SIZE * zoom);
  ctx.restore();
}
