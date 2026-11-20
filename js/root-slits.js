// 葉根割線模式（v1.3.0）：A 十字由疏變密、B 方形螺旋、C 葉根梳齒。
// 只在雙層雷切 SVG 的葉根段改割線；扭角低於 θ1 的葉尖段沿用 v1.2.2 短切，不動。
// 座標：x 為弦向（0＝前緣），y 為距圓心 r（mm），與模具相同。
import { station, planformYs, bladeSvgStart } from './model.js';

export const RS = {
  edge: 3,          // 新割線距外框至少 3 mm（C 剖縫穿出葉根端除外）
  bridge: 2.5,      // 新割線與任何割線之間至少留 2.5 mm
  hole: 0.5,        // 縫端圓孔半徑（Ø1.0 mm）
  splitHole: 1.25,  // C 剖縫止裂孔半徑（Ø2.5 mm）
  trim: 5           // C 葉根修切量
};

export const ROOT_SLIT_MODE_NAMES = {
  off: '關閉',
  A: 'A 十字由疏變密',
  B: 'B 方形螺旋',
  C: 'C 葉根梳齒'
};

const EPS = 1e-9;
const clamp01 = v => Math.min(1, Math.max(0, v));
const absTwist = (c, y) => Math.abs(station(c, y).twist);

/** r positions (mm) where |twist| crosses theta between y0 and y1. down = twist drops below theta going outward. */
export function twistCrossings(c, theta, y0, y1) {
  const out = [];
  if (!(y1 > y0)) return out;
  const n = Math.max(1, Math.ceil((y1 - y0) / 0.25));
  let prevY = y0, prevHi = absTwist(c, y0) >= theta;
  for (let i = 1; i <= n; i++) {
    const y = i === n ? y1 : y0 + (y1 - y0) * i / n;
    const hi = absTwist(c, y) >= theta;
    if (hi !== prevHi) {
      let a = prevY, b = y;
      for (let k = 0; k < 48; k++) {
        const mid = (a + b) / 2;
        if ((absTwist(c, mid) >= theta) === prevHi) a = mid; else b = mid;
      }
      out.push({ y: (a + b) / 2, down: prevHi });
    }
    prevY = y; prevHi = hi;
  }
  return out;
}

/** 0–1 zone weight: 1 where |twist| ≥ theta (farther than band/2 from a crossing), linear across the band. */
function zoneWeight(c, theta, y0, y1, band) {
  const xs = twistCrossings(c, theta, y0, y1);
  return y => {
    const hi = absTwist(c, Math.min(y1, Math.max(y0, y))) >= theta;
    if (band <= 0) return hi ? 1 : 0;
    let d = Infinity;
    for (const x of xs) d = Math.min(d, Math.abs(y - x.y));
    return clamp01(0.5 + (hi ? d : -d) / band);
  };
}

/** Zone weights used by the layout: h (θ2, 1 = 高扭段) and m (θ1, 0 = 葉尖段不動). */
export function rootSlitWeights(c) {
  const origin = bladeSvgStart(c), fullSpan = c.stations.at(-1).y;
  return {
    h: zoneWeight(c, c.rootSlitTheta2, origin, fullSpan, c.rootSlitBand),
    m: zoneWeight(c, c.rootSlitTheta1, origin, fullSpan, c.rootSlitBand)
  };
}

/** Where the sheet outline starts (C adds the root trim allowance). */
export function rootSlitOutlineStart(c) {
  return bladeSvgStart(c) - (c.rootSlitMode === 'C' ? RS.trim : 0);
}

/** Switch lines shown on the page: crossings of θ2 and θ1 inside the laser SVG span. */
export function rootSlitSwitchLines(c) {
  const y0 = bladeSvgStart(c), y1 = c.stations.at(-1).y;
  return {
    theta2: twistCrossings(c, c.rootSlitTheta2, y0, y1),
    theta1: twistCrossings(c, c.rootSlitTheta1, y0, y1)
  };
}

// ---------------- geometry helpers ----------------
function bboxOf(f) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const l of f.lines) for (const p of l) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  for (const h of f.holes) {
    minX = Math.min(minX, h.x - h.r); maxX = Math.max(maxX, h.x + h.r); minY = Math.min(minY, h.y - h.r); maxY = Math.max(maxY, h.y + h.r);
  }
  return { minX, minY, maxX, maxY };
}

export function makeFeature(kind, lines, holes = [], edgeOk = false) {
  const f = { kind, lines, holes, edgeOk };
  f.bbox = bboxOf(f);
  return f;
}

function ptSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
  let t = L2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
function orient(a, b, c) { return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); }
function segIntersect(a, b, c, d) {
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  if (((o1 > EPS && o2 < -EPS) || (o1 < -EPS && o2 > EPS)) && ((o3 > EPS && o4 < -EPS) || (o3 < -EPS && o4 > EPS))) return true;
  return false;
}
function segSeg(a, b, c, d) {
  if (segIntersect(a, b, c, d)) return 0;
  return Math.min(ptSeg(a, c, d), ptSeg(b, c, d), ptSeg(c, a, b), ptSeg(d, a, b));
}
function segmentsOf(f) {
  const s = [];
  for (const l of f.lines) for (let i = 0; i < l.length - 1; i++) s.push([l[i], l[i + 1]]);
  return s;
}

/** Material width between two cut features (0 = they touch or cross). Holes are filled disks. */
export function featureDistance(f, g) {
  let m = Infinity;
  const sf = segmentsOf(f), sg = segmentsOf(g);
  for (const [a, b] of sf) for (const [c, d] of sg) m = Math.min(m, segSeg(a, b, c, d));
  for (const h of g.holes) for (const [a, b] of sf) m = Math.min(m, Math.max(0, ptSeg(h, a, b) - h.r));
  for (const h of f.holes) for (const [a, b] of sg) m = Math.min(m, Math.max(0, ptSeg(h, a, b) - h.r));
  for (const h of f.holes) for (const k of g.holes) m = Math.min(m, Math.max(0, Math.hypot(h.x - k.x, h.y - k.y) - h.r - k.r));
  return m;
}

class Grid {
  constructor(cell = 6) { this.cell = cell; this.map = new Map(); }
  keys(b, pad) {
    const c = this.cell, out = [];
    for (let i = Math.floor((b.minX - pad) / c); i <= Math.floor((b.maxX + pad) / c); i++)
      for (let j = Math.floor((b.minY - pad) / c); j <= Math.floor((b.maxY + pad) / c); j++) out.push(`${i},${j}`);
    return out;
  }
  insert(f) { for (const k of this.keys(f.bbox, 0)) { if (!this.map.has(k)) this.map.set(k, []); this.map.get(k).push(f); } }
  query(b, pad) {
    const seen = new Set();
    for (const k of this.keys(b, pad)) for (const f of this.map.get(k) || []) seen.add(f);
    return seen;
  }
}

/** Corner points of the sheet outline (same construction as the SVG path), relative y from outStart. */
export function outlineCorners(c, outStart, fullSpan) {
  const span = fullSpan - outStart;
  const ys = [0, ...planformYs(c).filter(y => y > outStart && y < fullSpan).map(y => y - outStart), span];
  const chordAt = y => station(c, outStart + y).chord;
  const points = [
    { x: 0, y: 0 },
    { x: 0, y: span },
    { x: chordAt(span), y: span },
    ...ys.slice(1, -1).reverse().map(y => ({ x: chordAt(y), y })),
    { x: chordAt(0), y: 0 }
  ];
  const corners = new Set([0, 1, 2, points.length - 1]);
  const ends = points.map((p, i) => {
    if (!corners.has(i) || c.cornerRadius === 0) return { entry: p, exit: p, rounded: false };
    const prev = points[(i - 1 + points.length) % points.length];
    const next = points[(i + 1) % points.length];
    const l1 = Math.hypot(prev.x - p.x, prev.y - p.y);
    const l2 = Math.hypot(next.x - p.x, next.y - p.y);
    const d = Math.min(c.cornerRadius, l1 / 2, l2 / 2);
    return {
      entry: { x: p.x + (prev.x - p.x) * d / l1, y: p.y + (prev.y - p.y) * d / l1 },
      exit: { x: p.x + (next.x - p.x) * d / l2, y: p.y + (next.y - p.y) * d / l2 },
      rounded: d > 0
    };
  });
  return { points, ends, span };
}

/** Outline polygon in sheet coordinates (absolute r), quadratic corners sampled. */
export function outlinePolygon(c, outStart, fullSpan) {
  const { points, ends } = outlineCorners(c, outStart, fullSpan);
  const poly = [];
  const push = p => poly.push({ x: p.x, y: p.y + outStart });
  const quad = (a, ctrl, b) => {
    for (let k = 1; k <= 8; k++) {
      const t = k / 8, u = 1 - t;
      push({ x: u * u * a.x + 2 * u * t * ctrl.x + t * t * b.x, y: u * u * a.y + 2 * u * t * ctrl.y + t * t * b.y });
    }
  };
  push(ends[0].exit);
  for (let i = 1; i < points.length; i++) {
    push(ends[i].entry);
    if (ends[i].rounded) quad(ends[i].entry, points[i], ends[i].exit);
  }
  push(ends[0].entry);
  if (ends[0].rounded) quad(ends[0].entry, points[0], ends[0].exit);
  return poly;
}

function inside(poly, p) {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) ins = !ins;
  }
  return ins;
}

/** Smallest distance from a feature to the outline (negative if any part lies outside). */
export function edgeDistance(f, poly, fromY = -Infinity) {
  let m = Infinity;
  const segs = segmentsOf(f).map(([a, b]) => (a.y < fromY || b.y < fromY)
    ? [{ x: a.x, y: Math.max(a.y, fromY) }, { x: b.x, y: Math.max(b.y, fromY) }] : [a, b]);
  for (const [a, b] of segs) {
    if (!inside(poly, a) || !inside(poly, b)) return -1;
    for (let i = 0; i < poly.length; i++) m = Math.min(m, segSeg(a, b, poly[i], poly[(i + 1) % poly.length]));
  }
  for (const h of f.holes) {
    if (!inside(poly, h)) return -1;
    for (let i = 0; i < poly.length; i++) m = Math.min(m, ptSeg(h, poly[i], poly[(i + 1) % poly.length]) - h.r);
  }
  return m;
}

export function featureCutLength(f) {
  let L = 0;
  for (const [a, b] of segmentsOf(f)) L += Math.hypot(b.x - a.x, b.y - a.y);
  for (const h of f.holes) L += 2 * Math.PI * h.r;
  return L;
}

function spiralPoints(x0, y0, s, g) {
  const lens = [s, s, s];
  for (let L = s - g; L >= g; L -= g) lens.push(L, L);
  const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const pts = [{ x: x0, y: y0 }];
  let x = x0, y = y0;
  lens.forEach((l, i) => { const [dx, dy] = dirs[i % 4]; x += dx * l; y += dy * l; pts.push({ x, y }); });
  return pts;
}

/**
 * Root-slit features for one balsa layer.
 * existing: v1.2.2 slits of this layer as {x, y, endX, endY} (absolute r).
 * Returns kept (indices into existing, in order), added (new features), notes.
 */
export function buildRootSlitLayer(c, layer, existing) {
  const mode = c.rootSlitMode;
  const origin = bladeSvgStart(c);
  const fullSpan = c.stations.at(-1).y;
  const outStart = rootSlitOutlineStart(c);
  const poly = outlinePolygon(c, outStart, fullSpan);
  const E = Math.max(RS.edge, c.slitEdgeKeep), BR = RS.bridge, HOLE = RS.hole;
  const band = c.rootSlitBand;
  const h = zoneWeight(c, c.rootSlitTheta2, origin, fullSpan, band);
  const m = zoneWeight(c, c.rootSlitTheta1, origin, fullSpan, band);
  const phase = layer === 2 ? c.slitStagger / 100 : 0;
  const chordAt = y => station(c, Math.min(fullSpan, Math.max(outStart, y))).chord;
  const minChord = (a, b) => Math.min(chordAt(a), chordAt(b), chordAt((a + b) / 2));
  const notes = [];
  const grid = new Grid();
  const kept = [], added = [];
  const exF = existing.map(s => makeFeature('slit', [[{ x: s.x, y: s.y }, { x: s.endX, y: s.endY }]]));
  const isTip = s => m(s.y) <= 0 && m(s.endY) <= 0 && m((s.y + s.endY) / 2) <= 0;

  const clear = f => {
    for (const g of grid.query(f.bbox, BR)) if (featureDistance(f, g) < BR - 1e-6) return false;
    return true;
  };
  const keep = i => { grid.insert(exF[i]); kept.push(i); };
  const tryKeep = i => { if (clear(exF[i])) { keep(i); return true; } return false; };
  const tryAdd = (f, fromY = -Infinity) => {
    if (edgeDistance(f, poly, fromY) < E - 1e-6) return false;
    if (!clear(f)) return false;
    grid.insert(f); added.push(f); return true;
  };

  if (mode === 'A') {
    existing.forEach((s, i) => { if (isTip(s)) keep(i); });
    const pitch = y => 4.5 + 4.5 * (1 - h(y));
    let y = origin + E + HOLE + 1.5;
    y += pitch(y) * phase;
    let k = 0;
    while (y <= fullSpan) {
      const mw = m(y);
      if (mw <= 0) { y += 0.5; continue; }
      const p = pitch(y), high = p < 8;
      const per = high ? 8.5 : 9, spanH = high ? 1.5 : 3;
      if (y + spanH + HOLE > fullSpan - E) break;
      const off = (k % 2 ? per / 2 : 0) + per * phase;
      const C = minChord(y - spanH - HOLE, y + spanH + HOLE);
      const axis = chordAt(y) * c.twistAxis / 100;
      const reach = Math.max(axis, chordAt(y) - axis, 1e-6);
      for (let x = E + HOLE + 1 + (off % per); x <= C - E - HOLE - 1 + 1e-9; x += per) {
        const ch = high ? (2.5 + 2.0 * Math.abs(x - axis) / reach) / 2 : 2.5 * mw;
        const xa = Math.max(x - ch, E + HOLE), xb = Math.min(x + ch, C - E - HOLE);
        const spanArm = [{ x, y: y - spanH }, { x, y: y + spanH }];
        if (xb - xa >= 2 && xa < x && x < xb) {
          tryAdd(makeFeature('cross', [[{ x: xa, y }, { x: xb, y }], spanArm],
            [{ x: xa, y, r: HOLE }, { x: xb, y, r: HOLE }, { x, y: y - spanH, r: HOLE }, { x, y: y + spanH, r: HOLE }]));
        } else if (!high && mw < 1) {
          tryAdd(makeFeature('slit_v', [spanArm], [{ x, y: y - spanH, r: HOLE }, { x, y: y + spanH, r: HOLE }]));
        }
      }
      let next = y + p;
      if (high && pitch(next) >= 8) next = Math.max(next, y + 8.2);
      y = next; k++;
    }
  }

  const midCuts = () => {
    const rows = new Map();
    for (const i of kept) {
      const s = existing[i];
      if (isTip(s)) continue;
      const key = s.y.toFixed(6);
      if (!rows.has(key)) rows.set(key, { y0: s.y, xs: [] });
      rows.get(key).xs.push(s.x);
    }
    for (const { y0, xs } of rows.values()) {
      const yc = y0 + c.slitLength / 2;
      if (m(yc) < 0.5) continue;
      xs.sort((a, b) => a - b);
      for (let j = 0; j < xs.length - 1; j++) {
        const xm = (xs[j] + xs[j + 1]) / 2;
        if (xm < 0.45 * chordAt(yc)) continue;
        tryAdd(makeFeature('slit_h', [[{ x: xm - 1.5, y: yc }, { x: xm + 1.5, y: yc }]],
          [{ x: xm - 1.5, y: yc, r: HOLE }, { x: xm + 1.5, y: yc, r: HOLE }]));
      }
    }
  };

  if (mode === 'B') {
    existing.forEach((s, i) => { if (h(s.y) < 1) keep(i); });
    midCuts();
    const keptStarts = kept.map(i => existing[i].y).sort((a, b) => a - b);
    const nextStart = y => { for (const v of keptStarts) if (v >= y) return v; return Infinity; };
    let y = origin + E + HOLE + 3 * phase, k = 0, blocked = false;
    while (y < fullSpan) {
      if (h(y + 5) < 0.5) { blocked = false; y += 0.5; continue; }
      if (blocked) { y += 0.5; continue; }
      let s = 10;
      const g = 3, br = 3, nx = nextStart(y);
      if (y + s + HOLE + BR > nx) {
        s = 7;
        if (y + s + HOLE + BR > nx) { blocked = true; y += 0.5; continue; }
      }
      if (y + s + HOLE > fullSpan - E) break;
      const off = (k % 2 ? (s + br) / 2 : 0) + (s + br) * phase;
      const C = minChord(y - HOLE, y + s + HOLE);
      for (let x = E + HOLE + (off % (s + br)); x + s <= C - E - HOLE + 1e-9; x += s + br) {
        const pts = spiralPoints(x, y, s, g);
        tryAdd(makeFeature('spiral', [pts], [{ ...pts[0], r: HOLE }, { ...pts.at(-1), r: HOLE }]));
      }
      y += s + br; k++;
    }
  }

  if (mode === 'C') {
    existing.forEach((s, i) => { if (isTip(s)) keep(i); });
    const splitsAdded = [];
    if (h(origin) >= 0.5) {
      const down2 = twistCrossings(c, c.rootSlitTheta2, origin, fullSpan).find(x => x.down);
      const down1 = twistCrossings(c, c.rootSlitTheta1, origin, fullSpan).find(x => x.down);
      const y2 = down2 ? down2.y : fullSpan;
      const limit = Math.min(fullSpan - E - RS.splitHole, down1 ? down1.y - band / 2 - 5 : Infinity);
      const plan = layer === 1 ? [[30, -3], [45, 7], [58, 17]] : [[24, -3], [38, 7], [52, 17], [65, 22]];
      const C0 = chordAt(origin);
      for (const [frac, dy] of plan) {
        const sx = frac / 73 * C0;
        const ye = Math.min(y2 + dy, limit);
        if (ye - origin < 10) continue;
        const f = makeFeature('split', [[{ x: sx, y: outStart }, { x: sx, y: ye }]], [{ x: sx, y: ye, r: RS.splitHole }], true);
        if (tryAdd(f, outStart + E)) splitsAdded.push(f);
      }
    }
    if (!splitsAdded.length) notes.push('C：葉根起點的扭角低於 θ2（或剖縫放不下），這次沒有產生梳齒剖縫，只加中段後緣側橫切。');
    existing.forEach((s, i) => { if (!isTip(s) && h(s.y) < 1) tryKeep(i); });
    kept.sort((a, b) => a - b);
    midCuts();
    if (splitsAdded.length) {
      let y = origin + E + HOLE + 4.5 * phase, k = 0;
      while (y < fullSpan && h(y + 1) >= 1 - 1e-9) {
        const C = chordAt(y);
        for (let x = 47 / 73 * C + (k % 2 ? 3 : 0); x + 4 <= C - E - HOLE + 1e-9; x += 7) {
          tryAdd(makeFeature('slit_h', [[{ x, y }, { x: x + 4, y }]], [{ x, y, r: HOLE }, { x: x + 4, y, r: HOLE }]));
        }
        y += 4.5; k++;
      }
    }
  }
  kept.sort((a, b) => a - b);
  return { kept, added, notes, outStart, poly, existingFeatures: exF };
}
