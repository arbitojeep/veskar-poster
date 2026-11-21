// VESKAR — a travel poster for a place that isn't there.
// A floating island above a sea of clouds at golden hour.
// Pure Node 22 stdlib: renders 1024x1024 RGB into a buffer and writes
// its own PNG (zlib + hand-rolled CRC32). Fully deterministic: every
// scattered detail comes from a fixed-seed PRNG, so two runs produce
// byte-identical output. No network, no fonts, no external files.
// The only text in the picture is the place name, VESKAR, drawn as
// procedural geometric letterforms (only these six glyphs exist).
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const W = 1024;
const H = 1024;
const buf = new Float32Array(W * H * 3);

// ---------- deterministic PRNG (mulberry32, fixed seed) ----------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261121);

// ---------- colour helpers ----------
type RGB = [number, number, number];
const clamp = (v: number, lo = 0, hi = 255) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const sstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const mix3 = (c1: RGB, c2: RGB, t: number): RGB => [
  lerp(c1[0], c2[0], t),
  lerp(c1[1], c2[1], t),
  lerp(c1[2], c2[2], t),
];
const hex = (s: string): RGB => [
  parseInt(s.slice(1, 3), 16),
  parseInt(s.slice(3, 5), 16),
  parseInt(s.slice(5, 7), 16),
];

const INDIGO = hex('#1B2340');
const VIOLET = hex('#4B3566');
const ROSE = hex('#C65E6B');
const EMBER = hex('#E8806D');
const AMBER = hex('#F6B352');
const GOLD = hex('#F9D27A');
const CREAM = hex('#FFF3D6');
const TEAL = hex('#1F4E5F');
const CLOUD_SHADOW = hex('#7D8FB0');

// Blend colour c with alpha a over pixel (x, y).
function blend(x: number, y: number, c: RGB, a: number) {
  if (a <= 0 || x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  if (a >= 1) {
    buf[i] = c[0];
    buf[i + 1] = c[1];
    buf[i + 2] = c[2];
    return;
  }
  buf[i] = buf[i] * (1 - a) + c[0] * a;
  buf[i + 1] = buf[i + 1] * (1 - a) + c[1] * a;
  buf[i + 2] = buf[i + 2] * (1 - a) + c[2] * a;
}
function setPx(x: number, y: number, c: RGB) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  buf[i] = c[0];
  buf[i + 1] = c[1];
  buf[i + 2] = c[2];
}

// Axis-aligned rect with ~1.2px soft edge.
function rect(x0: number, y0: number, x1: number, y1: number, c: RGB, a = 1) {
  const xa = Math.max(0, Math.floor(x0) - 2);
  const xb = Math.min(W - 1, Math.ceil(x1) + 2);
  const ya = Math.max(0, Math.floor(y0) - 2);
  const yb = Math.min(H - 1, Math.ceil(y1) + 2);
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) {
      const dx = Math.max(x0 - x - 0.5, x + 0.5 - x1, 0);
      const dy = Math.max(y0 - y - 0.5, y + 0.5 - y1, 0);
      const d = Math.max(dx, dy);
      const cov = d <= 0 ? 1 : 1 - clamp(d / 1.2, 0, 1);
      if (cov > 0) blend(x, y, c, a * cov);
    }
  }
}

function distToSeg(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = x1 + t * dx;
  const qy = y1 + t * dy;
  return Math.hypot(px - qx, py - qy);
}
function insidePoly(px: number, py: number, pts: number[][]) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0];
    const yi = pts[i][1];
    const xj = pts[j][0];
    const yj = pts[j][1];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// Filled polygon with soft edge.
function poly(pts: number[][], c: RGB, a = 1) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  const xa = Math.max(0, Math.floor(x0) - 2);
  const xb = Math.min(W - 1, Math.ceil(x1) + 2);
  const ya = Math.max(0, Math.floor(y0) - 2);
  const yb = Math.min(H - 1, Math.ceil(y1) + 2);
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const inside = insidePoly(px, py, pts);
      let d = Infinity;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const dd = distToSeg(px, py, pts[j][0], pts[j][1], pts[i][0], pts[i][1]);
        if (dd < d) d = dd;
      }
      let cov: number;
      if (inside) cov = d >= 1.4 ? 1 : 0.55 + 0.45 * (d / 1.4);
      else cov = d >= 1.4 ? 0 : 0.45 * (1 - d / 1.4);
      if (cov > 0) blend(x, y, c, a * cov);
    }
  }
}
// Soft ellipse: alpha falls off as a gaussian in normalised radius.
function ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB, a: number, tight = 2.0) {
  const xa = Math.max(0, Math.floor(cx - rx) - 2);
  const xb = Math.min(W - 1, Math.ceil(cx + rx) + 2);
  const ya = Math.max(0, Math.floor(cy - ry) - 2);
  const yb = Math.min(H - 1, Math.ceil(cy + ry) + 2);
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) {
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      const d2 = nx * nx + ny * ny;
      if (d2 > 4) continue;
      const cov = Math.exp(-d2 * tight);
      if (cov > 0.004) blend(x, y, c, a * cov);
    }
  }
}
// Crisp disc with soft edge.
function disc(cx: number, cy: number, r: number, c: RGB, a = 1) {
  const xa = Math.max(0, Math.floor(cx - r) - 2);
  const xb = Math.min(W - 1, Math.ceil(cx + r) + 2);
  const ya = Math.max(0, Math.floor(cy - r) - 2);
  const yb = Math.min(H - 1, Math.ceil(cy + r) + 2);
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const cov = 1 - sstep(r - 1.6, r + 0.4, d);
      if (cov > 0) blend(x, y, c, a * cov);
    }
  }
}
// Thick line as a chain of small discs.
function thickLine(x1: number, y1: number, x2: number, y2: number, w: number, c: RGB, a = 1) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.max(1, Math.ceil(len / 2));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    disc(lerp(x1, x2, t), lerp(y1, y2, t), w / 2, c, a);
  }
}

// ---------- 1. frame ----------
rect(0, 0, W, H, CREAM, 1);
const SC = 34; // scene inset
const SE = 990; // scene edge (exclusive-ish)

// ---------- 2. sky gradient ----------
const SKY_STOPS: [number, RGB][] = [
  [0.0, INDIGO],
  [0.26, VIOLET],
  [0.46, ROSE],
  [0.6, EMBER],
  [0.72, AMBER],
  [0.82, GOLD],
];
function skyAt(y: number): RGB {
  const t = clamp((y - SC) / (SE - SC), 0, 1);
  for (let s = 0; s < SKY_STOPS.length - 1; s++) {
    const [t0, c0] = SKY_STOPS[s];
    const [t1, c1] = SKY_STOPS[s + 1];
    if (t >= t0 && t <= t1) return mix3(c0, c1, (t - t0) / (t1 - t0));
  }
  return GOLD;
}
for (let y = SC; y < SE; y++) {
  const c = skyAt(y);
  for (let x = SC; x < SE; x++) setPx(x, y, c);
}

// faint stars in the upper sky
for (let i = 0; i < 70; i++) {
  const x = SC + 8 + rnd() * (SE - SC - 16);
  const y = SC + 8 + rnd() * 210;
  const r = 0.8 + rnd() * 1.1;
  disc(x, y, r, CREAM, 0.25 + rnd() * 0.5);
}

// ---------- 3. sun, low on the right, setting over the cloud sea ----------
const SUN: [number, number] = [888, 580];
ellipse(SUN[0], SUN[1], 320, 320, AMBER, 0.6, 3.0);
ellipse(SUN[0], SUN[1], 190, 190, GOLD, 0.65, 2.4);
disc(SUN[0], SUN[1], 72, hex('#FFC46B'), 1);
disc(SUN[0], SUN[1], 58, hex('#FFE9A8'), 1);
disc(SUN[0], SUN[1], 44, hex('#FFF6DC'), 0.95);
// warm glow washed across the clouds under the sun
ellipse(880, 660, 260, 60, GOLD, 0.35, 2.2);

// ---------- 4. cloud sea: a smooth value-noise field ----------
// The old version stacked a few flat-topped gaussian ellipses, and the
// seams between their plateaus read as chunky square blocks. Instead,
// the whole sea is one continuous density field: hash-based value noise
// in three octaves, so the billows roll into each other with no seams,
// no plateaus and no rectangular edges anywhere.
function hash2(ix: number, iy: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 974634211)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x: number, y: number, cell: number, seed: number): number {
  const gx = x / cell;
  const gy = y / cell;
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  const fx = gx - ix;
  const fy = gy - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
}
function cloudDensity(x: number, y: number): number {
  const n1 = vnoise(x, y, 150, 11);
  const n2 = vnoise(x + 40, y + 90, 68, 23);
  const n3 = vnoise(x + 130, y + 40, 30, 37);
  return clamp(0.55 * n1 + 0.3 * n2 + 0.15 * n3, 0, 1);
}
const CLOUD_LIT_TOP = hex('#FFE9C4');
const CLOUD_LIT_MID = hex('#F7C9A0');
const CLOUD_LIT_LOW = hex('#E3B7CE');
const CLOUD_SHADOW_TOP = hex('#B9A8CF');
const CLOUD_SHADOW_LOW = hex('#6F6A9E');
for (let y = 628; y < SE; y++) {
  const t = (y - 628) / (SE - 628);
  for (let x = SC; x < SE; x++) {
    // wavy top edge: the horizon where cloud meets sky rolls up and
    // down along the width, instead of sitting on one straight line
    const topY = 630 + 46 * vnoise(x, 0, 130, 71);
    const topFade = sstep(topY, topY + 48, y); // billowy top edge: only dense puffs show at the horizon
    const d = cloudDensity(x, y);
    const lit = mix3(mix3(CLOUD_LIT_TOP, CLOUD_LIT_MID, sstep(0, 0.5, t)), CLOUD_LIT_LOW, sstep(0.5, 1, t));
    const shadow = mix3(CLOUD_SHADOW_TOP, CLOUD_SHADOW_LOW, sstep(0, 1, t));
    let c = mix3(shadow, lit, sstep(0.3, 0.78, d));
    // warm tint near the low sun, on the brightest puffs only
    const sunWarm = Math.exp(-((x - 888) * (x - 888)) / (2 * 320 * 320) - ((y - 640) * (y - 640)) / (2 * 210 * 210));
    c = mix3(c, GOLD, sunWarm * 0.28 * sstep(0.42, 0.8, d));
    const a = topFade * (0.35 + 0.65 * sstep(0.28, 0.7, d));
    blend(x, y, c, a);
  }
}
// a few thin, very soft mist wisps drifting over the sea
ellipse(300, 700, 260, 24, hex('#FFF3D6'), 0.16, 2.6);
ellipse(700, 830, 300, 28, hex('#F7C9A0'), 0.13, 2.6);
ellipse(250, 905, 280, 32, hex('#D9B8D4'), 0.14, 2.6);

// ---------- 5. the floating island (the one landmark) ----------
const CLIFF: number[][] = [
  [170, 472],
  [860, 472],
  [815, 545],
  [720, 625],
  [610, 705],
  [520, 748],
  [455, 690],
  [350, 610],
  [235, 545],
];
// rocky underside: painted per pixel inside the cliff polygon, so the
// rock carries a vertical gradient, wavy strata, fine grain and warm
// rim light — not one flat triangle with straight lines.
function cliffEdge(y: number): [number, number] {
  let left: number;
  let right: number;
  if (y < 545) {
    const t = (y - 472) / 73;
    left = lerp(170, 235, t);
    right = lerp(860, 815, t);
  } else {
    if (y < 610) left = lerp(235, 350, (y - 545) / 65);
    else if (y < 690) left = lerp(350, 455, (y - 610) / 80);
    else left = lerp(455, 520, (y - 690) / 58);
    if (y < 625) right = lerp(815, 720, (y - 545) / 80);
    else if (y < 705) right = lerp(720, 610, (y - 625) / 80);
    else right = lerp(610, 520, (y - 705) / 43);
  }
  return [left, right];
}
for (let y = 472; y <= 748; y++) {
  const t = (y - 472) / 276;
  const [left, right] = cliffEdge(y);
  const base = mix3(
    mix3(hex('#8A5A44'), hex('#5B3A4C'), sstep(0, 0.5, t)),
    hex('#2E2138'),
    sstep(0.5, 1, t),
  );
  const xa = Math.max(SC, Math.floor(left));
  const xb = Math.min(SE - 1, Math.ceil(right));
  for (let x = xa; x <= xb; x++) {
    // fine rock grain
    const grain = vnoise(x, y, 14, 51) - 0.5;
    // wavy strata: bands that sag slightly toward the middle of the cliff
    const s = y + 7 * Math.sin(x * 0.011 + 1.3) + 5 * (vnoise(x, y, 90, 61) - 0.5);
    const band = ((s % 58) + 58) % 58;
    const strata = band < 7 ? 0.8 : band < 12 ? 1.08 : 1.0;
    let r = base[0] * (1 + grain * 0.18) * strata;
    let g = base[1] * (1 + grain * 0.18) * strata;
    let b = base[2] * (1 + grain * 0.18) * strata;
    // sunlit band just under the meadow
    const topGlow = Math.exp(-(y - 472) / 20);
    r = lerp(r, 168, topGlow * 0.35);
    g = lerp(g, 118, topGlow * 0.35);
    b = lerp(b, 79, topGlow * 0.35);
    // warm rim light: strongest on the sun (right) edge, a softer
    // bounce on the left edge from the lit clouds below
    const rimR = Math.exp(-(right - x) / 7) * 0.55;
    const rimL = Math.exp(-(x - left) / 9) * 0.3;
    const rim = Math.max(rimR, rimL);
    r = lerp(r, 246, rim * 0.5);
    g = lerp(g, 179, rim * 0.5);
    b = lerp(b, 82, rim * 0.5);
    setPx(x, y, [r, g, b]);
  }
}
// (no jutting ledges: the first attempt read as stray black diamonds
// floating off the cliff, so the strata and gradient carry the depth)
// meadow cap: a deep, bright grassy dome painted OVER the cliff top,
// so the island reads as land, not a bare rock wedge
ellipse(515, 478, 352, 42, hex('#8A9A4B'), 1, 1.6);
ellipse(515, 472, 330, 30, hex('#A8A854'), 0.9, 1.8);
ellipse(300, 466, 150, 18, hex('#C9B06A'), 0.5, 2.0);
ellipse(515, 512, 340, 14, hex('#5A6E33'), 0.55, 1.8); // soil shadow under the grass
// tiny wildflowers on the meadow
const FLOWERS: [number, number, string][] = [[380, 478, '#FFF3D6'], [470, 472, '#F6B352'], [600, 476, '#FFF3D6'], [700, 470, '#E8806D'], [250, 476, '#F6B352']];
for (const [fx, fy, fc] of FLOWERS) {
  disc(fx, fy, 3, hex(fc), 0.9);
}
// pine silhouettes on the meadow
function pine(x: number, base: number, h: number, c: RGB) {
  poly([[x - h * 0.32, base], [x + h * 0.32, base], [x, base - h]], c, 1);
  rect(x - 2, base - 2, x + 2, base + 4, hex('#3A2A22'), 1);
}
pine(258, 472, 52, hex('#2E4A2F'));
pine(330, 470, 40, hex('#243D28'));
pine(618, 470, 46, hex('#2E4A2F'));
pine(688, 471, 34, hex('#243D28'));
// round bushes
disc(430, 466, 12, hex('#5A7A3A'), 1);
disc(560, 464, 14, hex('#5A7A3A'), 1);

// lighthouse on the island's right edge: one slender white tower
poly([[766, 472], [794, 472], [789, 388], [771, 388]], hex('#FFF6DC'), 1);
rect(768, 420, 792, 428, hex('#C65E6B'), 0.9);
rect(770, 372, 790, 388, hex('#2A2233'), 1);
poly([[768, 372], [792, 372], [780, 356]], hex('#C65E6B'), 1);
disc(780, 380, 7, hex('#FFE9A8'), 1);
ellipse(780, 380, 42, 26, GOLD, 0.55, 2.4);

// ---------- 6. waterfall off the island's left edge ----------
// A ribbon that pours from a lip pool in the meadow, curves gently
// outward as it falls, tapers, and dissolves into spray where it meets
// the cloud sea — never a straight plank.
function fallPath(y: number): { cx: number; w: number } {
  const t = clamp((y - 468) / 232, 0, 1);
  const cx = 224 - 30 * t + 6 * Math.sin(t * 9.0);
  const w = 13 - 4 * t;
  return { cx, w };
}
// lip pool where the water leaves the meadow
ellipse(222, 470, 22, 10, hex('#FDF6E3'), 0.95, 2.0);
for (let y = 468; y <= 700; y += 2) {
  const t = clamp((y - 468) / 232, 0, 1);
  const { cx, w } = fallPath(y);
  const fade = t < 0.72 ? 1 : 1 - ((t - 0.72) / 0.28) * 0.75;
  disc(cx, y, w, hex('#EAF2F8'), 0.55 * fade); // soft outer sheet
  disc(cx - 1, y, w * 0.62, hex('#FDF6E3'), 0.95 * fade); // bright core
  disc(cx + 2, y, w * 0.3, hex('#FFFFFF'), 0.75 * fade); // sparkle thread
  disc(cx + w * 0.55, y, w * 0.22, hex('#9FB4D8'), 0.35 * fade); // cool edge thread
}
// faint secondary thread: a thin companion trickle running parallel
// to the main fall, offset just outside it so it hangs in the air
// left of the cliff instead of crossing the rock face
for (let y = 472; y <= 660; y += 3) {
  const t = clamp((y - 468) / 232, 0, 1);
  const { cx } = fallPath(y);
  disc(cx + 21, y, 3, hex('#FDF6E3'), 0.45 * (1 - t * 0.6));
}
// spray where the fall meets the cloud sea
ellipse(196, 706, 70, 22, hex('#FFF3D6'), 0.7, 2.4);
ellipse(210, 716, 46, 16, hex('#FFFFFF'), 0.6, 2.4);
ellipse(182, 716, 34, 12, hex('#F7C9A0'), 0.5, 2.4);

// ---------- 7. foreground mist ----------
// The noise field already is the cloud sea; a few low, very soft drifts
// in front of it add depth without re-introducing blocky clusters.
ellipse(520, 762, 150, 30, hex('#FFE9C4'), 0.6, 2.4); // low drift kissing the island's point
ellipse(180, 830, 220, 30, hex('#F7C9A0'), 0.25, 2.6);
ellipse(820, 900, 240, 34, hex('#D9B8D4'), 0.22, 2.6);

// ---------- 8. birds ----------
// each bird: two short strokes meeting at the body
function bird(x: number, y: number, s: number) {
  thickLine(x - 15 * s, y + 4 * s, x, y - 5 * s, 3.4, hex('#241A2E'), 0.9);
  thickLine(x, y - 5 * s, x + 15 * s, y + 4 * s, 3.4, hex('#241A2E'), 0.9);
}
bird(300, 305, 1);
bird(368, 278, 0.8);
bird(700, 318, 0.9);
bird(772, 292, 0.7);
bird(622, 258, 0.75);
bird(430, 340, 0.6);

// ---------- 9. the name: VESKAR, the only text in the picture ----------
// Geometric letterforms on a 104 x 150 grid, stroke 24. Each glyph is a
// list of rects [x, y, w, h] and polygons (list of points).
type Glyph = { rects: number[][]; polys: number[][][]; strokes: { pts: number[][]; w: number }[] };
const GLYPHS: Record<string, Glyph> = {
  V: {
    rects: [],
    polys: [[[0, 0], [26, 0], [52, 108], [78, 0], [104, 0], [64, 150], [40, 150]]],
    strokes: [],
  },
  E: {
    rects: [
      [0, 0, 26, 150],
      [0, 0, 104, 24],
      [0, 63, 80, 24],
      [0, 126, 104, 24],
    ],
    polys: [],
    strokes: [],
  },
  S: {
    // a smooth ribbon S: unmistakable at any size, unlike the blocky one
    // whose full-width middle bar read as a "2" at thumbnail scale
    rects: [],
    polys: [],
    strokes: [
      {
        w: 24,
        pts: [
          [88, 14],
          [44, 12],
          [20, 26],
          [14, 50],
          [28, 66],
          [72, 80],
          [88, 96],
          [86, 118],
          [62, 136],
          [18, 136],
        ],
      },
    ],
  },
  K: {
    rects: [[0, 0, 26, 150]],
    polys: [
      [[26, 58], [104, 2], [104, 28], [26, 84]],
      [[26, 84], [104, 124], [104, 150], [26, 110]],
    ],
    strokes: [],
  },
  A: {
    rects: [[20, 98, 64, 22]],
    polys: [[[52, 0], [104, 150], [78, 150], [52, 66], [26, 150], [0, 150]]],
    strokes: [],
  },
  R: {
    rects: [
      [0, 0, 26, 150],
      [0, 0, 104, 24],
      [80, 0, 24, 87],
      [0, 63, 104, 24],
    ],
    polys: [[[38, 84], [104, 150], [78, 150], [22, 102]]],
    strokes: [],
  },
};
function drawWord(word: string, ox: number, oy: number, c: RGB, a: number) {
  const ADV = 130;
  for (let gi = 0; gi < word.length; gi++) {
    const g = GLYPHS[word[gi]];
    const gx = ox + gi * ADV;
    for (const [rx, ry, rw, rh] of g.rects) rect(gx + rx, oy + ry, gx + rx + rw, oy + ry + rh, c, a);
    for (const p of g.polys) poly(p.map(([px, py]) => [gx + px, oy + py]), c, a);
    for (const s of g.strokes) {
      for (let i = 0; i + 1 < s.pts.length; i++) {
        thickLine(gx + s.pts[i][0], oy + s.pts[i][1], gx + s.pts[i + 1][0], oy + s.pts[i + 1][1], s.w, c, a);
      }
    }
  }
}
const WORD = 'VESKAR';
const WORD_W = 6 * 104 + 5 * 26;
const WORD_X = Math.round((W - WORD_W) / 2);
const WORD_Y = 92;
// warm gold offset shadow, then cream face
drawWord(WORD, WORD_X + 7, WORD_Y + 7, hex('#D98A2B'), 0.85);
drawWord(WORD, WORD_X, WORD_Y, CREAM, 1);
// a small gold rule and diamond under the name
rect(352, 268, 672, 272, GOLD, 0.9);
poly([[512, 258], [524, 270], [512, 282], [500, 270]], GOLD, 1);

// ---------- 10. frame rules ----------
rect(SC - 4, SC - 4, SE + 4, SC - 1, TEAL, 1);
rect(SC - 4, SE - 3, SE + 4, SE, TEAL, 1);
rect(SC - 4, SC - 4, SC - 1, SE, TEAL, 1);
rect(SE + 1, SC - 4, SE + 4, SE, TEAL, 1);

// ---------- PNG encoder (RGB, 8-bit, per-row best filter) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
// ---------- PNG encoder (RGB, 8-bit, per-row best filter) ----------
function encodePNG(): Buffer {
  const raw = Buffer.alloc(H * (1 + W * 3));
  const prev = Buffer.alloc(W * 3);
  const row = Buffer.alloc(W * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      row[x * 3] = clamp(Math.round(buf[i]));
      row[x * 3 + 1] = clamp(Math.round(buf[i + 1]));
      row[x * 3 + 2] = clamp(Math.round(buf[i + 2]));
    }
    let bestFilter = 0;
    let bestRow: Buffer | null = null;
    let bestScore = Infinity;
    for (let f = 0; f <= 4; f++) {
      const out = Buffer.alloc(W * 3);
      let score = 0;
      for (let x = 0; x < W * 3; x++) {
        const left = x >= 3 ? row[x - 3] : 0;
        const up = prev[x];
        const upLeft = x >= 3 ? prev[x - 3] : 0;
        let v: number;
        if (f === 0) v = row[x];
        else if (f === 1) v = row[x] - left;
        else if (f === 2) v = row[x] - up;
        else if (f === 3) v = row[x] - ((left + up) >> 1);
        else v = row[x] - paeth(left, up, upLeft);
        const b = v & 0xff;
        out[x] = b;
        score += b < 128 ? b : 256 - b;
      }
      if (score < bestScore) {
        bestScore = score;
        bestFilter = f;
        bestRow = out;
      }
    }
    const off = y * (1 + W * 3);
    raw[off] = bestFilter;
    if (bestRow) bestRow.copy(raw, off + 1);
    prev.set(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = deflateSync(raw, { level: 9 });
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
const png = encodePNG();
const outPath = join(outDir, 'entry.png');
writeFileSync(outPath, png);
chmodSync(outPath, 0o644);
console.log(`wrote ${outPath} ${png.length} bytes ${W}x${H}`);
