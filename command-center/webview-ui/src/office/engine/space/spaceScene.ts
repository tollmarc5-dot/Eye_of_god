import { SPACE_COLORS as C, TRANSPARENT_COLOR } from '../../../constants.js';
import { createRng, type Rng } from './rng.js';

/**
 * The universe around the station: purely ambient and procedural. Nothing in
 * here reflects agent work — it moves whether or not any agent exists.
 *
 * Cost model: everything with detail (nebulae, galaxy, planets, asteroids,
 * ship) is pre-rendered once into small offscreen canvases; a frame only
 * blits those images and draws a few hundred star/dust pixels. Depth comes
 * from parallax against the office camera offset.
 */

interface Star {
  x: number;
  y: number;
  size: number;
  color: string;
  phase: number;
  speed: number;
  base: number;
}

interface StarLayer {
  stars: Star[];
  parallax: number;
  drift: number;
}

interface Asteroid {
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  angle: number;
  sprite: HTMLCanvasElement;
  scale: number;
  parallax: number;
}

interface Ship {
  start: number;
  duration: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  scale: number;
}

interface Streak {
  start: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
}

/** Virtual sky size, in multiples of the viewport, that layers wrap around. */
const SKY_SPAN = 1.6;
const SHIP_MIN_GAP_MS = 22_000;
const SHIP_MAX_GAP_MS = 48_000;
const STREAK_MIN_GAP_MS = 9_000;
const STREAK_MAX_GAP_MS = 24_000;
const STREAK_MS = 900;
/** On-screen size of the near bodies, as a fraction of the viewport height. */
const GALAXY_VIEW_FRACTION = 0.42;
const PLANET_A_VIEW_FRACTION = 0.38;
const PLANET_B_VIEW_FRACTION = 0.16;

function offscreen(
  w: number,
  h: number,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');
  return { canvas, ctx };
}

function nebulaSprite(rng: Rng, colors: readonly string[]): HTMLCanvasElement {
  const size = 192;
  const { canvas, ctx } = offscreen(size, size);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 9; i++) {
    const x = size * (0.25 + rng() * 0.5);
    const y = size * (0.25 + rng() * 0.5);
    const r = size * (0.18 + rng() * 0.3);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, colors[i % colors.length]);
    g.addColorStop(1, TRANSPARENT_COLOR);
    ctx.globalAlpha = 0.25 + rng() * 0.35;
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return canvas;
}

function galaxySprite(rng: Rng): HTMLCanvasElement {
  const size = 96;
  const { canvas, ctx } = offscreen(size, size);
  const c = size / 2;
  for (let i = 0; i < 900; i++) {
    const arm = i % 2;
    const t = rng() * 3.2;
    const angle = t * 2.1 + arm * Math.PI + (rng() - 0.5) * 0.55;
    const radius = t * 13 + rng() * 3;
    const x = c + Math.cos(angle) * radius;
    const y = c + Math.sin(angle) * radius * 0.45;
    ctx.fillStyle = radius < 9 ? C.galaxyCore : C.galaxyArm;
    ctx.globalAlpha = Math.max(0.08, 0.9 - radius / 48);
    ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
  }
  const core = ctx.createRadialGradient(c, c, 0, c, c, 10);
  core.addColorStop(0, C.galaxyCore);
  core.addColorStop(1, TRANSPARENT_COLOR);
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

/** A small pixel planet; `turn` scrolls its bands so it appears to rotate. */
function drawPlanet(
  ctx: CanvasRenderingContext2D,
  size: number,
  palette: readonly string[],
  turn: number,
  bandSeed: number,
): void {
  ctx.clearRect(0, 0, size, size);
  const r = size / 2 - 1;
  const cx = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - cx) / r;
      const dy = (y + 0.5 - cx) / r;
      const d2 = dx * dx + dy * dy;
      if (d2 > 1) continue;
      // Spherical band coordinate + rotation offset → banded surface.
      const lon = Math.asin(Math.max(-1, Math.min(1, dx / Math.sqrt(1 - dy * dy || 1))));
      const band = Math.sin(dy * 7 + bandSeed) + 0.6 * Math.sin((lon + turn) * 3 + dy * 4);
      const light = 1 - (dx * 0.7 + dy * 0.5 + 0.35);
      let idx = Math.floor((band * 0.35 + light * 0.9 + 0.6) * (palette.length - 1));
      idx = Math.max(0, Math.min(palette.length - 1, idx));
      ctx.fillStyle = palette[idx];
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

function asteroidSprite(rng: Rng): HTMLCanvasElement {
  const size = 10 + Math.floor(rng() * 6);
  const { canvas, ctx } = offscreen(size, size);
  const c = size / 2;
  const lobes = Array.from({ length: 7 }, () => 0.65 + rng() * 0.35);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const a = (Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2);
      const lobe = lobes[Math.floor(a * lobes.length) % lobes.length];
      const d = Math.hypot(dx, dy) / (c * lobe);
      if (d > 1) continue;
      const shade = Math.max(
        0,
        Math.min(3, Math.floor((1 - d) * 2 + (dx < 0 ? 1 : 0) + rng() * 0.6)),
      );
      ctx.fillStyle = C.asteroid[shade];
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return canvas;
}

function shipSprite(): HTMLCanvasElement {
  const { canvas, ctx } = offscreen(18, 8);
  const px = (x: number, y: number, w: number, h: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  };
  px(3, 3, 12, 2, C.shipHull);
  px(5, 2, 8, 1, C.shipHull);
  px(5, 5, 8, 1, C.shipDark);
  px(6, 0, 3, 2, C.shipDark);
  px(6, 6, 3, 2, C.shipDark);
  px(12, 3, 3, 1, C.shipCanopy);
  px(15, 3, 2, 2, C.shipHull);
  px(1, 3, 2, 2, C.shipEngine);
  return canvas;
}

export class SpaceScene {
  private readonly rng: Rng;
  private readonly layers: StarLayer[];
  private readonly nebulae: {
    sprite: HTMLCanvasElement;
    x: number;
    y: number;
    scale: number;
    phase: number;
  }[];
  private readonly galaxy: HTMLCanvasElement;
  private readonly planetA = offscreen(44, 44);
  private readonly planetB = offscreen(26, 26);
  private readonly moon = offscreen(9, 9);
  private planetTurnDrawn = -1;
  private readonly asteroids: Asteroid[];
  private readonly ship = shipSprite();
  private currentShip: Ship | null = null;
  private nextShipAt = 0;
  private streak: Streak | null = null;
  private nextStreakAt = 0;
  private readonly dust: { x: number; y: number; vx: number; vy: number; phase: number }[];

  constructor(seed = 0x5eed) {
    this.rng = createRng(seed);
    const rng = this.rng;
    const palette = [C.starWhite, C.starWhite, C.starBlue, C.starViolet, C.starWarm];
    const layer = (count: number, parallax: number, drift: number, maxSize: number): StarLayer => ({
      parallax,
      drift,
      stars: Array.from({ length: count }, () => ({
        x: rng(),
        y: rng(),
        size: 1 + Math.floor(rng() * maxSize),
        color: palette[Math.floor(rng() * palette.length)],
        phase: rng() * Math.PI * 2,
        speed: 0.6 + rng() * 2.2,
        base: 0.35 + rng() * 0.65,
      })),
    });
    this.layers = [layer(210, 0.04, 0.002, 1), layer(120, 0.1, 0.005, 2), layer(45, 0.2, 0.01, 2)];
    this.nebulae = [
      {
        sprite: nebulaSprite(rng, [C.nebulaViolet, C.nebulaBlue, C.nebulaMagenta]),
        x: 0.18,
        y: 0.3,
        scale: 5.2,
        phase: 0,
      },
      {
        sprite: nebulaSprite(rng, [C.nebulaBlue, C.nebulaCyan, C.nebulaViolet]),
        x: 0.82,
        y: 0.72,
        scale: 4.4,
        phase: 2.1,
      },
      {
        sprite: nebulaSprite(rng, [C.nebulaMagenta, C.nebulaViolet]),
        x: 0.62,
        y: 0.12,
        scale: 3.4,
        phase: 4.2,
      },
    ];
    this.galaxy = galaxySprite(rng);
    this.asteroids = Array.from({ length: 9 }, () => ({
      x: rng(),
      y: rng(),
      vx: (rng() - 0.5) * 0.004,
      vy: (rng() - 0.5) * 0.0025,
      spin: (rng() - 0.5) * 0.25,
      angle: rng() * Math.PI * 2,
      sprite: asteroidSprite(rng),
      scale: 1 + rng() * 1.6,
      parallax: 0.12 + rng() * 0.18,
    }));
    this.dust = Array.from({ length: 70 }, () => ({
      x: rng(),
      y: rng(),
      vx: 0.004 + rng() * 0.01,
      vy: (rng() - 0.5) * 0.004,
      phase: rng() * Math.PI * 2,
    }));
    drawPlanet(this.moon.ctx, 9, C.moon, 0, 1.3);
  }

  /**
   * Draws the whole sky for one frame. `camX/camY` is the office map offset in
   * device pixels (moves with pan) and drives parallax; `px` is the device-pixel
   * size of one art pixel so the sky shares the office's pixel grid.
   */
  render(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    camX: number,
    camY: number,
    px: number,
    now: number,
  ): void {
    const t = now / 1000;
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, C.skyTop);
    sky.addColorStop(1, C.skyBottom);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // Nebulae: soft, slow drift and breathing.
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.globalCompositeOperation = 'lighter';
    for (const n of this.nebulae) {
      const size = Math.max(w, h) * 0.7 * (n.scale / 4);
      const x = n.x * w + Math.sin(t * 0.013 + n.phase) * w * 0.02 + camX * 0.02 - size / 2;
      const y = n.y * h + Math.cos(t * 0.011 + n.phase) * h * 0.02 + camY * 0.02 - size / 2;
      ctx.globalAlpha = 0.55 + 0.15 * Math.sin(t * 0.07 + n.phase);
      ctx.drawImage(n.sprite, x, y, size, size);
    }
    ctx.restore();

    // Distant galaxy, rotating very slowly.
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 0.95;
    // Sized from the viewport (whole multiples keep it crisp): a galaxy close enough to read.
    const gs =
      this.galaxy.width * Math.max(px, Math.round((h * GALAXY_VIEW_FRACTION) / this.galaxy.width));
    ctx.translate(w * 0.66 + camX * 0.03, h * 0.1 + camY * 0.03);
    ctx.rotate(t * 0.004);
    ctx.drawImage(this.galaxy, -gs / 2, -gs / 2, gs, gs);
    ctx.restore();

    // Stars: three depths, twinkling, wrapping over a virtual sky.
    const spanW = w * SKY_SPAN;
    const spanH = h * SKY_SPAN;
    for (const layer of this.layers) {
      const ox = camX * layer.parallax + t * layer.drift * w;
      const oy = camY * layer.parallax;
      for (const s of layer.stars) {
        let x = (s.x * spanW + ox) % spanW;
        let y = (s.y * spanH + oy) % spanH;
        if (x < 0) x += spanW;
        if (y < 0) y += spanH;
        if (x > w || y > h) continue;
        ctx.globalAlpha = s.base * (0.55 + 0.45 * Math.sin(t * s.speed + s.phase));
        ctx.fillStyle = s.color;
        const size = Math.max(1, Math.round(s.size * px * 0.5));
        ctx.fillRect(Math.round(x), Math.round(y), size, size);
      }
    }
    ctx.globalAlpha = 1;

    this.renderPlanets(ctx, w, h, camX, camY, t);
    this.renderAsteroids(ctx, w, h, camX, camY, px);
    this.renderShip(ctx, w, h, camX, camY, px, now);
    this.renderStreak(ctx, w, h, now);

    // Dust: tiny luminous particles closest to the camera.
    ctx.fillStyle = C.dust;
    for (const d of this.dust) {
      d.x = (d.x + d.vx * 0.016) % 1;
      d.y = (d.y + d.vy * 0.016 + 1) % 1;
      const x = (((d.x * w + camX * 0.35) % w) + w) % w;
      const y = (((d.y * h + camY * 0.35) % h) + h) % h;
      ctx.globalAlpha = 0.25 + 0.25 * Math.sin(t * 1.3 + d.phase);
      ctx.fillRect(
        Math.round(x),
        Math.round(y),
        Math.max(1, Math.round(px * 0.5)),
        Math.max(1, Math.round(px * 0.5)),
      );
    }
    ctx.globalAlpha = 1;
  }

  private renderPlanets(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    camX: number,
    camY: number,
    t: number,
  ): void {
    // Re-shade the rotating surfaces a few times per second, not every frame.
    const turnStep = Math.floor(t * 4);
    if (turnStep !== this.planetTurnDrawn) {
      this.planetTurnDrawn = turnStep;
      drawPlanet(this.planetA.ctx, 44, C.planetA, turnStep * 0.012, 0.4);
      drawPlanet(this.planetB.ctx, 26, C.planetB, turnStep * 0.02, 2.2);
    }
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    // Whole-pixel scales derived from the viewport: near planets, not specks.
    const scale = Math.max(1, Math.round((h * PLANET_A_VIEW_FRACTION) / 44));
    const bScale = Math.max(1, Math.round((h * PLANET_B_VIEW_FRACTION) / 26));

    // Planet A: large, ringed, slow orbit of its position.
    const aSize = 44 * scale;
    const ax = w * 0.27 + Math.cos(t * 0.01) * w * 0.01 + camX * 0.07;
    const ay = h * 0.97 + Math.sin(t * 0.01) * h * 0.01 + camY * 0.07;
    const glow = ctx.createRadialGradient(ax, ay, aSize * 0.3, ax, ay, aSize * 0.95);
    glow.addColorStop(0, C.planetGlow);
    glow.addColorStop(1, TRANSPARENT_COLOR);
    ctx.fillStyle = glow;
    ctx.fillRect(ax - aSize, ay - aSize, aSize * 2, aSize * 2);
    ctx.drawImage(this.planetA.canvas, ax - aSize / 2, ay - aSize / 2, aSize, aSize);
    ctx.strokeStyle = C.planetRing;
    ctx.lineWidth = Math.max(1, scale);
    ctx.beginPath();
    ctx.ellipse(ax, ay, aSize * 0.82, aSize * 0.2, -0.32, Math.PI * 0.05, Math.PI * 1.02);
    ctx.stroke();

    // Planet B with an orbiting moon.
    const bSize = 26 * bScale;
    const bx = w * 0.74 + camX * 0.05;
    const by = h * 0.93 + camY * 0.05;
    ctx.drawImage(this.planetB.canvas, bx - bSize / 2, by - bSize / 2, bSize, bSize);
    const moonAngle = t * 0.06;
    const mx = bx + Math.cos(moonAngle) * bSize * 1.1;
    const my = by + Math.sin(moonAngle) * bSize * 0.35;
    const mSize = 9 * bScale;
    // The moon passes behind the planet on the far half of its orbit.
    if (Math.sin(moonAngle) > 0 || Math.abs(mx - bx) > bSize / 2) {
      ctx.drawImage(this.moon.canvas, mx - mSize / 2, my - mSize / 2, mSize, mSize);
    }
    ctx.restore();
  }

  private renderAsteroids(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    camX: number,
    camY: number,
    px: number,
  ): void {
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    for (const a of this.asteroids) {
      a.x = (a.x + a.vx * 0.016 + 1) % 1;
      a.y = (a.y + a.vy * 0.016 + 1) % 1;
      a.angle += a.spin * 0.016;
      const x = (((a.x * w + camX * a.parallax) % w) + w) % w;
      const y = (((a.y * h + camY * a.parallax) % h) + h) % h;
      const size = a.sprite.width * Math.max(1, Math.round(px * a.scale * 0.6));
      ctx.save();
      ctx.translate(Math.round(x), Math.round(y));
      // Quarter-turn steps keep the pixel art crisp while it tumbles.
      ctx.rotate(Math.round(a.angle / (Math.PI / 2)) * (Math.PI / 2));
      ctx.drawImage(a.sprite, -size / 2, -size / 2, size, size);
      ctx.restore();
    }
    ctx.restore();
  }

  private renderShip(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    camX: number,
    camY: number,
    px: number,
    now: number,
  ): void {
    if (this.nextShipAt === 0) this.nextShipAt = now + 6_000;
    if (!this.currentShip && now >= this.nextShipAt) {
      const leftToRight = this.rng() > 0.5;
      const y0 = h * (0.15 + this.rng() * 0.7);
      this.currentShip = {
        start: now,
        duration: 11_000 + this.rng() * 7_000,
        fromX: leftToRight ? -60 : w + 60,
        toX: leftToRight ? w + 60 : -60,
        fromY: y0,
        toY: y0 + (this.rng() - 0.5) * h * 0.25,
        scale: Math.max(1, Math.round(px * (0.8 + this.rng() * 0.6))),
      };
    }
    const ship = this.currentShip;
    if (!ship) return;
    const p = (now - ship.start) / ship.duration;
    if (p >= 1) {
      this.currentShip = null;
      this.nextShipAt = now + SHIP_MIN_GAP_MS + this.rng() * (SHIP_MAX_GAP_MS - SHIP_MIN_GAP_MS);
      return;
    }
    const x = ship.fromX + (ship.toX - ship.fromX) * p + camX * 0.15;
    const y = ship.fromY + (ship.toY - ship.fromY) * p + camY * 0.15;
    const dir = ship.toX > ship.fromX ? 1 : -1;
    const sw = this.ship.width * ship.scale;
    const sh = this.ship.height * ship.scale;
    // Engine trail.
    const trail = ctx.createLinearGradient(x, y, x - dir * sw * 2.5, y);
    trail.addColorStop(0, C.shipTrail);
    trail.addColorStop(1, TRANSPARENT_COLOR);
    ctx.fillStyle = trail;
    const trailX = dir > 0 ? x - sw * 2.5 : x;
    ctx.fillRect(trailX, y - ship.scale, sw * 2.5, ship.scale * 2);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(Math.round(x), Math.round(y));
    if (dir < 0) ctx.scale(-1, 1);
    ctx.drawImage(this.ship, -sw / 2, -sh / 2, sw, sh);
    ctx.restore();
  }

  private renderStreak(ctx: CanvasRenderingContext2D, w: number, h: number, now: number): void {
    if (this.nextStreakAt === 0) this.nextStreakAt = now + STREAK_MIN_GAP_MS;
    if (!this.streak && now >= this.nextStreakAt) {
      this.streak = {
        start: now,
        x: w * (0.2 + this.rng() * 0.7),
        y: h * this.rng() * 0.4,
        dx: -w * (0.15 + this.rng() * 0.1),
        dy: h * (0.12 + this.rng() * 0.08),
      };
    }
    const s = this.streak;
    if (!s) return;
    const p = (now - s.start) / STREAK_MS;
    if (p >= 1) {
      this.streak = null;
      this.nextStreakAt =
        now + STREAK_MIN_GAP_MS + this.rng() * (STREAK_MAX_GAP_MS - STREAK_MIN_GAP_MS);
      return;
    }
    const hx = s.x + s.dx * p;
    const hy = s.y + s.dy * p;
    const g = ctx.createLinearGradient(hx, hy, hx - s.dx * 0.25, hy - s.dy * 0.25);
    g.addColorStop(0, C.shootingStar);
    g.addColorStop(1, TRANSPARENT_COLOR);
    ctx.strokeStyle = g;
    ctx.globalAlpha = 1 - p;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx - s.dx * 0.25, hy - s.dy * 0.25);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}
