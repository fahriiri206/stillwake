// Stillwake's procedural cartography. Every mark is drawn here with Canvas2D: no images,
// fonts, sprites or network requests. The board is the primary surface; the DOM log is paper
// beside it and the minimap is drawn by drawMinimap at the end of this file.

import { DIRS, keyOf, prepareLevel } from './simulation.js';

const IVORY = '#eee5cf';
const GOLD = '#eeb75d';
const VERMILION = '#c65a43';
const TEAL = '#3f8b8f';
const INK = '#0b242a';

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const SERIF = "Georgia, 'Iowan Old Style', 'Times New Roman', serif";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

function hash(c, r, salt = 0) {
  let h = (Math.imul(c | 0, 374761393) + Math.imul(r | 0, 668265263) + Math.imul(salt | 0, 1442695041)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function angleOf(heading) {
  return DIRS[heading]?.angle ?? 0;
}

function shortestTurn(from, to) {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function makeNoiseTile() {
  const tile = document.createElement('canvas');
  tile.width = 180;
  tile.height = 180;
  const g = tile.getContext('2d');
  let seed = 9173;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 520; i++) {
    const x = rnd() * 180;
    const y = rnd() * 180;
    g.fillStyle = `rgba(238,229,207,${0.018 + rnd() * 0.035})`;
    g.fillRect(x, y, 0.7 + rnd() * 1.3, 0.7 + rnd() * 1.3);
  }
  for (let i = 0; i < 34; i++) {
    const x = rnd() * 180;
    const y = rnd() * 180;
    g.strokeStyle = `rgba(238,229,207,${0.02 + rnd() * 0.025})`;
    g.lineWidth = 0.6;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + 8 * rnd(), y + 2, x + 16 * rnd(), y + (rnd() - 0.5) * 4);
    g.stroke();
  }
  return tile;
}

function drawChevron(ctx, x, y, angle, size, color, width = 1.7) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(-size * 0.45, -size * 0.5);
  ctx.lineTo(size * 0.35, 0);
  ctx.lineTo(-size * 0.45, size * 0.5);
  ctx.stroke();
  ctx.restore();
}

function drawStar(ctx, x, y, r, points, inner, color) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = (Math.PI / points) * i - Math.PI / 2;
    const rad = i % 2 === 0 ? r : inner;
    const px = x + Math.cos(a) * rad;
    const py = y + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
    this.w = 0;
    this.h = 0;
    this.layout = { ox: 0, oy: 0, cell: 0, w: 0, h: 0 };
    this.noise = this.ctx.createPattern(makeNoiseTile(), 'repeat');
    this.last = 0;
    this.particles = [];
    this.confetti = [];
    this.flash = { color: null, until: 0 };
    this.stars = [];
    this.staticCanvas = document.createElement('canvas');
    this.staticKey = '';
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2.25, window.devicePixelRatio || 1);
    this.w = Math.max(320, rect.width);
    this.h = Math.max(280, rect.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }

  computeLayout(level) {
    const padX = clamp(this.w * 0.055, 26, 70);
    const padTop = clamp(this.h * 0.085, 54, 78);
    const padBottom = clamp(this.h * 0.075, 44, 66);
    const cell = Math.min((this.w - padX * 2) / level.w, (this.h - padTop - padBottom) / level.h);
    const gw = cell * level.w;
    const gh = cell * level.h;
    this.layout = {
      ox: (this.w - gw) / 2,
      oy: padTop + (this.h - padTop - padBottom - gh) / 2,
      cell,
      w: gw,
      h: gh,
    };
    return this.layout;
  }

  cellCenter(c, r) {
    const L = this.layout;
    return { x: L.ox + (c + 0.5) * L.cell, y: L.oy + (r + 0.5) * L.cell };
  }

  viewportCellCenter(c, r) {
    const p = this.cellCenter(c, r);
    const rect = this.canvas.getBoundingClientRect();
    return { x: rect.left + p.x, y: rect.top + p.y };
  }

  cellAt(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const L = this.layout;
    if (L.cell <= 0) return null;
    const c = Math.floor((x - L.ox) / L.cell);
    const r = Math.floor((y - L.oy) / L.cell);
    if (c < 0 || r < 0 || c >= L.w / L.cell || r >= L.h / L.cell) return null;
    return { c, r };
  }

  clearFx() {
    this.particles = [];
    this.confetti = [];
    this.stars = [];
    this.flash = { color: null, until: 0 };
  }

  burstPickup(c, r) {
    const { x, y } = this.cellCenter(c, r);
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 18 + Math.random() * 46;
      this.particles.push({
        x, y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed - 18,
        life: 0, max: 0.7 + Math.random() * 0.5,
        size: 1.2 + Math.random() * 2.4,
        color: Math.random() < 0.5 ? GOLD : IVORY,
        kind: 'spark',
      });
    }
  }

  burstWake(c, r, heading) {
    const { x, y } = this.cellCenter(c, r);
    const back = DIRS[heading];
    for (let i = 0; i < 3; i++) {
      this.particles.push({
        x: x - back.dc * this.layout.cell * 0.24 + (Math.random() - 0.5) * 8,
        y: y - back.dr * this.layout.cell * 0.24 + (Math.random() - 0.5) * 8,
        vx: (Math.random() - 0.5) * 12,
        vy: -2 - Math.random() * 8,
        life: 0, max: 0.55 + Math.random() * 0.4,
        size: 1.2 + Math.random() * 2,
        color: IVORY,
        kind: 'foam',
      });
    }
  }

  burstFail(c, r) {
    const { x, y } = this.cellCenter(c, r);
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 24 + Math.random() * 60;
      this.particles.push({
        x, y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        life: 0, max: 0.6 + Math.random() * 0.6,
        size: 1.4 + Math.random() * 2.2,
        color: Math.random() < 0.7 ? VERMILION : IVORY,
        kind: 'spark',
      });
    }
    this.flash = { color: 'rgba(160,48,38,0.22)', until: performance.now() + 420 };
  }

  burstWin() {
    const colors = [IVORY, GOLD, '#7fb7ad', VERMILION, '#d9c89b'];
    for (let i = 0; i < 110; i++) {
      this.confetti.push({
        x: this.w * (0.2 + Math.random() * 0.6),
        y: this.h * (0.08 + Math.random() * 0.22),
        vx: (Math.random() - 0.5) * 130,
        vy: 25 + Math.random() * 90,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 8,
        w: 2 + Math.random() * 5,
        h: 5 + Math.random() * 8,
        color: colors[(Math.random() * colors.length) | 0],
        life: 0,
        max: 2.4 + Math.random() * 1.8,
      });
    }
  }

  draw(view, now) {
    const ctx = this.ctx;
    const dt = this.last === 0 ? 0.016 : Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const t = now / 1000;
    const level = view.level;
    const field = prepareLevel(level);
    const L = this.computeLayout(level);
    const collected = view.collected ?? new Set();

    const staticKey = `${level.id}:${this.w}x${this.h}:${this.dpr}`;
    if (this.staticKey !== staticKey) {
      this.buildStatic(level, field, L);
      this.staticKey = staticKey;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.staticCanvas, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const gx = L.ox;
    const gy = L.oy;
    ctx.save();
    roundRect(ctx, gx - 5, gy - 5, L.w + 10, L.h + 10, 8);
    ctx.clip();
    this.drawCurrents(ctx, level, field, L, t);
    this.drawWhirlpools(ctx, level, field, L, t);
    if (view.screen === 'planning' || view.screen === 'title') this.drawPreview(ctx, level, view, L);
    this.drawDock(ctx, level, field, L, t, collected, view);
    this.drawStart(ctx, level, field, L, t);
    this.drawLanterns(ctx, level, field, L, t, collected);
    this.drawBuoys(ctx, level, view, L, t);
    if (view.screen !== 'title') this.drawWake(ctx, view, L, t);
    this.drawBoat(ctx, level, view, L, t);
    this.drawFocus(ctx, level, view, L, t);
    ctx.restore();

    this.drawCartouche(ctx, level, view);
    this.drawStatus(ctx, view);
    this.drawCompass(ctx, t);
    this.drawScale(ctx, L);
    this.updateAndDrawParticles(ctx, dt);
    this.drawFlash(ctx, now);
  }

  buildStatic(level, field, L) {
    const dpr = this.dpr;
    this.staticCanvas.width = Math.round(this.w * dpr);
    this.staticCanvas.height = Math.round(this.h * dpr);
    const ctx = this.staticCanvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawBackdrop(ctx, 0);
    const gx = L.ox;
    const gy = L.oy;
    ctx.save();
    roundRect(ctx, gx - 5, gy - 5, L.w + 10, L.h + 10, 8);
    ctx.clip();
    ctx.fillStyle = 'rgba(238,229,207,0.025)';
    ctx.fillRect(gx - 5, gy - 5, L.w + 10, L.h + 10);
    this.drawDepthPatches(ctx, level, L);
    this.drawGrid(ctx, L);
    this.drawSeaMarks(ctx, level, L, 0);
    this.drawLand(ctx, level, field, L, 0);
    this.drawReef(ctx, level, field, L, 0);
    ctx.restore();
    this.drawChartFrame(ctx, L);
  }

  drawDepthPatches(ctx, level, L) {
    ctx.save();
    for (let i = 0; i < 7; i++) {
      const cx = L.ox + (0.15 + hash(i, 3, 61) * 0.7) * L.w;
      const cy = L.oy + (0.15 + hash(i, 7, 62) * 0.7) * L.h;
      const rx = L.cell * (1.6 + hash(i, 11, 63) * 2.6);
      const ry = L.cell * (0.9 + hash(i, 13, 64) * 1.8);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry));
      g.addColorStop(0, `rgba(52,120,124,${0.1 + hash(i, 17, 65) * 0.07})`);
      g.addColorStop(0.6, 'rgba(52,120,124,0.045)');
      g.addColorStop(1, 'rgba(52,120,124,0)');
      ctx.fillStyle = g;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, ry / Math.max(rx, ry));
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(rx, ry), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  drawChartFrame(ctx, L) {
    ctx.save();
    ctx.strokeStyle = 'rgba(238,229,207,0.22)';
    ctx.lineWidth = 1;
    ctx.strokeRect(L.ox - 8.5, L.oy - 8.5, L.w + 17, L.h + 17);
    ctx.strokeStyle = 'rgba(238,229,207,0.1)';
    ctx.strokeRect(L.ox - 12.5, L.oy - 12.5, L.w + 25, L.h + 25);
    ctx.strokeStyle = 'rgba(238,183,93,0.6)';
    ctx.lineWidth = 1.3;
    const s = 7;
    for (const [x, y, dx, dy] of [
      [L.ox - 8.5, L.oy - 8.5, 1, 1],
      [L.ox + L.w + 8.5, L.oy - 8.5, -1, 1],
      [L.ox - 8.5, L.oy + L.h + 8.5, 1, -1],
      [L.ox + L.w + 8.5, L.oy + L.h + 8.5, -1, -1],
    ]) {
      ctx.beginPath();
      ctx.moveTo(x + dx * s, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + dy * s);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawBackdrop(ctx, t) {
    const g = ctx.createLinearGradient(0, 0, this.w * 0.35, this.h);
    g.addColorStop(0, '#0b2a31');
    g.addColorStop(0.42, '#123841');
    g.addColorStop(1, '#174b54');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);

    const moon = ctx.createRadialGradient(this.w * 0.82, this.h * 0.03, 0, this.w * 0.82, this.h * 0.03, this.w * 0.62);
    moon.addColorStop(0, 'rgba(238,183,93,0.16)');
    moon.addColorStop(0.45, 'rgba(238,183,93,0.06)');
    moon.addColorStop(1, 'rgba(238,183,93,0)');
    ctx.fillStyle = moon;
    ctx.fillRect(0, 0, this.w, this.h);

    ctx.save();
    for (let i = 0; i < 7; i++) {
      const y0 = this.h * (0.12 + i * 0.13);
      ctx.beginPath();
      for (let x = -20; x <= this.w + 20; x += 34) {
        const y = y0 + Math.sin(x * 0.012 + i * 1.7 + t * 0.06) * (4 + i * 1.2);
        if (x === -20) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(238,229,207,${0.026 + i * 0.004})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();

    if (this.noise) {
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = this.noise;
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.restore();
    }

    const vig = ctx.createRadialGradient(this.w * 0.5, this.h * 0.46, this.h * 0.28, this.w * 0.5, this.h * 0.46, Math.max(this.w, this.h) * 0.72);
    vig.addColorStop(0, 'rgba(3,18,22,0)');
    vig.addColorStop(0.74, 'rgba(3,18,22,0.18)');
    vig.addColorStop(1, 'rgba(3,18,22,0.62)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, this.w, this.h);

    ctx.strokeStyle = 'rgba(238,229,207,0.16)';
    ctx.lineWidth = 1;
    roundRect(ctx, 11.5, 11.5, this.w - 23, this.h - 23, 5);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(238,183,93,0.12)';
    roundRect(ctx, 16.5, 16.5, this.w - 33, this.h - 33, 3);
    ctx.stroke();
  }

  drawGrid(ctx, L) {
    ctx.save();
    ctx.strokeStyle = 'rgba(238,229,207,0.085)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 5]);
    for (let c = 1; c < L.w / L.cell; c++) {
      ctx.beginPath();
      ctx.moveTo(L.ox + c * L.cell, L.oy);
      ctx.lineTo(L.ox + c * L.cell, L.oy + L.h);
      ctx.stroke();
    }
    for (let r = 1; r < L.h / L.cell; r++) {
      ctx.beginPath();
      ctx.moveTo(L.ox, L.oy + r * L.cell);
      ctx.lineTo(L.ox + L.w, L.oy + r * L.cell);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawSeaMarks(ctx, level, L, t) {
    ctx.save();
    for (let r = 0; r < level.h; r++) {
      for (let c = 0; c < level.w; c++) {
        if (hash(c, r, 2) > 0.44) continue;
        const { x, y } = this.cellCenter(c, r);
        const x0 = x + (hash(c, r, 3) - 0.5) * L.cell * 0.5;
        const y0 = y + (hash(c, r, 4) - 0.5) * L.cell * 0.5;
        const w = L.cell * (0.12 + hash(c, r, 5) * 0.12);
        ctx.beginPath();
        ctx.moveTo(x0 - w, y0);
        ctx.quadraticCurveTo(x0, y0 - 2.2, x0 + w, y0);
        ctx.strokeStyle = `rgba(238,229,207,${0.07 + hash(c, r, 6) * 0.055})`;
        ctx.lineWidth = 0.9;
        ctx.stroke();
        if (hash(c, r, 7) > 0.72) {
          ctx.beginPath();
          ctx.moveTo(x0 - w * 0.7, y0 + 3.4);
          ctx.quadraticCurveTo(x0, y0 + 1.2, x0 + w * 0.7, y0 + 3.4);
          ctx.strokeStyle = 'rgba(238,229,207,0.05)';
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  drawLand(ctx, level, field, L, t) {
    const cell = L.cell;
    ctx.save();
    // Sand halo first, then the dark island body, so neighbouring cells feel like one coast.
    for (const [c, r] of level.land) {
      const { x, y } = this.cellCenter(c, r);
      const jitter = (hash(c, r, 21) - 0.5) * cell * 0.1;
      roundRect(ctx, x - cell * 0.56 + jitter, y - cell * 0.55, cell * 1.12, cell * 1.1, cell * 0.3);
      ctx.fillStyle = 'rgba(222,203,155,0.6)';
      ctx.fill();
    }
    for (const [c, r] of level.land) {
      const { x, y } = this.cellCenter(c, r);
      const jitter = (hash(c, r, 22) - 0.5) * cell * 0.08;
      roundRect(ctx, x - cell * 0.49 + jitter, y - cell * 0.48, cell * 0.98, cell * 0.96, cell * 0.25);
      const g = ctx.createLinearGradient(x, y - cell * 0.5, x, y + cell * 0.5);
      g.addColorStop(0, '#647f56');
      g.addColorStop(0.55, '#47664b');
      g.addColorStop(1, '#2d4c3e');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = 'rgba(238,229,207,0.42)';
      ctx.lineWidth = 1.1;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, cell * 0.24, Math.PI * 1.1, Math.PI * 1.75);
      ctx.strokeStyle = 'rgba(238,229,207,0.2)';
      ctx.lineWidth = 0.9;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, cell * 0.13, Math.PI * 1.05, Math.PI * 1.62);
      ctx.strokeStyle = 'rgba(238,229,207,0.14)';
      ctx.stroke();
      if (hash(c, r, 23) > 0.55) {
        const tx = x + (hash(c, r, 24) - 0.5) * cell * 0.4;
        const ty = y + (hash(c, r, 25) - 0.5) * cell * 0.35;
        const s = cell * 0.13;
        ctx.fillStyle = 'rgba(9,32,32,0.7)';
        ctx.beginPath();
        ctx.moveTo(tx, ty - s * 1.7);
        ctx.lineTo(tx + s * 0.85, ty + s * 0.65);
        ctx.lineTo(tx - s * 0.85, ty + s * 0.65);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(201,184,142,0.4)';
        ctx.fillRect(tx - s * 0.12, ty + s * 0.6, s * 0.24, s * 0.5);
      }
    }
    ctx.restore();
  }

  drawReef(ctx, level, field, L, t) {
    const cell = L.cell;
    ctx.save();
    for (const [c, r] of level.reef) {
      const { x, y } = this.cellCenter(c, r);
      const pulse = 0.72 + Math.sin(t * 1.7 + c * 1.2 + r * 0.7) * 0.08;
      ctx.fillStyle = `rgba(138,42,34,${0.34 + pulse * 0.1})`;
      roundRect(ctx, x - cell * 0.42, y - cell * 0.42, cell * 0.84, cell * 0.84, cell * 0.22);
      ctx.fill();
      ctx.strokeStyle = 'rgba(224,120,90,0.75)';
      ctx.lineWidth = 1.1;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, cell * 0.31, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(198,90,67,0.22)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
      for (let i = 0; i < 3; i++) {
        const a = -0.7 + i * 1.1 + hash(c, r, 30 + i) * 0.5;
        const len = cell * (0.18 + hash(c, r, 33 + i) * 0.14);
        ctx.beginPath();
        ctx.moveTo(x +(hash(c, r, 36) - 0.5) * cell * 0.25, y + (hash(c, r, 37) - 0.5) * cell * 0.25);
        ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
        ctx.lineTo(x + Math.cos(a + 0.5) * len * 0.55, y + Math.sin(a + 0.5) * len * 0.55);
        ctx.lineTo(x + Math.cos(a - 0.25) * len * 0.8, y + Math.sin(a - 0.25) * len * 0.8);
        ctx.strokeStyle = i % 2 ? 'rgba(214,104,78,0.95)' : 'rgba(244,196,158,0.7)';
        ctx.lineWidth = 1.6;
        ctx.lineJoin = 'round';
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(x, y, cell * (0.33 + pulse * 0.04), 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(238,229,207,0.13)';
      ctx.lineWidth = 0.8;
      ctx.setLineDash([2, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  drawCurrents(ctx, level, field, L, t) {
    const cell = L.cell;
    ctx.save();
    for (const { c, r, dir } of level.currents) {
      const { x, y } = this.cellCenter(c, r);
      const a = angleOf(dir);
      ctx.fillStyle = 'rgba(63,139,143,0.13)';
      ctx.beginPath();
      ctx.arc(x, y, cell * 0.4, 0, Math.PI * 2);
      ctx.fill();
      const drift = ((t * 0.55) % 1) * 0.24 - 0.12;
      for (let i = 0; i < 3; i++) {
        const off = (i - 1) * 0.2 + drift;
        drawChevron(ctx, x + Math.cos(a) * off * cell, y + Math.sin(a) * off * cell, a, cell * 0.27, 'rgba(156,220,212,0.72)', 1.8);
      }
      ctx.beginPath();
      ctx.arc(x, y, cell * 0.4, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(156,220,212,0.2)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
  }

  drawWhirlpools(ctx, level, field, L, t) {
    const cell = L.cell;
    ctx.save();
    for (const { c, r } of level.whirlpools) {
      const { x, y } = this.cellCenter(c, r);
      ctx.fillStyle = 'rgba(8,30,38,0.5)';
      ctx.beginPath();
      ctx.arc(x, y, cell * 0.4, 0, Math.PI * 2);
      ctx.fill();
      for (let i = 0; i < 3; i++) {
        const start = t * 0.9 + i * (Math.PI * 2 / 3);
        ctx.beginPath();
        for (let s = 0; s <= 18; s++) {
          const a = start + s * 0.18;
          const rad = cell * (0.08 + s * 0.018);
          const px = x + Math.cos(a) * rad;
          const py = y + Math.sin(a) * rad;
          if (s === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.strokeStyle = i === 0 ? 'rgba(238,183,93,0.72)' : 'rgba(156,220,212,0.44)';
        ctx.lineWidth = 1.5;
        ctx.lineCap = 'round';
        ctx.stroke();
      }
      const a = t * 0.9 + 2.9;
      const rad = cell * 0.41;
      drawChevron(ctx, x + Math.cos(a) * rad, y + Math.sin(a) * rad, a + Math.PI / 2, cell * 0.14, 'rgba(238,183,93,0.85)', 1.4);
      ctx.beginPath();
      ctx.arc(x, y, cell * 0.41, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(238,183,93,0.16)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  drawPreview(ctx, level, view, L) {
    const preview = view.preview;
    if (!preview || preview.trail.length < 2) return;
    const cell = L.cell;
    const lost = preview.status === 'lost';
    const won = preview.status === 'won';
    const color = lost ? 'rgba(198,90,67,0.7)' : won ? 'rgba(238,183,93,0.78)' : 'rgba(238,229,207,0.48)';
    ctx.save();
    ctx.lineWidth = Math.max(1.5, cell * 0.035);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([cell * 0.14, cell * 0.13]);
    ctx.strokeStyle = color;
    ctx.beginPath();
    preview.trail.forEach((p, i) => {
      const { x, y } = this.cellCenter(p.c, p.r);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    for (let i = 1; i < preview.trail.length; i++) {
      const p = preview.trail[i];
      const q = preview.trail[i - 1];
      const { x, y } = this.cellCenter(p.c, p.r);
      ctx.fillStyle = lost ? 'rgba(198,90,67,0.8)' : won ? 'rgba(238,183,93,0.9)' : 'rgba(238,229,207,0.55)';
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1.4, cell * 0.033), 0, Math.PI * 2);
      ctx.fill();
      if (i % 2 === 0 && (p.c !== q.c || p.r !== q.r)) {
        const a = Math.atan2(p.r - q.r, p.c - q.c);
        drawChevron(ctx, x, y, a, cell * 0.12, color, 1.1);
      }
    }
    const last = preview.trail[preview.trail.length - 1];
    if (lost) drawChevron(ctx, this.cellCenter(last.c, last.r).x, this.cellCenter(last.c, last.r).y, 0, cell * 0.2, 'rgba(198,90,67,0.9)', 2);
    ctx.restore();
  }

  drawStart(ctx, level, field, L, t) {
    const { x, y } = this.cellCenter(field.start.c, field.start.r);
    const cell = L.cell;
    ctx.save();
    ctx.strokeStyle = 'rgba(238,229,207,0.55)';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(x, y, cell * 0.3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, cell * 0.19, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(238,229,207,0.24)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // A little mooring post and pennant.
    ctx.fillStyle = 'rgba(226,209,170,0.8)';
    ctx.fillRect(x - cell * 0.025, y - cell * 0.32, cell * 0.05, cell * 0.64);
    ctx.fillStyle = 'rgba(198,90,67,0.82)';
    ctx.beginPath();
    ctx.moveTo(x + cell * 0.025, y - cell * 0.32);
    ctx.lineTo(x + cell * 0.28, y - cell * 0.24);
    ctx.lineTo(x + cell * 0.025, y - cell * 0.16);
    ctx.closePath();
    ctx.fill();
    ctx.font = `9px ${MONO}`;
    ctx.fillStyle = 'rgba(238,229,207,0.62)';
    ctx.textAlign = 'center';
    ctx.fillText('MOORING', x, y + cell * 0.44);
    ctx.restore();
  }

  drawDock(ctx, level, field, L, t, collected, view) {
    const { x, y } = this.cellCenter(field.dock.c, field.dock.r);
    const cell = L.cell;
    const ready = collected.size === level.lanterns.length;
    ctx.save();
    // jetty planks
    ctx.fillStyle = 'rgba(120,83,55,0.85)';
    for (let i = -2; i <= 2; i++) {
      roundRect(ctx, x + i * cell * 0.13 - cell * 0.045, y + cell * 0.03, cell * 0.09, cell * 0.3, 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(226,209,170,0.5)';
    ctx.fillRect(x - cell * 0.28, y + cell * 0.08, cell * 0.56, cell * 0.035);
    // lighthouse
    const towerW = cell * 0.18;
    const towerH = cell * 0.48;
    ctx.beginPath();
    ctx.moveTo(x - towerW * 0.5, y + cell * 0.02);
    ctx.lineTo(x - towerW * 0.36, y - towerH);
    ctx.lineTo(x + towerW * 0.36, y - towerH);
    ctx.lineTo(x + towerW * 0.5, y + cell * 0.02);
    ctx.closePath();
    ctx.fillStyle = '#e7ddc6';
    ctx.fill();
    ctx.strokeStyle = 'rgba(11,36,42,0.55)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = VERMILION;
    ctx.fillRect(x - towerW * 0.43, y - towerH * 0.62, towerW * 0.86, towerH * 0.16);
    ctx.fillRect(x - towerW * 0.47, y - towerH * 0.3, towerW * 0.94, towerH * 0.13);
    // lantern room
    ctx.fillStyle = ready ? GOLD : '#8d805f';
    roundRect(ctx, x - towerW * 0.34, y - towerH - cell * 0.11, towerW * 0.68, cell * 0.11, 1.5);
    ctx.fill();
    ctx.fillStyle = 'rgba(11,36,42,0.85)';
    ctx.beginPath();
    ctx.moveTo(x - towerW * 0.44, y - towerH - cell * 0.11);
    ctx.lineTo(x, y - towerH - cell * 0.21);
    ctx.lineTo(x + towerW * 0.44, y - towerH - cell * 0.11);
    ctx.closePath();
    ctx.fill();
    {
      const beam = ctx.createRadialGradient(x, y - towerH - cell * 0.06, 1, x, y - towerH - cell * 0.06, cell * (ready ? 0.82 : 0.5));
      beam.addColorStop(0, ready ? 'rgba(238,183,93,0.4)' : 'rgba(238,183,93,0.12)');
      beam.addColorStop(1, 'rgba(238,183,93,0)');
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.arc(x, y - towerH - cell * 0.06, cell * (ready ? 0.82 : 0.5), 0, Math.PI * 2);
      ctx.fill();
      const sweep = Math.sin(t * 0.8) * 0.55;
      ctx.fillStyle = ready ? 'rgba(238,183,93,0.15)' : 'rgba(238,183,93,0.06)';
      ctx.beginPath();
      ctx.moveTo(x, y - towerH - cell * 0.06);
      ctx.lineTo(x + Math.cos(-0.35 + sweep) * cell * 0.9, y - towerH - cell * 0.06 + Math.sin(-0.35 + sweep) * cell * 0.9);
      ctx.lineTo(x + Math.cos(0.05 + sweep) * cell * 0.9, y - towerH - cell * 0.06 + Math.sin(0.05 + sweep) * cell * 0.9);
      ctx.closePath();
      ctx.fill();
    }
    ctx.font = `9px ${MONO}`;
    ctx.fillStyle = 'rgba(238,229,207,0.62)';
    ctx.textAlign = 'center';
    ctx.fillText('HARBOR', x, y + cell * 0.45);
    ctx.restore();
  }

  drawLanterns(ctx, level, field, L, t, collected) {
    const cell = L.cell;
    for (const { c, r } of level.lanterns) {
      const { x, y } = this.cellCenter(c, r);
      const key = keyOf(c, r);
      const isIn = collected.has(key);
      const pulse = 0.82 + Math.sin(t * 2.2 + c * 0.9 + r * 1.3) * 0.18;
      ctx.save();
      if (!isIn) {
        ctx.globalCompositeOperation = 'lighter';
        const glow = ctx.createRadialGradient(x, y, 1, x, y, cell * 0.78 * pulse);
        glow.addColorStop(0, 'rgba(255,214,140,0.62)');
        glow.addColorStop(0.35, 'rgba(238,183,93,0.24)');
        glow.addColorStop(1, 'rgba(238,183,93,0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, cell * 0.78 * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
      // float ring
      ctx.beginPath();
      ctx.ellipse(x, y + cell * 0.12, cell * 0.22, cell * 0.075, 0, 0, Math.PI * 2);
      ctx.strokeStyle = isIn ? 'rgba(238,229,207,0.16)' : 'rgba(238,183,93,0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
      // post and lantern
      const lift = isIn ? cell * 0.02 : Math.sin(t * 1.6 + c) * cell * 0.018;
      ctx.strokeStyle = isIn ? 'rgba(238,229,207,0.22)' : 'rgba(226,209,170,0.82)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x - cell * 0.13, y + cell * 0.1);
      ctx.lineTo(x - cell * 0.13, y - cell * 0.25 + lift);
      ctx.stroke();
      ctx.fillStyle = isIn ? 'rgba(238,229,207,0.12)' : 'rgba(255,207,118,0.98)';
      roundRect(ctx, x - cell * 0.19, y - cell * 0.33 + lift, cell * 0.12, cell * 0.16, cell * 0.035);
      ctx.fill();
      if (!isIn) {
        ctx.strokeStyle = 'rgba(255,244,212,0.9)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,247,222,0.9)';
        ctx.beginPath();
        ctx.arc(x - cell * 0.13, y - cell * 0.25 + lift, cell * 0.022, 0, Math.PI * 2);
        ctx.fill();
      }
      if (isIn) {
        ctx.strokeStyle = 'rgba(238,229,207,0.2)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x - cell * 0.13, y - cell * 0.34 + lift);
        ctx.quadraticCurveTo(x - cell * 0.05, y - cell * 0.42, x, y - cell * 0.33);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  drawBuoys(ctx, level, view, L, t) {
    if (!view.buoys || view.buoys.size === 0) return;
    const cell = L.cell;
    for (const [key, dir] of view.buoys) {
      const [c, r] = key.split(',').map(Number);
      const { x, y } = this.cellCenter(c, r);
      const a = angleOf(dir);
      const focus = view.focus && view.focus.c === c && view.focus.r === r;
      const pulse = 1 + Math.sin(t * 3 + c + r) * 0.025;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(pulse, pulse);
      // buoy ring
      ctx.beginPath();
      ctx.arc(0, 0, cell * 0.29, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(238,229,207,0.14)';
      ctx.fill();
      ctx.strokeStyle = focus ? 'rgba(238,183,93,0.95)' : 'rgba(238,183,93,0.7)';
      ctx.lineWidth = Math.max(1.4, cell * 0.035);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, cell * 0.22, 0, Math.PI * 2);
      ctx.fillStyle = '#e6d9ba';
      ctx.fill();
      ctx.strokeStyle = 'rgba(11,36,42,0.5)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
      // direction needle
      ctx.rotate(a);
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.moveTo(cell * 0.115, 0);
      ctx.lineTo(-cell * 0.02, -cell * 0.1);
      ctx.lineTo(-cell * 0.02, -cell * 0.035);
      ctx.lineTo(-cell * 0.13, -cell * 0.035);
      ctx.lineTo(-cell * 0.13, cell * 0.035);
      ctx.lineTo(-cell * 0.02, cell * 0.035);
      ctx.lineTo(-cell * 0.02, cell * 0.1);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  drawWake(ctx, view, L, t) {
    const trajectory = view.voyage?.trail ?? view.trail ?? [];
    if (trajectory.length < 2) return;
    const cell = L.cell;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 1; i < trajectory.length; i++) {
      const p = trajectory[i];
      const q = trajectory[i - 1];
      const a = this.cellCenter(q.c, q.r);
      const b = this.cellCenter(p.c, p.r);
      const alpha = 0.05 + (i / trajectory.length) * 0.13;
      ctx.strokeStyle = `rgba(238,229,207,${alpha})`;
      ctx.lineWidth = Math.max(1, cell * 0.035);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    for (let i = 1; i < trajectory.length; i++) {
      const p = trajectory[i];
      const { x, y } = this.cellCenter(p.c, p.r);
      const h = hash(p.c, p.r, 51);
      if (h < 0.45) continue;
      ctx.strokeStyle = `rgba(238,229,207,${0.08 + h * 0.08})`;
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.arc(x + (h - 0.5) * cell * 0.25, y + (h - 0.5) * cell * 0.2, cell * 0.06, 0.2, 2.8);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawBoat(ctx, level, view, L, t) {
    const motion = view.motion;
    const cell = L.cell;
    let c = level.start.c;
    let r = level.start.r;
    let heading = level.start.heading;
    let turn = 0;
    let bob = Math.sin(t * 2.1) * cell * 0.012;
    if (motion) {
      const p = ease(clamp(motion.t, 0, 1));
      c = lerp(motion.from.c, motion.to.c, p);
      r = lerp(motion.from.r, motion.to.r, p);
      heading = motion.heading;
      turn = shortestTurn(angleOf(motion.headingFrom), angleOf(motion.headingTo)) * p;
    } else if (view.voyage) {
      c = view.voyage.pos.c;
      r = view.voyage.pos.r;
      heading = view.voyage.heading;
    }
    const x = L.ox + (c + 0.5) * cell + Math.cos(angleOf(heading) + Math.PI / 2) * bob;
    const y = L.oy + (r + 0.5) * cell + Math.sin(angleOf(heading) + Math.PI / 2) * bob;
    const angle = angleOf(heading) + turn;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    // hull shadow
    ctx.fillStyle = 'rgba(3,20,24,0.32)';
    ctx.beginPath();
    ctx.ellipse(-cell * 0.02, cell * 0.08, cell * 0.42, cell * 0.17, 0, 0, Math.PI * 2);
    ctx.fill();
    // hull
    ctx.beginPath();
    ctx.moveTo(cell * 0.44, 0);
    ctx.quadraticCurveTo(cell * 0.2, -cell * 0.2, -cell * 0.06, -cell * 0.18);
    ctx.lineTo(-cell * 0.36, -cell * 0.13);
    ctx.quadraticCurveTo(-cell * 0.42, 0, -cell * 0.36, cell * 0.13);
    ctx.lineTo(-cell * 0.06, cell * 0.18);
    ctx.quadraticCurveTo(cell * 0.2, cell * 0.2, cell * 0.44, 0);
    ctx.closePath();
    const hull = ctx.createLinearGradient(0, -cell * 0.2, 0, cell * 0.2);
    hull.addColorStop(0, '#1c353d');
    hull.addColorStop(1, '#0c252c');
    ctx.fillStyle = hull;
    ctx.fill();
    ctx.strokeStyle = 'rgba(246,236,212,0.85)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // deck line
    ctx.strokeStyle = 'rgba(238,229,207,0.25)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-cell * 0.28, 0);
    ctx.lineTo(cell * 0.24, 0);
    ctx.stroke();
    // sail, a cream curve leaning off the mast
    ctx.beginPath();
    ctx.moveTo(cell * 0.02, -cell * 0.02);
    ctx.quadraticCurveTo(-cell * 0.08, -cell * 0.36, -cell * 0.3, -cell * 0.25);
    ctx.quadraticCurveTo(-cell * 0.18, -cell * 0.1, -cell * 0.2, cell * 0.01);
    ctx.closePath();
    ctx.fillStyle = 'rgba(238,229,207,0.92)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(11,36,42,0.35)';
    ctx.lineWidth = 0.7;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cell * 0.02, -cell * 0.02);
    ctx.lineTo(cell * 0.02, -cell * 0.38);
    ctx.strokeStyle = 'rgba(238,229,207,0.55)';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cell * 0.02, -cell * 0.04, cell * 0.035, 0, Math.PI * 2);
    ctx.fillStyle = GOLD;
    ctx.fill();
    // bow lantern
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const glow = ctx.createRadialGradient(cell * 0.38, 0, 0.4, cell * 0.38, 0, cell * 0.3);
    glow.addColorStop(0, 'rgba(238,183,93,0.42)');
    glow.addColorStop(1, 'rgba(238,183,93,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cell * 0.38, 0, cell * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(cell * 0.38, 0, cell * 0.045, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd58a';
    ctx.fill();
    ctx.restore();
  }

  drawFocus(ctx, level, view, L, t) {
    if (view.screen === 'title') return;
    const cell = L.cell;
    if (view.hover && view.screen === 'planning') {
      const { x, y } = this.cellCenter(view.hover.c, view.hover.r);
      ctx.fillStyle = 'rgba(238,229,207,0.05)';
      ctx.fillRect(x - cell / 2, y - cell / 2, cell, cell);
    }
    if (!view.focus) return;
    const { x, y } = this.cellCenter(view.focus.c, view.focus.r);
    const a = 0.62 + Math.sin(t * 3) * 0.15;
    ctx.save();
    ctx.strokeStyle = `rgba(238,183,93,${a})`;
    ctx.lineWidth = 1.4;
    ctx.setLineDash([3, 4]);
    ctx.strokeRect(x - cell * 0.46, y - cell * 0.46, cell * 0.92, cell * 0.92);
    ctx.setLineDash([]);
    const s = cell * 0.14;
    ctx.strokeStyle = 'rgba(238,183,93,0.9)';
    ctx.lineWidth = 1.6;
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      ctx.beginPath();
      ctx.moveTo(x + dx * cell * 0.46, y + dy * cell * 0.46 - dy * s);
      ctx.lineTo(x + dx * cell * 0.46, y + dy * cell * 0.46);
      ctx.lineTo(x + dx * cell * 0.46 - dx * s, y + dy * cell * 0.46);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawCartouche(ctx, level, view) {
    const x = 42;
    const y = 50;
    ctx.save();
    ctx.font = `10px ${MONO}`;
    ctx.letterSpacing = '0.18em';
    ctx.fillStyle = 'rgba(238,229,207,0.58)';
    ctx.textAlign = 'left';
    const label = view.screen === 'title' ? 'THE MOONLIT ARCHIPELAGO' : `CHART ${level.number}  ·  ${level.name.toUpperCase()}`;
    ctx.fillText(label, x, y);
    ctx.strokeStyle = 'rgba(238,229,207,0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y + 9);
    ctx.lineTo(x + Math.min(320, ctx.measureText(label).width + 42), y + 9);
    ctx.stroke();
    ctx.fillStyle = 'rgba(238,183,93,0.72)';
    ctx.beginPath();
    ctx.arc(x + Math.min(320, ctx.measureText(label).width + 50), y + 9, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawStatus(ctx, view) {
    const label =
      view.screen === 'title' ? 'A CHART-PUZZLE' :
      view.screen === 'won' ? 'ALL LANTERNS ABLAZE' :
      view.screen === 'lost' ? 'VOYAGE ENDED' :
      view.paused ? 'PAUSED · P TO RESUME' :
      view.screen === 'sailing' ? `SAILING · ${view.voyage?.steps ?? 0} MOVES` :
      `PLANNING · ${view.buoys?.size ?? 0}/${view.level.buoys} BUOYS`;
    ctx.save();
    ctx.font = `10px ${MONO}`;
    ctx.letterSpacing = '0.13em';
    const w = ctx.measureText(label).width + 28;
    const x = this.w - 42 - w;
    const y = 38;
    const accent = view.screen === 'lost' ? 'rgba(198,90,67,0.65)' : view.screen === 'won' ? 'rgba(238,183,93,0.7)' : 'rgba(238,229,207,0.26)';
    roundRect(ctx, x, y, w, 24, 12);
    ctx.fillStyle = 'rgba(8,32,38,0.55)';
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = view.screen === 'lost' ? 'rgba(230,170,130,0.9)' : view.screen === 'won' ? 'rgba(255,220,156,0.95)' : 'rgba(238,229,207,0.72)';
    ctx.textAlign = 'center';
    ctx.fillText(label, x + w / 2, y + 16);
    ctx.restore();
  }

  drawCompass(ctx, t) {
    const x = 54;
    const y = this.h - 58;
    const r = Math.min(30, this.h * 0.05);
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = 'rgba(238,229,207,0.42)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.72, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(238,229,207,0.26)';
    ctx.stroke();
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI / 4) * i - Math.PI / 2;
      const len = i % 2 === 0 ? r * 0.94 : r * 0.56;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 0.16, Math.sin(a) * r * 0.16);
      ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
      ctx.strokeStyle = i % 2 === 0 ? 'rgba(238,229,207,0.78)' : 'rgba(238,229,207,0.42)';
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(238,183,93,0.9)';
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.82);
    ctx.lineTo(r * 0.12, 0);
    ctx.lineTo(-r * 0.12, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(238,229,207,0.78)';
    ctx.font = `9px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.fillText('N', 0, -r * 1.28);
    ctx.fillText('E', r * 1.25, 3);
    ctx.fillText('S', 0, r * 1.38);
    ctx.fillText('W', -r * 1.25, 3);
    ctx.restore();
  }

  drawScale(ctx, L) {
    const x = this.w - 154;
    const y = this.h - 46;
    ctx.save();
    ctx.strokeStyle = 'rgba(238,229,207,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 84, y);
    ctx.stroke();
    for (let i = 0; i <= 3; i++) {
      ctx.beginPath();
      ctx.moveTo(x + i * 28, y - (i % 3 === 0 ? 5 : 3));
      ctx.lineTo(x + i * 28, y + 3);
      ctx.stroke();
    }
    ctx.font = `9px ${MONO}`;
    ctx.fillStyle = 'rgba(238,229,207,0.66)';
    ctx.textAlign = 'right';
    ctx.fillText('CHART SCALE', x + 84, y - 10);
    ctx.restore();
  }

  updateAndDrawParticles(ctx, dt) {
    if (this.particles.length > 0) {
      this.particles = this.particles.filter((p) => {
        p.life += dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.96;
        p.vy = p.kind === 'foam' ? p.vy - 6 * dt : p.vy + 85 * dt;
        if (p.life >= p.max) return false;
        const a = 1 - p.life / p.max;
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.5 + a * 0.7), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        return true;
      });
    }
    if (this.confetti.length > 0) {
      this.confetti = this.confetti.filter((p) => {
        p.life += dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 95 * dt;
        p.vx *= 0.995;
        p.rot += p.vr * dt;
        if (p.life >= p.max || p.y > this.h + 20) return false;
        const a = Math.min(1, (p.max - p.life) * 1.6);
        ctx.save();
        ctx.globalAlpha = a;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
        return true;
      });
    }
    ctx.globalAlpha = 1;
  }

  drawFlash(ctx, now) {
    if (this.flash.color && now < this.flash.until) {
      const left = (this.flash.until - now) / 420;
      const g = ctx.createRadialGradient(this.w * 0.5, this.h * 0.5, this.h * 0.2, this.w * 0.5, this.h * 0.5, Math.max(this.w, this.h) * 0.7);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, this.flash.color.replace(/[\d.]+\)$/, `${0.34 * left})`));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.w, this.h);
    }
  }
}

/** The little progress map in the paper log. It is a secondary view, never the only one. */
export function drawMinimap(canvas, level, view) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(80, rect.width);
  const h = Math.max(54, rect.height);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(12,42,49,0.92)';
  roundRect(ctx, 0, 0, w, h, 4);
  ctx.fill();
  ctx.strokeStyle = 'rgba(238,229,207,0.14)';
  ctx.lineWidth = 1;
  roundRect(ctx, 0.5, 0.5, w - 1, h - 1, 4);
  ctx.stroke();
  const cell = Math.min((w - 12) / level.w, (h - 12) / level.h);
  const ox = (w - cell * level.w) / 2;
  const oy = (h - cell * level.h) / 2;
  const cx = (c) => ox + (c + 0.5) * cell;
  const cy = (r) => oy + (r + 0.5) * cell;
  const field = prepareLevel(level);
  for (const [c, r] of level.land) {
    ctx.fillStyle = 'rgba(63,95,75,0.85)';
    ctx.fillRect(ox + c * cell, oy + r * cell, cell, cell);
  }
  for (const [c, r] of level.reef) {
    ctx.fillStyle = 'rgba(160,66,52,0.6)';
    ctx.fillRect(ox + c * cell, oy + r * cell, cell, cell);
  }
  ctx.strokeStyle = 'rgba(238,229,207,0.07)';
  ctx.lineWidth = 0.5;
  for (let c = 1; c < level.w; c++) {
    ctx.beginPath();
    ctx.moveTo(ox + c * cell, oy);
    ctx.lineTo(ox + c * cell, oy + cell * level.h);
    ctx.stroke();
  }
  for (let r = 1; r < level.h; r++) {
    ctx.beginPath();
    ctx.moveTo(ox, oy + r * cell);
    ctx.lineTo(ox + cell * level.w, oy + r * cell);
    ctx.stroke();
  }
  const collected = view.collected ?? new Set();
  for (const { c, r } of level.lanterns) {
    ctx.beginPath();
    ctx.arc(cx(c), cy(r), Math.max(1.8, cell * 0.14), 0, Math.PI * 2);
    ctx.fillStyle = collected.has(keyOf(c, r)) ? 'rgba(238,229,207,0.18)' : GOLD;
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(238,183,93,0.9)';
  ctx.fillRect(cx(field.dock.c) - cell * 0.2, cy(field.dock.r) - cell * 0.2, cell * 0.4, cell * 0.4);
  for (const [key] of view.buoys ?? []) {
    const [c, r] = key.split(',').map(Number);
    ctx.fillStyle = 'rgba(238,229,207,0.8)';
    ctx.fillRect(cx(c) - cell * 0.12, cy(r) - cell * 0.12, cell * 0.24, cell * 0.24);
  }
  let boat = view.voyage?.pos ?? { c: level.start.c, r: level.start.r };
  if (view.motion) {
    const p = ease(Math.min(1, Math.max(0, view.motion.t)));
    boat = { c: lerp(view.motion.from.c, view.motion.to.c, p), r: lerp(view.motion.from.r, view.motion.to.r, p) };
  }
  ctx.beginPath();
  ctx.arc(cx(boat.c), cy(boat.r), Math.max(2, cell * 0.17), 0, Math.PI * 2);
  ctx.fillStyle = IVORY;
  ctx.fill();
  ctx.strokeStyle = VERMILION;
  ctx.lineWidth = 1;
  ctx.stroke();
}
