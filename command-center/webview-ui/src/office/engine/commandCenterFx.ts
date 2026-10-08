import type { TelemetryStatus } from '../../../../core/src/telemetry.js';
import { getLiveErrorCount, getLiveStatus } from '../../commandCenter/liveStatus.js';
import {
  CHARACTER_SITTING_OFFSET_PX,
  FX_COLORS as FX,
  SELECTION_GLOW_COLOR,
  SELECTION_GLOW_CORE_COLOR,
  STATUS_PULSE_PERIOD_MS,
  STATUS_RING_COLORS,
  TRANSPARENT_COLOR,
  WORKSTATION_LIGHT_COLOR,
  WORKSTATION_LIGHT_ERROR_COLOR,
  WORKSTATION_LIGHT_PERMISSION_COLOR,
  WORKSTATION_LIGHT_RADIUS_TILES,
} from '../../constants.js';
import type { Character } from '../types.js';
import { CharacterState, Direction, TILE_SIZE } from '../types.js';

/**
 * Command-center effects on the office canvas. Every effect that depicts work
 * is driven by what the server reported for that agent — its status and the
 * real tool it is running (`ch.currentTool`). A character with no reported
 * status gets nothing, so the office never looks busier than it is.
 */

const RING_RX = 6;
const RING_RY = 2.5;
const BEAM_WIDTH = 14;
const BEAM_HEIGHT = 44;
const LIGHT_AHEAD_PX = 10;
const RIPPLE_MS = 900;
const DONE_BURST_MS = 1400;
const ERROR_WAVE_MS = 1100;
const PARTICLE_POOL = 240;
const PARTICLE_LIFE_SEC = 1.6;
const PARTICLES_PER_SEC = 5;
/** Hologram placement relative to the workstation, in art pixels. */
const HOLO_SIDE_OFFSET = 17;
const HOLO_DROP = 10;
/** Thinking orbs circle this far below the top of the sprite (art pixels). */
const THINK_HEAD_DROP = 9;

let reducedMotion: boolean | null = null;
function prefersReducedMotion(): boolean {
  if (reducedMotion === null) {
    reducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  return reducedMotion;
}

/** 0..1 breathing value; constant when the user asked for reduced motion. */
function pulse(now: number, period = STATUS_PULSE_PERIOD_MS): number {
  if (prefersReducedMotion()) return 0.75;
  return 0.5 + 0.5 * Math.sin((now / period) * Math.PI * 2);
}

/** The real status behind a character. Sub-agents (negative ids) only know active vs idle. */
export function characterStatus(ch: Character): TelemetryStatus | null {
  if (ch.id < 0) return ch.isActive ? 'tool' : 'done';
  return getLiveStatus(ch.id);
}

const LIVE_STATUSES: ReadonlySet<TelemetryStatus> = new Set([
  'active',
  'thinking',
  'tool',
  'permission',
  'waiting_input',
  'error',
]);
const WORKING_STATUSES: ReadonlySet<TelemetryStatus> = new Set(['active', 'thinking', 'tool']);

const STATUS_TEXT: Partial<Record<TelemetryStatus, string>> = {
  thinking: 'Pensando…',
  permission: 'Necesita tu aprobación',
  waiting_input: 'Esperando tu respuesta',
  error: 'Error — requiere atención',
};

/**
 * Label text for a status that is not a running tool, or null when the
 * tool's own label (or upstream's) should stand. AskUserQuestion keeps its
 * real "Waiting for your answer".
 */
export function commandStatusText(ch: Character): string | null {
  if (ch.id < 0) return null;
  const status = getLiveStatus(ch.id);
  if (!status) return null;
  if (status === 'waiting_input' && ch.currentTool === 'AskUserQuestion') return null;
  return STATUS_TEXT[status] ?? null;
}

/** Whether the agent is doing (or blocked on) something right now, per its real status. */
export function hasLiveStatus(ch: Character): boolean {
  const status = characterStatus(ch);
  return status !== null && LIVE_STATUSES.has(status);
}

function feet(ch: Character, offsetX: number, offsetY: number, zoom: number): [number, number] {
  const sitting = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0;
  return [offsetX + ch.x * zoom, offsetY + (ch.y + sitting) * zoom - zoom];
}

/** World point just above the character's head. */
function head(ch: Character, offsetX: number, offsetY: number, zoom: number): [number, number] {
  const [x, y] = feet(ch, offsetX, offsetY, zoom);
  return [x, y - 30 * zoom];
}

/** The workstation in front of a seated character (where its monitor is). */
function station(ch: Character, offsetX: number, offsetY: number, zoom: number): [number, number] {
  const ahead = LIGHT_AHEAD_PX * zoom;
  const dx = ch.dir === Direction.LEFT ? -ahead : ch.dir === Direction.RIGHT ? ahead : 0;
  const dy = ch.dir === Direction.UP ? -ahead : ch.dir === Direction.DOWN ? ahead : 0;
  return [offsetX + ch.x * zoom + dx, offsetY + (ch.y - TILE_SIZE / 2) * zoom + dy];
}

// ── Status transitions (edge-triggered effects) ──────────────────

interface Transition {
  status: TelemetryStatus | null;
  /** When the agent last started working (ripple), finished (burst), or failed (wave). */
  rippleAt: number;
  doneAt: number;
  errorAt: number;
  errorCount: number;
}
const transitions = new Map<number, Transition>();

function trackTransition(ch: Character, status: TelemetryStatus | null, now: number): Transition {
  let t = transitions.get(ch.id);
  if (!t) {
    // First sight: no edge, so no effect — an agent adopted mid-turn did not just start.
    t = { status, rippleAt: 0, doneAt: 0, errorAt: 0, errorCount: getLiveErrorCount(ch.id) };
    transitions.set(ch.id, t);
    return t;
  }
  // A real failure was reported (a tool returned an error): flash a red wave.
  const errors = ch.id > 0 ? getLiveErrorCount(ch.id) : 0;
  if (errors > t.errorCount) t.errorAt = now;
  t.errorCount = errors;
  if (t.status !== status) {
    const wasWorking = t.status !== null && WORKING_STATUSES.has(t.status);
    const isWorking = status !== null && WORKING_STATUSES.has(status);
    if (isWorking && !wasWorking) t.rippleAt = now;
    if (status === 'done' && t.status !== null && t.status !== 'done') t.doneAt = now;
    if (status === 'error') t.errorAt = now;
    t.status = status;
  }
  return t;
}

/** Forget transitions for characters that left the office. */
function pruneTransitions(characters: readonly Character[]): void {
  if (transitions.size <= characters.length) return;
  const live = new Set(characters.map((c) => c.id));
  for (const id of transitions.keys()) if (!live.has(id)) transitions.delete(id);
}

// ── Energy particles (pooled) ────────────────────────────────────

interface Particle {
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  color: string;
}
const particles: Particle[] = Array.from({ length: PARTICLE_POOL }, () => ({
  alive: false,
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  age: 0,
  color: FX.energy,
}));
const emitDebt = new Map<number, number>();
let lastParticleTick = 0;

function emit(x: number, y: number, color: string): void {
  const p = particles.find((q) => !q.alive);
  if (!p) return; // pool exhausted: drop, never allocate per frame
  p.alive = true;
  p.x = x + (Math.random() - 0.5) * 10;
  p.y = y;
  p.vx = (Math.random() - 0.5) * 6;
  p.vy = -10 - Math.random() * 14;
  p.age = 0;
  p.color = color;
}

// ── Tool holograms ───────────────────────────────────────────────

type HoloKind = 'read' | 'code' | 'terminal' | 'web' | 'agent' | 'generic';

/** Category of the REAL tool the agent is running (from agentToolStart). */
export function holoKind(tool: string | null): HoloKind | null {
  if (!tool) return null;
  if (tool === 'Read' || tool === 'Grep' || tool === 'Glob' || tool === 'NotebookRead')
    return 'read';
  if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit' || tool === 'NotebookEdit')
    return 'code';
  if (tool === 'Bash' || tool === 'BashOutput' || tool === 'KillShell') return 'terminal';
  if (tool === 'WebSearch' || tool === 'WebFetch' || tool.startsWith('mcp__')) return 'web';
  if (tool === 'Task' || tool === 'Agent') return 'agent';
  return 'generic';
}

const HOLO_COLOR: Record<HoloKind, string> = {
  read: FX.holoBlue,
  code: FX.holoViolet,
  terminal: FX.holoGreen,
  web: FX.holoCyan,
  agent: FX.holoAmber,
  generic: FX.holoCyan,
};

/** A small holographic panel over the station whose glyph says which kind of tool is running. */
function drawHologram(
  c: CanvasRenderingContext2D,
  kind: HoloKind,
  x: number,
  y: number,
  zoom: number,
  now: number,
): void {
  const u = Math.max(1, Math.round(zoom / 2)); // one hologram pixel
  const w = 14 * u;
  const h = 9 * u;
  const left = Math.round(x - w / 2);
  const top = Math.round(y - h - 8 * zoom + Math.sin(now / 500) * u);
  const color = HOLO_COLOR[kind];
  c.save();
  c.globalAlpha = 0.85;
  c.fillStyle = FX.holoPanel;
  c.fillRect(left, top, w, h);
  c.strokeStyle = color;
  c.lineWidth = u;
  c.strokeRect(left + u / 2, top + u / 2, w - u, h - u);
  c.fillStyle = color;
  const tick = Math.floor(now / 160);
  const px = (gx: number, gy: number, gw = 1, gh = 1) =>
    c.fillRect(left + gx * u, top + gy * u, gw * u, gh * u);
  switch (kind) {
    case 'read': // scanning document lines
      for (let row = 0; row < 3; row++) px(3, 2 + row * 2, 6 + ((row + tick) % 3), 1);
      px(2 + (tick % 9), 1, 1, 7);
      break;
    case 'code': // </> with a blinking caret
      px(2, 4, 1, 1);
      px(3, 3);
      px(3, 5);
      px(10, 3);
      px(10, 5);
      px(11, 4);
      px(6, 2 + (tick % 2), 1, 1);
      px(7, 4);
      px(6, 6 - (tick % 2));
      break;
    case 'terminal': // prompt + streaming output
      px(2, 2);
      px(3, 3);
      px(2, 4);
      px(5, 4, 1 + (tick % 7), 1);
      if (tick % 2) px(5 + (tick % 7) + 1, 4);
      px(2, 6, 3 + ((tick * 3) % 8), 1);
      break;
    case 'web': // globe with a sweeping meridian
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2;
        px(Math.round(7 + Math.cos(ang) * 3), Math.round(4.5 + Math.sin(ang) * 3));
      }
      px(7 + Math.round(Math.sin(now / 300) * 2), 2, 1, 5);
      break;
    case 'agent': // parent node → child node
      px(3, 2, 2, 2);
      px(9, 5, 2, 2);
      px(5, 3, 1, 1);
      px(6, 4);
      px(7, 4);
      px(8, 5);
      break;
    case 'generic':
      px(3, 4, 8, 1);
      px(3 + (tick % 8), 3, 1, 3);
      break;
  }
  // Projection cone from the monitor up to the panel.
  const cone = c.createLinearGradient(0, top + h, 0, y);
  cone.addColorStop(0, color);
  cone.addColorStop(1, TRANSPARENT_COLOR);
  c.globalAlpha = 0.18;
  c.fillStyle = cone;
  c.beginPath();
  c.moveTo(left, top + h);
  c.lineTo(left + w, top + h);
  c.lineTo(x + 2 * u, y);
  c.lineTo(x - 2 * u, y);
  c.closePath();
  c.fill();
  c.restore();
}

// ── Per-character indicators ─────────────────────────────────────

/** Status ring on the floor under a character; drawn just before the character itself. */
export function drawStatusRing(
  c: CanvasRenderingContext2D,
  ch: Character,
  offsetX: number,
  offsetY: number,
  zoom: number,
  now: number,
): void {
  const status = characterStatus(ch);
  if (!status) return;
  const color = STATUS_RING_COLORS[status] ?? STATUS_RING_COLORS.unknown;
  const [cx, cy] = feet(ch, offsetX, offsetY, zoom);
  const live = LIVE_STATUSES.has(status);
  c.save();
  c.globalAlpha = live ? 0.55 + 0.4 * pulse(now) : 0.4;
  c.strokeStyle = color;
  c.lineWidth = Math.max(1, zoom * 0.5);
  c.beginPath();
  c.ellipse(cx, cy, RING_RX * zoom, RING_RY * zoom, 0, 0, Math.PI * 2);
  c.stroke();
  c.globalAlpha = live ? 0.18 : 0.07;
  c.fillStyle = color;
  c.fill();
  c.restore();
}

function drawThinking(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  zoom: number,
  now: number,
): void {
  // Three orbs orbiting the head — no halo, so the character stays readable.
  const r = 8 * zoom;
  c.fillStyle = FX.thinking;
  const s = Math.max(2, Math.round(zoom * 0.9));
  for (let i = 0; i < 3; i++) {
    const a = now / 420 + (i * Math.PI * 2) / 3;
    c.globalAlpha = 0.55 + 0.45 * Math.sin(a * 1.5);
    c.fillRect(
      Math.round(x + Math.cos(a) * r - s / 2),
      Math.round(y + Math.sin(a) * r * 0.45 - s / 2),
      s,
      s,
    );
  }
  c.globalAlpha = 1;
}

function drawGlyphBadge(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  zoom: number,
  color: string,
  glyph: 'lock' | 'question' | 'alert',
  now: number,
): void {
  const u = Math.max(1, Math.round(zoom / 2));
  const size = 9 * u;
  const left = Math.round(x - size / 2);
  const top = Math.round(y - size - 4 * zoom);
  c.save();
  c.globalAlpha = 0.6 + 0.4 * pulse(now, 1100);
  c.strokeStyle = color;
  c.lineWidth = u;
  c.strokeRect(left + u / 2, top + u / 2, size - u, size - u);
  c.fillStyle = color;
  const px = (gx: number, gy: number, gw = 1, gh = 1) =>
    c.fillRect(left + gx * u, top + gy * u, gw * u, gh * u);
  if (glyph === 'lock') {
    px(3, 2, 3, 1);
    px(3, 3);
    px(5, 3);
    px(2, 4, 5, 3);
  } else if (glyph === 'question') {
    px(3, 2, 3, 1);
    px(5, 3);
    px(4, 4);
    px(4, 6);
  } else {
    px(4, 2, 1, 3);
    px(4, 6);
  }
  c.restore();
}

function ringWave(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  zoom: number,
  progress: number,
  color: string,
  maxR: number,
): void {
  c.save();
  c.globalAlpha = (1 - progress) * 0.9;
  c.strokeStyle = color;
  c.lineWidth = Math.max(1, zoom * (1 - progress) * 1.2);
  c.beginPath();
  c.ellipse(x, y, maxR * progress * zoom, maxR * progress * zoom * 0.42, 0, 0, Math.PI * 2);
  c.stroke();
  c.restore();
}

function drawDoneBurst(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  zoom: number,
  progress: number,
): void {
  ringWave(c, x, y, zoom, progress, FX.done, 22);
  c.save();
  c.fillStyle = FX.done;
  const s = Math.max(2, Math.round(zoom));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const d = (6 + progress * 18) * zoom;
    c.globalAlpha = 1 - progress;
    c.fillRect(
      Math.round(x + Math.cos(a) * d),
      Math.round(y - 14 * zoom + Math.sin(a) * d * 0.6),
      s,
      s,
    );
  }
  c.restore();
}

function lightColor(status: TelemetryStatus | null): string | null {
  switch (status) {
    case 'active':
    case 'thinking':
    case 'tool':
      return WORKSTATION_LIGHT_COLOR;
    case 'permission':
      return WORKSTATION_LIGHT_PERMISSION_COLOR;
    case 'error':
      return WORKSTATION_LIGHT_ERROR_COLOR;
    default:
      return null;
  }
}

/** Holographic link between two characters, with energy flowing from `from` to `to`. */
function drawLink(
  c: CanvasRenderingContext2D,
  from: Character,
  to: Character,
  offsetX: number,
  offsetY: number,
  zoom: number,
  now: number,
  color: string,
): void {
  const [x1, y1] = feet(from, offsetX, offsetY, zoom);
  const [x2, y2] = feet(to, offsetX, offsetY, zoom);
  const ay1 = y1 - 10 * zoom;
  const ay2 = y2 - 10 * zoom;
  const midX = (x1 + x2) / 2;
  const midY = Math.min(ay1, ay2) - 14 * zoom;
  c.save();
  c.strokeStyle = color;
  c.lineWidth = Math.max(1, zoom * 0.5);
  c.setLineDash([3 * zoom, 3 * zoom]);
  c.lineDashOffset = -now / 40;
  c.globalAlpha = 0.75;
  c.beginPath();
  c.moveTo(x1, ay1);
  c.quadraticCurveTo(midX, midY, x2, ay2);
  c.stroke();
  c.setLineDash([]);
  // A packet travelling along the link.
  const t = (now / 1100) % 1;
  const qx = (1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * midX + t * t * x2;
  const qy = (1 - t) * (1 - t) * ay1 + 2 * (1 - t) * t * midY + t * t * ay2;
  const s = Math.max(2, Math.round(zoom));
  c.fillStyle = FX.linkDot;
  c.globalAlpha = 1;
  c.fillRect(Math.round(qx - s / 2), Math.round(qy - s / 2), s, s);
  c.restore();
}

/**
 * Everything drawn over the finished scene: station light and holograms for
 * agents doing real work, state badges, transition effects, energy
 * particles, relationship links and the selection beam.
 */
export function renderCommandCenterLighting(
  ctx: CanvasRenderingContext2D,
  characters: readonly Character[],
  offsetX: number,
  offsetY: number,
  zoom: number,
  selectedId: number | null,
  now: number,
): void {
  pruneTransitions(characters);
  const byId = new Map(characters.map((ch) => [ch.id, ch]));
  const dt = lastParticleTick === 0 ? 0 : Math.min(0.1, (now - lastParticleTick) / 1000);
  lastParticleTick = now;

  // 1. Relationship links: every live sub-agent to its parent; teammates to their
  //    lead while either of them is selected.
  for (const ch of characters) {
    if (ch.matrixEffect) continue;
    if (ch.isSubagent && ch.parentAgentId !== null) {
      const parent = byId.get(ch.parentAgentId);
      if (parent && !parent.matrixEffect)
        drawLink(ctx, parent, ch, offsetX, offsetY, zoom, now, FX.link);
    } else if (ch.leadAgentId !== undefined && selectedId !== null) {
      const lead = byId.get(ch.leadAgentId);
      if (lead && (selectedId === ch.id || selectedId === lead.id)) {
        drawLink(ctx, lead, ch, offsetX, offsetY, zoom, now, FX.linkTeam);
      }
    }
  }

  // 2. Station light (additive) for seated agents really working / blocked / failing.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const radius = WORKSTATION_LIGHT_RADIUS_TILES * TILE_SIZE * zoom;
  for (const ch of characters) {
    if (ch.matrixEffect || ch.state !== CharacterState.TYPE) continue;
    const status = characterStatus(ch);
    const color = lightColor(status);
    if (!color) continue;
    const [lx, ly] = station(ch, offsetX, offsetY, zoom);
    const flicker =
      status === 'error' ? 0.5 + 0.5 * Math.round(pulse(now, 300)) : 0.75 + 0.25 * pulse(now);
    const gradient = ctx.createRadialGradient(lx, ly, 0, lx, ly, radius);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, TRANSPARENT_COLOR);
    ctx.globalAlpha = flicker;
    ctx.fillStyle = gradient;
    ctx.fillRect(lx - radius, ly - radius, radius * 2, radius * 2);

    // Energy rising from working stations (pooled; emission rate is per second).
    if (status && WORKING_STATUSES.has(status) && !prefersReducedMotion()) {
      const debt = (emitDebt.get(ch.id) ?? 0) + dt * PARTICLES_PER_SEC;
      const whole = Math.floor(debt);
      for (let i = 0; i < whole; i++) emit(lx, ly, status === 'thinking' ? FX.thinking : FX.energy);
      emitDebt.set(ch.id, debt - whole);
    }
  }
  // Advance + draw particles.
  const ps = Math.max(1, Math.round(zoom * 0.75));
  for (const p of particles) {
    if (!p.alive) continue;
    p.age += dt;
    if (p.age >= PARTICLE_LIFE_SEC) {
      p.alive = false;
      continue;
    }
    p.x += p.vx * dt * zoom * 0.25;
    p.y += p.vy * dt * zoom * 0.25;
    ctx.globalAlpha = 1 - p.age / PARTICLE_LIFE_SEC;
    ctx.fillStyle = p.color;
    ctx.fillRect(Math.round(p.x), Math.round(p.y), ps, ps);
  }
  ctx.restore();

  // 3. Per-agent state: holograms, thinking, badges, transitions.
  for (const ch of characters) {
    if (ch.matrixEffect) continue;
    const status = characterStatus(ch);
    const t = trackTransition(ch, status, now);
    const [fx, fy] = feet(ch, offsetX, offsetY, zoom);
    const [hx, hy] = head(ch, offsetX, offsetY, zoom);

    if (status === 'tool' && ch.state === CharacterState.TYPE) {
      const kind = holoKind(ch.currentTool);
      if (kind) {
        // Beside the monitor, clear of the label that floats over the agent's head.
        const [sx, sy] = station(ch, offsetX, offsetY, zoom);
        drawHologram(ctx, kind, sx + HOLO_SIDE_OFFSET * zoom, sy + HOLO_DROP * zoom, zoom, now);
      }
    } else if (status === 'thinking') {
      // Orbiting the head itself, below the floating label.
      drawThinking(ctx, hx, hy + THINK_HEAD_DROP * zoom, zoom, now);
    } else if (status === 'permission') {
      drawGlyphBadge(ctx, hx, hy + 6 * zoom, zoom, FX.permission, 'lock', now);
    } else if (status === 'waiting_input') {
      drawGlyphBadge(ctx, hx, hy + 6 * zoom, zoom, FX.waiting, 'question', now);
    } else if (status === 'error') {
      drawGlyphBadge(ctx, hx, hy + 6 * zoom, zoom, FX.error, 'alert', now);
    }

    if (t.rippleAt && now - t.rippleAt < RIPPLE_MS) {
      ringWave(ctx, fx, fy, zoom, (now - t.rippleAt) / RIPPLE_MS, FX.ripple, 18);
    }
    if (t.doneAt && now - t.doneAt < DONE_BURST_MS) {
      drawDoneBurst(ctx, fx, fy, zoom, (now - t.doneAt) / DONE_BURST_MS);
    }
    if (t.errorAt && now - t.errorAt < ERROR_WAVE_MS) {
      ringWave(ctx, fx, fy, zoom, (now - t.errorAt) / ERROR_WAVE_MS, FX.error, 26);
    }
  }

  // 4. Selection: beam, glow and targeting brackets.
  const selected = selectedId !== null ? byId.get(selectedId) : undefined;
  if (selected && !selected.matrixEffect) {
    const [cx, cy] = feet(selected, offsetX, offsetY, zoom);
    const p = pulse(now);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const beamW = BEAM_WIDTH * zoom;
    const beamH = BEAM_HEIGHT * zoom;
    const beam = ctx.createLinearGradient(0, cy, 0, cy - beamH);
    beam.addColorStop(0, SELECTION_GLOW_COLOR);
    beam.addColorStop(1, TRANSPARENT_COLOR);
    ctx.globalAlpha = 0.35 + 0.25 * p;
    ctx.fillStyle = beam;
    ctx.fillRect(cx - beamW / 2, cy - beamH, beamW, beamH);
    const glowR = RING_RX * 1.9 * zoom;
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
    glow.addColorStop(0, SELECTION_GLOW_CORE_COLOR);
    glow.addColorStop(1, TRANSPARENT_COLOR);
    ctx.globalAlpha = 0.45 + 0.3 * p;
    ctx.fillStyle = glow;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, RING_RY / RING_RX);
    ctx.translate(-cx, -cy);
    ctx.fillRect(cx - glowR, cy - glowR, glowR * 2, glowR * 2);
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = SELECTION_GLOW_CORE_COLOR;
    ctx.lineWidth = Math.max(1, Math.round(zoom / 2));
    const half = 10 * zoom + p * zoom;
    const top = cy - 30 * zoom - p * zoom;
    const bottom = cy + 3 * zoom + p * zoom;
    const arm = 4 * zoom;
    const corners: [number, number, number, number][] = [
      [cx - half, top, 1, 1],
      [cx + half, top, -1, 1],
      [cx - half, bottom, 1, -1],
      [cx + half, bottom, -1, -1],
    ];
    ctx.beginPath();
    for (const [x, y, sx, sy] of corners) {
      ctx.moveTo(x + sx * arm, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + sy * arm);
    }
    ctx.stroke();
    ctx.restore();
  }
}

/** Test seam: clear edge-tracking and particles. */
export function resetCommandCenterFx(): void {
  transitions.clear();
  emitDebt.clear();
  for (const p of particles) p.alive = false;
  lastParticleTick = 0;
}
