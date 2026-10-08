import { FX_COLORS as FX, ZONE_SUBTITLES } from '../../../constants.js';
import type { AreaDefinition } from '../../types.js';
import { TILE_SIZE } from '../../types.js';
import { createRng } from './rng.js';
import { zoneActivityLevel, zoneWorkingCount } from './station.js';

/**
 * In-world holographic signage: every zone carries a neon sign on its wall,
 * and the command deck's holo table projects a rotating galaxy. Both are
 * ambient art; the only thing that moves their intensity — and the "N ACTIVE"
 * line on a sign — is the real work counted by renderZoneActivity.
 */

const SIGN_H = 24;
const SIGN_PAD_X = 7;
const TITLE_PX = 10;
const SUB_PX = 6;
const GLOW_STEPS = 3;
const SCAN_PERIOD_MS = 3200;
const HOLO_RADIUS = 44;
const HOLO_LIFT = 14;
const HOLO_TILT = 0.4;
const HOLO_STARS = 340;
const HOLO_ARMS = 3;

interface ZoneBox {
  label: string;
  color: string;
  centerCol: number;
  topRow: number;
}

let boxesKey: unknown = null;
let boxes: ZoneBox[] = [];
const signCache = new Map<string, HTMLCanvasElement>();

function zoneBoxes(
  areaTiles: Array<string | null>,
  areas: AreaDefinition[],
  cols: number,
): ZoneBox[] {
  if (boxesKey === areaTiles) return boxes;
  const bounds = new Map<string, { minC: number; maxC: number; minR: number }>();
  areaTiles.forEach((label, i) => {
    if (!label) return;
    const c = i % cols;
    const r = Math.floor(i / cols);
    const b = bounds.get(label);
    if (!b) bounds.set(label, { minC: c, maxC: c, minR: r });
    else {
      b.minC = Math.min(b.minC, c);
      b.maxC = Math.max(b.maxC, c);
      b.minR = Math.min(b.minR, r);
    }
  });
  boxes = areas.flatMap((a) => {
    const b = bounds.get(a.label);
    return b
      ? [{ label: a.label, color: a.color, centerCol: (b.minC + b.maxC + 1) / 2, topRow: b.minR }]
      : [];
  });
  boxesKey = areaTiles;
  signCache.clear();
  return boxes;
}

function activeLine(count: number): string {
  return count === 1 ? '1 AGENTE ACTIVO' : `${count} AGENTES ACTIVOS`;
}

/** The sign art at one zoom; rebuilt only when the zoom or the real count changes. */
function signSprite(box: ZoneBox, zoom: number, count: number): HTMLCanvasElement {
  const key = `${box.label}|${zoom}|${count}`;
  const cached = signCache.get(key);
  if (cached) return cached;

  const title = box.label;
  const subtitle = ZONE_SUBTITLES[box.label] ?? '';
  const second = count > 0 ? `${subtitle} · ${activeLine(count)}` : subtitle;
  const measure = document.createElement('canvas').getContext('2d');
  if (!measure) return document.createElement('canvas');
  measure.font = `bold ${TITLE_PX * zoom}px 'FS Pixel Sans'`;
  const titleW = measure.measureText(title).width;
  measure.font = `${SUB_PX * zoom}px 'FS Pixel Sans'`;
  const subW = measure.measureText(second).width;

  const glow = GLOW_STEPS * 2 * zoom;
  const w = Math.ceil(Math.max(titleW, subW) + SIGN_PAD_X * 2 * zoom);
  const h = SIGN_H * zoom;
  const canvas = document.createElement('canvas');
  canvas.width = w + glow * 2;
  canvas.height = h + glow * 2;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  // Neon spill around the panel (stepped, no blur).
  ctx.fillStyle = box.color;
  for (let i = GLOW_STEPS; i >= 1; i--) {
    const g = i * 2 * zoom;
    ctx.globalAlpha = 0.1 * (GLOW_STEPS + 1 - i);
    ctx.fillRect(glow - g, glow - g, w + g * 2, h + g * 2);
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = FX.signPanel;
  ctx.fillRect(glow, glow, w, h);

  // Double neon frame + brighter corner brackets.
  const p = Math.max(1, zoom);
  ctx.strokeStyle = box.color;
  ctx.lineWidth = p;
  ctx.strokeRect(glow + p / 2, glow + p / 2, w - p, h - p);
  ctx.globalAlpha = 0.35;
  ctx.strokeRect(glow + p * 2.5, glow + p * 2.5, w - p * 5, h - p * 5);
  ctx.globalAlpha = 1;
  ctx.fillStyle = FX.signText;
  const arm = 4 * zoom;
  for (const [x, y, dx, dy] of [
    [glow, glow, 1, 1],
    [glow + w, glow, -1, 1],
    [glow, glow + h, 1, -1],
    [glow + w, glow + h, -1, -1],
  ]) {
    ctx.fillRect(dx > 0 ? x : x - arm, dy > 0 ? y : y - p, arm, p);
    ctx.fillRect(dx > 0 ? x : x - p, dy > 0 ? y : y - arm, p, arm);
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${TITLE_PX * zoom}px 'FS Pixel Sans'`;
  ctx.fillStyle = box.color;
  ctx.globalAlpha = 0.6;
  ctx.fillText(title, glow + w / 2 + p, glow + 9 * zoom + p);
  ctx.globalAlpha = 1;
  ctx.fillStyle = FX.signText;
  ctx.fillText(title, glow + w / 2, glow + 9 * zoom);
  ctx.font = `${SUB_PX * zoom}px 'FS Pixel Sans'`;
  ctx.fillStyle = box.color;
  ctx.fillText(second, glow + w / 2, glow + 18 * zoom);

  signCache.set(key, canvas);
  return canvas;
}

/** Neon signs on every zone wall, brighter while real work happens in the zone. */
export function renderZoneSigns(
  ctx: CanvasRenderingContext2D,
  areaTiles: Array<string | null> | undefined,
  areas: AreaDefinition[] | undefined,
  cols: number,
  offsetX: number,
  offsetY: number,
  zoom: number,
  now: number,
): void {
  if (!areaTiles || !areas || areas.length === 0) return;
  const s = TILE_SIZE * zoom;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  for (const box of zoneBoxes(areaTiles, areas, cols)) {
    const level = zoneActivityLevel(box.label);
    const sprite = signSprite(box, zoom, zoneWorkingCount(box.label));
    const x = Math.round(offsetX + box.centerCol * s - sprite.width / 2);
    const y = Math.round(offsetY + box.topRow * s - sprite.height + 2 * zoom);
    ctx.globalAlpha = 0.78 + 0.22 * level;
    ctx.drawImage(sprite, x, y);
    // Active zones: a second additive pass makes the sign burn brighter.
    if (level > 0.02) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = level * (0.35 + 0.15 * Math.sin(now / 500));
      ctx.drawImage(sprite, x, y);
      ctx.globalCompositeOperation = 'source-over';
    }
    // A scanline sweeps every panel now and then (ambient).
    const phase = ((now + box.centerCol * 397) % SCAN_PERIOD_MS) / SCAN_PERIOD_MS;
    if (phase < 0.35) {
      const glow = GLOW_STEPS * 2 * zoom;
      const inner = sprite.height - glow * 2;
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = FX.signScan;
      ctx.fillRect(
        x + glow + zoom,
        Math.round(y + glow + (phase / 0.35) * (inner - zoom)),
        sprite.width - glow * 2 - zoom * 2,
        Math.max(1, zoom),
      );
    }
  }
  ctx.restore();
}

// ── Galaxy hologram over the command deck's holo tables ─────────────

interface HoloStar {
  arm: number;
  f: number;
  jitter: number;
  size: number;
}

let holoAnchors: { x: number; y: number }[] = [];
let holoZone: string | null = null;
const holoStars: HoloStar[] = (() => {
  const rng = createRng(0x9a1a);
  return Array.from({ length: HOLO_STARS }, () => ({
    arm: Math.floor(rng() * HOLO_ARMS),
    f: Math.pow(rng(), 0.7),
    jitter: (rng() - 0.5) * 0.5,
    size: rng() < 0.12 ? 2 : 1,
  }));
})();

/** World-pixel anchors (centre top of each holo table) and the zone that powers them. */
export function setHoloAnchors(anchors: { x: number; y: number }[], zone: string | null): void {
  holoAnchors = anchors;
  holoZone = zone;
}

export function renderHoloGalaxy(
  ctx: CanvasRenderingContext2D,
  offsetX: number,
  offsetY: number,
  zoom: number,
  now: number,
): void {
  if (holoAnchors.length === 0) return;
  const level = holoZone ? zoneActivityLevel(holoZone) : 0;
  const t = now / 1000;
  const spin = t * (0.12 + 0.18 * level);
  const r = HOLO_RADIUS * zoom;
  const armColors = [FX.holoArmA, FX.holoArmB, FX.holoArmC];
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const a of holoAnchors) {
    const cx = offsetX + a.x * zoom;
    const baseY = offsetY + a.y * zoom;
    const cy = baseY - HOLO_LIFT * zoom;
    // Projection beam: stacked translucent trapezoid steps from table to disk.
    ctx.fillStyle = FX.holoBeam;
    for (let i = 0; i < 3; i++) {
      const spread = (0.35 + i * 0.22) * r;
      ctx.globalAlpha = 0.7 + 0.3 * level;
      ctx.beginPath();
      ctx.moveTo(cx - 3 * zoom, baseY);
      ctx.lineTo(cx + 3 * zoom, baseY);
      ctx.lineTo(cx + spread, cy);
      ctx.lineTo(cx - spread, cy);
      ctx.closePath();
      ctx.fill();
    }
    // Spiral disk, seen tilted.
    const intensity = 0.45 + 0.55 * level;
    for (const star of holoStars) {
      const theta = (star.arm / HOLO_ARMS) * Math.PI * 2 + star.f * 3.4 + star.jitter + spin;
      const rr = star.f * r;
      const x = cx + Math.cos(theta) * rr;
      const y = cy + Math.sin(theta) * rr * HOLO_TILT;
      ctx.globalAlpha = intensity * (1 - star.f * 0.7);
      ctx.fillStyle = star.f < 0.18 ? FX.holoCore : armColors[star.arm];
      const sz = star.size * zoom;
      ctx.fillRect(Math.round(x), Math.round(y), sz, sz);
    }
    // Rim ring, rotating dashes.
    ctx.strokeStyle = FX.holoArmA;
    ctx.lineWidth = Math.max(1, zoom);
    ctx.globalAlpha = 0.35 * intensity + 0.1 * Math.sin(t * 2);
    ctx.setLineDash([6 * zoom, 5 * zoom]);
    ctx.lineDashOffset = -t * 12 * zoom;
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * 1.08, r * 1.08 * HOLO_TILT, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}
