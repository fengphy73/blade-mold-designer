/**
 * Solid NACA 2412 blade for direct printing.
 * Upper/lower surfaces use the same camber and cosine thickness term as the mold's
 * upper surface, twisted with the same sign. Mold meshes are not built here.
 */
import { clamp, smoothstep, rawStation } from './model.js';
import { effectiveJoint, seamProfile, widthAt } from './joint.js';
import { finalizeMesh } from './mesh.js';
import earcut from '../vendor/earcut.esm.js';

const NU = 36;

function camberTerms(u) {
  u = clamp(u, 0, 1);
  const m = 0.02, p = 0.4, t = 0.12;
  const yt = 5 * t * (0.2969 * Math.sqrt(u) - 0.1260 * u - 0.3516 * u * u + 0.2843 * u * u * u - 0.1036 * u * u * u * u);
  let yc, slope;
  if (u < p) {
    yc = m / (p * p) * (2 * p * u - u * u);
    slope = 2 * m / (p * p) * (p - u);
  } else {
    yc = m / ((1 - p) * (1 - p)) * ((1 - 2 * p) + 2 * p * u - u * u);
    slope = 2 * m / ((1 - p) * (1 - p)) * (p - u);
  }
  return { yc, half: yt * Math.cos(Math.atan(slope)) };
}

function naturalSurfaces(u, chord) {
  const { yc, half } = camberTerms(u);
  return { zu: (yc + half) * chord, zl: (yc - half) * chord };
}

/** Closed section with the trailing edge blended out to at least teMin. */
export function thickenedSurfaces(u, chord, teMin) {
  const n = naturalSurfaces(u, chord);
  const nat = n.zu - n.zl;
  const mid = (n.zu + n.zl) / 2;
  const u0 = crossingU(chord, teMin);
  let thick = nat;
  if (u >= u0) {
    const span = Math.max(1e-6, 1 - u0);
    const s = smoothstep((u - u0) / span);
    const t0 = Math.max(naturalSurfaces(u0, chord).zu - naturalSurfaces(u0, chord).zl, teMin);
    thick = Math.max(nat, t0 + (teMin - t0) * s, teMin);
  } else if (nat < teMin) {
    thick = teMin;
  }
  return { zu: mid + thick / 2, zl: mid - thick / 2, thick };
}

const crossCache = new Map();
function crossingU(chord, teMin) {
  const key = `${chord.toFixed(3)}:${teMin.toFixed(3)}`;
  const hit = crossCache.get(key);
  if (hit !== undefined) return hit;
  let u = 0.99;
  for (let i = 0; i <= 40; i++) {
    const uu = 0.55 + (0.44 * i) / 40;
    const n = naturalSurfaces(uu, chord);
    if (n.zu - n.zl >= teMin) u = uu;
  }
  crossCache.set(key, u);
  return u;
}

function twistPoint(c, y, xLocal, zLocal) {
  const st = rawStation(c, y);
  const rad = st.twist * Math.PI / 180;
  const axisX = st.chord * c.twistAxis / 100;
  const dx = xLocal - axisX;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  return [axisX + dx * cos + zLocal * sin, y, -dx * sin + zLocal * cos];
}

export function unrotateBlade(c, y, x, z) {
  const st = rawStation(c, y);
  const axisX = st.chord * c.twistAxis / 100;
  const rad = st.twist * Math.PI / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const xw = x - axisX;
  const dx = cos * xw - sin * z;
  const zLocal = sin * xw + cos * z;
  return { xLocal: axisX + dx, zLocal, chord: st.chord };
}

function sectionLocal(chord, teMin) {
  const pts = [];
  for (let i = 0; i <= NU; i++) {
    const u = (1 - Math.cos(Math.PI * i / NU)) / 2;
    const s = thickenedSurfaces(u, chord, teMin);
    pts.push({ x: u * chord, z: s.zu });
  }
  for (let i = NU; i >= 1; i--) {
    const u = (1 - Math.cos(Math.PI * i / NU)) / 2;
    const s = thickenedSurfaces(u, chord, teMin);
    pts.push({ x: u * chord, z: s.zl });
  }
  return pts;
}

class Builder {
  constructor() {
    this.pos = [];
    this.idx = [];
    this.map = new Map();
  }
  v(x, y, z) {
    const k = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
    let i = this.map.get(k);
    if (i === undefined) {
      i = this.pos.length / 3;
      this.pos.push(x, y, z);
      this.map.set(k, i);
    }
    return i;
  }
  tri(a, b, c) {
    if (a === b || b === c || a === c) return;
    this.idx.push(a, b, c);
  }
  quad(a, b, c, d) {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }
}

function dedup(ids) {
  const out = [];
  for (const id of ids) if (!out.length || out[out.length - 1] !== id) out.push(id);
  if (out.length > 1 && out[0] === out[out.length - 1]) out.pop();
  return out;
}

function signedArea(ids, pos) {
  let a = 0;
  for (let i = 0; i < ids.length; i++) {
    const j = (i + 1) % ids.length;
    const x1 = pos[ids[i] * 3], z1 = pos[ids[i] * 3 + 2];
    const x2 = pos[ids[j] * 3], z2 = pos[ids[j] * 3 + 2];
    a += x1 * z2 - x2 * z1;
  }
  return a * 0.5;
}

function capPlanar(mesh, outerIds, holeIds) {
  const pos = mesh.pos;
  let outer = dedup(outerIds);
  let hole = holeIds ? dedup(holeIds) : null;
  if (outer.length < 3) return;
  if (hole && hole.length < 3) hole = null;
  if (hole && signedArea(outer, pos) * signedArea(hole, pos) > 0) hole = hole.slice().reverse();
  const data = [];
  const map = [];
  for (const id of outer) {
    data.push(pos[id * 3], pos[id * 3 + 2]);
    map.push(id);
  }
  const holes = hole ? [map.length] : null;
  if (hole) {
    for (const id of hole) {
      data.push(pos[id * 3], pos[id * 3 + 2]);
      map.push(id);
    }
  }
  const tris = earcut(data, holes, 2);
  for (let i = 0; i < tris.length; i += 3) {
    mesh.tri(map[tris[i]], map[tris[i + 1]], map[tris[i + 2]]);
  }
}

function loft(mesh, a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    mesh.quad(a[i], a[j], b[j], b[i]);
  }
}

function rectLocal(cx, zMid, halfW, halfH) {
  return [
    { x: cx - halfW, z: zMid + halfH },
    { x: cx + halfW, z: zMid + halfH },
    { x: cx + halfW, z: zMid - halfH },
    { x: cx - halfW, z: zMid - halfH }
  ];
}

function pushWorld(mesh, c, y, localPts) {
  return localPts.map(p => {
    const w = twistPoint(c, y, p.x, p.z);
    return mesh.v(w[0], w[1], w[2]);
  });
}

function airfoilIds(mesh, c, y, teMin) {
  const st = rawStation(c, y);
  return pushWorld(mesh, c, y, sectionLocal(st.chord, teMin));
}

/**
 * Decide whether the shared dovetail fits inside the seam section.
 * Width is scaled only if needed; per-side clearance stays in millimetres.
 */
export function bladeJointFit(c, y) {
  const teMin = c.teMinThickness;
  const joint = effectiveJoint(c);
  const st = rawStation(c, y);
  const chord = st.chord;
  const profile = seamProfile(joint, chord);
  const wall = 1.2;
  const tongueHead = widthAt(profile, 1, chord, 'tongue');
  let scale = 1;
  let socketHead = widthAt(profile, 1, chord, 'socket');
  const maxW = chord - 2 * wall;
  if (socketHead > maxW) {
    const room = maxW - 2 * joint.clearance;
    if (room < 4) return { ok: false, reason: '弦向剩料不足，無法留下鳩尾外壁' };
    scale = room / tongueHead;
    socketHead = tongueHead * scale + 2 * joint.clearance;
  }
  const center = chord * c.twistAxis / 100;
  const halfW = socketHead / 2;
  if (center - halfW < wall || center + halfW > chord - wall) {
    return { ok: false, reason: '鳩尾會碰到前緣或後緣' };
  }
  let minThick = Infinity;
  for (let i = 0; i <= 10; i++) {
    const x = center - halfW + (2 * halfW * i) / 10;
    const s = thickenedSurfaces(clamp(x / chord, 0, 1), chord, teMin);
    minThick = Math.min(minThick, s.zu - s.zl);
  }
  const availH = minThick - 2 * wall;
  if (!(availH >= 2)) return { ok: false, reason: '接縫截面太薄，放不下有外壁的鳩尾' };
  const halfH = Math.min(4, availH / 2);
  const mid = thickenedSurfaces(clamp(center / chord, 0, 1), chord, teMin);
  const zMid = (mid.zu + mid.zl) / 2;
  return { ok: true, scale, halfH, zMid, center, profile, chord, clearance: joint.clearance, depth: joint.depth };
}

export function bladePlans(c) {
  const segs = c.printableSegments;
  const plans = segs.map((seg, index) => ({
    ...seg,
    index,
    hasStart: segs.length > 1 && index > 0,
    hasEnd: segs.length > 1 && index < segs.length - 1,
    fit: null,
    butt: false,
    warning: ''
  }));
  for (let i = 0; i < plans.length - 1; i++) {
    const fit = bladeJointFit(c, plans[i].end);
    if (!fit.ok) {
      plans[i].hasEnd = false;
      plans[i + 1].hasStart = false;
      plans[i].butt = true;
      plans[i + 1].butt = true;
      const msg = `第 ${i + 1}、${i + 2} 段接縫改為平面對接：${fit.reason}。`;
      plans[i].warning = msg;
      plans[i + 1].warning = msg;
    } else {
      plans[i].fit = fit;
      plans[i + 1].fit = fit;
    }
  }
  return plans;
}

function halfWidth(fit, t, kind) {
  const tongue = widthAt(fit.profile, t, fit.chord, 'tongue') * fit.scale;
  if (kind === 'socket') return (tongue + 2 * fit.clearance) / 2;
  return tongue / 2;
}

function sampleYs(y0, y1, step, extra = []) {
  const ys = [];
  const add = (y) => {
    const v = Math.round(clamp(y, y0, y1) * 10000) / 10000;
    ys.push(v);
  };
  const n = Math.max(2, Math.ceil((y1 - y0) / step));
  for (let i = 0; i <= n; i++) add(y0 + (y1 - y0) * i / n);
  for (const y of extra) if (y >= y0 - 1e-6 && y <= y1 + 1e-6) add(y);
  return [...new Set(ys)].sort((a, b) => a - b);
}

export function buildBlade(c, segmentIndex) {
  const plans = bladePlans(c);
  const seg = plans[segmentIndex];
  const teMin = c.teMinThickness;
  const mesh = new Builder();
  const fit = seg.fit;
  const depth = fit ? fit.depth : 0;
  const ys = sampleYs(seg.start, seg.end, 3.5, [
    seg.start,
    seg.end,
    ...(seg.hasStart ? [seg.start + depth] : []),
    ...c.stations.map(s => s.y)
  ]);
  if (seg.hasStart) {
    for (let i = 0; i <= 10; i++) ys.push(Math.round((seg.start + depth * i / 10) * 10000) / 10000);
  }
  const rowsY = [...new Set(ys.filter(y => y >= seg.start - 1e-6 && y <= seg.end + 1e-6))].sort((a, b) => a - b);
  const rows = rowsY.map(y => ({ y, outer: airfoilIds(mesh, c, y, teMin), hole: null }));

  const holeAt = (y, kind) => {
    const t = clamp((y - (kind === 'socket' ? seg.start : seg.end)) / depth, 0, 1);
    const hw = halfWidth(fit, t, kind);
    return rectLocal(fit.center, fit.zMid, hw, fit.halfH);
  };

  if (seg.hasStart) {
    for (const row of rows) {
      if (row.y <= seg.start + depth + 1e-6) row.hole = pushWorld(mesh, c, row.y, holeAt(row.y, 'socket'));
    }
  }

  for (let r = 0; r < rows.length - 1; r++) loft(mesh, rows[r].outer, rows[r + 1].outer);
  if (seg.hasStart) {
    const sock = rows.filter(row => row.hole);
    for (let r = 0; r < sock.length - 1; r++) loft(mesh, sock[r].hole, sock[r + 1].hole);
    capPlanar(mesh, sock[sock.length - 1].hole, null);
    capPlanar(mesh, rows[0].outer, rows[0].hole);
  } else {
    capPlanar(mesh, rows[0].outer, null);
  }

  const end = rows[rows.length - 1];
  if (seg.hasEnd) {
    end.hole = pushWorld(mesh, c, seg.end, holeAt(seg.end, 'tongue'));
    capPlanar(mesh, end.outer, end.hole);
    let prev = end.hole;
    for (let i = 1; i <= 10; i++) {
      const y = seg.end + depth * i / 10;
      const ids = pushWorld(mesh, c, y, holeAt(y, 'tongue'));
      loft(mesh, prev, ids);
      prev = ids;
    }
    capPlanar(mesh, prev, null);
  } else {
    capPlanar(mesh, end.outer, null);
  }

  let minZ = Infinity;
  for (let i = 2; i < mesh.pos.length; i += 3) minZ = Math.min(minZ, mesh.pos[i]);
  for (let i = 2; i < mesh.pos.length; i += 3) mesh.pos[i] -= minZ;
  const built = finalizeMesh(mesh.pos, mesh.idx);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, z0 = Infinity, z1 = -Infinity;
  const p = built.positions;
  for (let i = 0; i < p.length; i += 3) {
    minX = Math.min(minX, p[i]); maxX = Math.max(maxX, p[i]);
    minY = Math.min(minY, p[i + 1]); maxY = Math.max(maxY, p[i + 1]);
    z0 = Math.min(z0, p[i + 2]); z1 = Math.max(z1, p[i + 2]);
  }
  const st0 = rawStation(c, seg.start), st1 = rawStation(c, seg.end);
  return {
    ...built,
    kind: 'blade',
    segmentIndex,
    warnings: seg.warning ? [seg.warning] : [],
    joint: seg.hasStart || seg.hasEnd ? 'dovetail' : (seg.butt ? 'butt' : 'none'),
    zShift: minZ,
    minX, maxX, minY, maxY, minZ: z0, maxZ: z1,
    height: z1 - z0,
    span: seg.end - seg.start,
    chordStart: st0.chord,
    chordEnd: st1.chord,
    twistStart: st0.twist,
    twistEnd: st1.twist,
    fit: seg.hasStart || seg.hasEnd ? fit : null
  };
}
