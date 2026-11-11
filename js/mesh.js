/**
 * Watertight mold meshes.
 * Each segment is one closed shell: body, dovetail, locating lip and M3 lugs share vertices.
 */
import { clamp, interp, smoothstep, station, transformed, faceLocalZ, fenceStartY, faceEnvelope } from './model.js';
import { effectiveJoint, jointDepthMm, seamProfile, widthAt, limitJointWidth } from './joint.js';

const MID = 24;
const KL = 8;
const KR = 16;

function round4(v) {
  return Math.round(v * 10000) / 10000;
}

class MeshBuilder {
  constructor() {
    this.pos = [];
    this.idx = [];
    this.map = new Map();
  }
  v(x, y, z) {
    const k = `${round4(x)},${round4(y)},${round4(z)}`;
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

function dedupRing(ids) {
  const out = [];
  for (const id of ids) {
    if (!out.length || out[out.length - 1] !== id) out.push(id);
  }
  if (out.length > 1 && out[0] === out[out.length - 1]) out.pop();
  return out;
}

/** End face between a surface chain and the matching back chain. Keeps every short edge. */
function capStrip(mesh, surf, back) {
  const n = Math.min(surf.length, back.length);
  for (let i = 0; i < n - 1; i++) {
    const a = surf[i], b = surf[i + 1], c = back[i + 1], d = back[i];
    if (a === b && c === d) continue;
    if (c === d) mesh.tri(a, b, d);
    else if (a === b) mesh.tri(d, c, a);
    else mesh.quad(a, b, c, d);
  }
}

function triArea(pos, a, b, c) {
  const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
  const bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2];
  const cx = pos[c * 3], cy = pos[c * 3 + 1], cz = pos[c * 3 + 2];
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  return 0.5 * Math.hypot(nx, ny, nz);
}

function volumeOf(pos, idx) {
  let v = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ax = pos[a], ay = pos[a + 1], az = pos[a + 2];
    const bx = pos[b], by = pos[b + 1], bz = pos[b + 2];
    const cx = pos[c], cy = pos[c + 1], cz = pos[c + 2];
    v += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  }
  return v / 6;
}

/** Make winding consistent, then flip so the enclosed volume is positive. */
export function finalizeMesh(posIn, idxIn) {
  const pos = posIn;
  const raw = [];
  for (let i = 0; i < idxIn.length; i += 3) {
    const a = idxIn[i], b = idxIn[i + 1], c = idxIn[i + 2];
    if (a === b || b === c || a === c) continue;
    if (triArea(pos, a, b, c) < 1e-10) continue;
    raw.push([a, b, c]);
  }
  const n = raw.length;
  const edgeMap = new Map();
  const key = (a, b) => (a < b ? a + '_' + b : b + '_' + a);
  for (let i = 0; i < n; i++) {
    const [a, b, c] = raw[i];
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const k = key(u, v);
      let arr = edgeMap.get(k);
      if (!arr) edgeMap.set(k, arr = []);
      arr.push(i);
    }
  }
  const seen = new Uint8Array(n);
  const flip = new Uint8Array(n);
  const dirs = (ti) => {
    let a = raw[ti][0], b = raw[ti][1], c = raw[ti][2];
    if (flip[ti]) [b, c] = [c, b];
    return [[a, b], [b, c], [c, a]];
  };
  for (let s = 0; s < n; s++) {
    if (seen[s]) continue;
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const ti = stack.pop();
      for (const [a, b] of dirs(ti)) {
        const arr = edgeMap.get(key(a, b)) || [];
        for (const nj of arr) {
          if (nj === ti || seen[nj]) continue;
          const same = dirs(nj).some(([c, d]) => c === a && d === b);
          if (same) flip[nj] = 1;
          seen[nj] = 1;
          stack.push(nj);
        }
      }
    }
  }
  const idx = [];
  for (let i = 0; i < n; i++) {
    let [a, b, c] = raw[i];
    if (flip[i]) [b, c] = [c, b];
    idx.push(a, b, c);
  }
  if (volumeOf(pos, idx) < 0) {
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = t;
    }
  }
  // Compact unused vertices.
  const used = new Map();
  const posOut = [];
  const idxOut = [];
  const mapV = (id) => {
    let nId = used.get(id);
    if (nId === undefined) {
      nId = posOut.length / 3;
      used.set(id, nId);
      posOut.push(pos[id * 3], pos[id * 3 + 1], pos[id * 3 + 2]);
    }
    return nId;
  };
  for (let i = 0; i < idx.length; i += 3) {
    const a = mapV(idx[i]), b = mapV(idx[i + 1]), c = mapV(idx[i + 2]);
    if (a === b || b === c || a === c) continue;
    if (triArea(posOut, a, b, c) < 1e-10) continue;
    idxOut.push(a, b, c);
  }
  return {
    positions: Float32Array.from(posOut),
    indices: Uint32Array.from(idxOut)
  };
}

function fenceActive(c, y, kind) {
  return kind === 'lower' && c.locatorEnabled && y >= fenceStartY(c) - 1e-9;
}

/**
 * Constant-length surface polyline in local x.
 * `split` places indices KL/KR on the exact joint walls; null spreads the middle evenly.
 */
const LUG_OUT = 9;
const LUG_HALF_Y = 5;
const LUG_HOLE_R = 1.7;
const LUG_CENTER = 4.5;

export function lugCenters(seg) {
  const len = seg.end - seg.start;
  const offset = Math.min(15, len / 2 - 7);
  return [seg.start + offset, seg.end - offset];
}

function earSide(sideX, sign, y, centers) {
  let hit = null;
  for (const cy of centers) {
    const dy = y - cy;
    if (Math.abs(dy) <= LUG_HALF_Y + 1e-6) { hit = dy; break; }
  }
  if (hit === null) return { outer: sideX, holeOuter: sideX, holeInner: sideX, on: false, hole: false };
  const ad = Math.abs(hit);
  const hole = ad < LUG_HOLE_R - 1e-4;
  const half = hole ? Math.sqrt(Math.max(0, LUG_HOLE_R * LUG_HOLE_R - hit * hit)) : 0;
  const center = sideX + sign * LUG_CENTER;
  return {
    outer: sideX + sign * LUG_OUT,
    holeOuter: hole ? center + sign * half : center,
    holeInner: hole ? center - sign * half : center,
    on: true,
    hole
  };
}

function buildXList(c, y, kind, split, centers) {
  const st = station(c, y);
  const chord = st.chord;
  const margin = c.moldMargin;
  const xs = [];
  const push = (xLocal, fenceBottom = false) => {
    xs.push({ xLocal, fenceBottom });
    return xs.length - 1;
  };
  let ear = null;
  if (c.clampEnabled && centers) {
    const left = earSide(-margin, -1, y, centers);
    const right = earSide(chord + margin, 1, y, centers);
    ear = { left, right, leftOn: left.on, rightOn: right.on, leftHole: left.hole, rightHole: right.hole };
    push(left.outer);
    push(left.holeOuter);
    push(left.holeInner);
  }
  for (let i = 0; i < 4; i++) push(interp(-margin, -1.5, i / 4));
  push(-1.5, false);
  const fence = fenceActive(c, y, kind);
  if (fence) {
    push(-1.5, true);
    push(-0.9, true);
    push(-0.3, true);
  } else {
    push(-1.35, false);
    push(-0.9, false);
    push(-0.45, false);
  }
  push(-0.3, false);

  const x0 = -0.15;
  const x1 = chord + 0.15;
  let iL = -1, iR = -1;
  for (let k = 0; k <= MID; k++) {
    let x;
    if (!split) x = interp(x0, x1, k / MID);
    else if (k <= KL) x = interp(x0, split.xL, KL === 0 ? 1 : k / KL);
    else if (k <= KR) x = interp(split.xL, split.xR, (k - KL) / (KR - KL));
    else x = interp(split.xR, x1, (k - KR) / (MID - KR));
    const id = push(x, false);
    if (k === KL) iL = id;
    if (k === KR) iR = id;
  }

  const rIn = chord + 0.3;
  const rOut = chord + 1.5;
  const rEnd = chord + margin;
  push(rIn, false);
  if (fence) {
    push(rIn, true);
    push((rIn + rOut) / 2, true);
    push(rOut, true);
  } else {
    push(chord + 0.45, false);
    push(chord + 0.9, false);
    push(chord + 1.35, false);
  }
  push(rOut, false);
  for (let i = 1; i <= 4; i++) push(interp(rOut, rEnd, i / 4), false);
  if (ear) {
    const right = ear.right;
    push(right.holeInner);
    push(right.holeOuter);
    push(right.outer);
  }
  return { xs, iL, iR, chord, ear };
}

function jointEdgesAt(c, y, profile, kind) {
  const chord = profile.chord;
  const center = profile.center;
  const t = clamp((y - profile.y0) / profile.depth, 0, 1);
  const requested = widthAt(profile, t, kind === 'socket' ? 'socket' : 'tongue');
  const limited = limitJointWidth(requested, chord, c.moldMargin, 2);
  const full = limited.width;
  const half = full / 2;
  const x0 = -0.15, x1 = chord + 0.15;
  const xL = clamp(center - half, x0 + 0.4, center - 0.6);
  const xR = clamp(center + half, center + 0.6, x1 - 0.4);
  return { xL, xR, full, requested, clamped: limited.clamped || Math.abs((xR - xL) - full) > 1e-3, center };
}

/**
 * Spacing split along a segment. Continuous in y so the loft does not kink at the socket end.
 * The actual void / tongue uses the true profile; this only places vertex columns.
 */
function spacingSplit(c, y, seg, tongueProfile, socketProfile) {
  const startDepth = socketProfile ? socketProfile.depth : 0;
  if (seg.hasStart && y <= seg.start + startDepth + 1e-9) {
    const edges = jointEdgesAt(c, y, socketProfile, 'socket');
    return { xL: edges.xL, xR: edges.xR, clamped: edges.clamped };
  }
  if (seg.hasStart && seg.hasEnd) {
    const a = jointEdgesAt(c, seg.start + startDepth, socketProfile, 'socket');
    const b = jointEdgesAt(c, seg.end, tongueProfile, 'tongue');
    const t = clamp((y - (seg.start + startDepth)) / Math.max(1e-6, seg.end - (seg.start + startDepth)), 0, 1);
    const s = smoothstep(t);
    return { xL: interp(a.xL, b.xL, s), xR: interp(a.xR, b.xR, s), clamped: a.clamped || b.clamped };
  }
  if (seg.hasEnd) {
    const edges = jointEdgesAt(c, seg.end, tongueProfile, 'tongue');
    return { xL: edges.xL, xR: edges.xR, clamped: edges.clamped };
  }
  if (seg.hasStart) {
    const edges = jointEdgesAt(c, seg.start + startDepth, socketProfile, 'socket');
    return { xL: edges.xL, xR: edges.xR, clamped: edges.clamped };
  }
  return null;
}

function collectYs(c, seg, depth) {
  const ys = [];
  const add = (y) => {
    const v = Math.round(clamp(y, seg.start, seg.end) * 10000) / 10000;
    ys.push(v);
  };
  if (c.clampEnabled) {
    for (const cy of lugCenters(seg)) {
      add(cy - LUG_HALF_Y); add(cy + LUG_HALF_Y);
      add(cy - LUG_HOLE_R); add(cy + LUG_HOLE_R);
      for (let i = 1; i <= 6; i++) add(cy - LUG_HOLE_R + (2 * LUG_HOLE_R) * i / 7);
    }
  }
  if (seg.hasStart) {
    const steps = 18;
    for (let i = 0; i <= steps; i++) add(seg.start + depth * i / steps);
  }
  const y0 = seg.hasStart ? seg.start + depth : seg.start;
  const y1 = seg.end;
  const n = Math.max(2, Math.ceil((y1 - y0) / 2.5));
  for (let i = 0; i <= n; i++) add(y0 + (y1 - y0) * i / n);
  if (seg.hasEnd) {
    const trans = Math.min(36, Math.max(14, (seg.end - seg.start) * 0.1));
    add(seg.end - trans);
    const steps = 8;
    for (let i = 0; i <= steps; i++) add(seg.end - trans + trans * i / steps);
  }
  add(seg.start);
  add(seg.end);
  return [...new Set(ys)].sort((a, b) => a - b);
}

function tongueYs(end, depth) {
  const ys = [];
  const steps = 18;
  for (let i = 1; i <= steps; i++) ys.push(Math.round((end + depth * i / steps) * 10000) / 10000);
  return ys;
}

function makeRow(mesh, c, y, kind, split, backZ, centers) {
  const built = buildXList(c, y, kind, split, centers);
  const surf = [];
  const back = [];
  const zs = [];
  const backOwner = new Map();
  for (const s of built.xs) {
    const st = station(c, y);
    const zLocal = faceLocalZ(c, y, s.xLocal, st.chord, kind, s.fenceBottom);
    const p = transformed(c, y, s.xLocal, zLocal);
    zs.push(p[2]);
    const surfId = mesh.v(p[0], p[1], p[2]);
    surf.push(surfId);
    // A vertical fence wall has two different face points with the same world x.
    // Their back points must stay distinct or the wall edge disappears. Collapsed
    // lug samples share one face point and should keep a single back point.
    let bx = p[0];
    let id = mesh.v(bx, p[1], backZ);
    let guard = 0;
    while (backOwner.has(id) && backOwner.get(id) !== surfId && guard < 6) {
      bx += 0.0002;
      id = mesh.v(bx, p[1], backZ);
      guard++;
    }
    backOwner.set(id, surfId);
    back.push(id);
  }
  return { y, surf, back, iL: built.iL, iR: built.iR, zs, xs: built.xs, ear: built.ear };
}

function loftChain(mesh, A, B, chain, aOn, bOn, holeBoth) {
  const wall = (rowA, rowB, i) => mesh.quad(rowA.surf[i], rowA.back[i], rowB.back[i], rowB.surf[i]);
  if (aOn && bOn) {
    for (let k = 0; k < chain.length - 1; k++) {
      const i = chain[k], j = chain[k + 1];
      if (holeBoth && k === 1) {
        wall(A, B, i);
        wall(B, A, j);
        continue;
      }
      mesh.quad(A.surf[i], A.surf[j], B.surf[j], B.surf[i]);
      mesh.quad(A.back[i], B.back[i], B.back[j], A.back[j]);
    }
    wall(A, B, chain[0]);
    return;
  }
  if (!aOn && !bOn) {
    wall(A, B, chain[0]);
    return;
  }
  const active = aOn ? A : B;
  const other = aOn ? B : A;
  capStrip(mesh, chain.map(i => active.surf[i]), chain.map(i => active.back[i]));
  const side = chain[chain.length - 1];
  wall(other, active, side);
}

function loftRows(mesh, rows, iL, iR, voidTest) {
  for (let r = 0; r < rows.length - 1; r++) {
    const A = rows[r], B = rows[r + 1];
    const n = A.surf.length;
    const isVoid = voidTest(A.y, B.y);
    const earN = A.ear ? 3 : 0;
    for (let i = 0; i < n - 1; i++) {
      if (earN && (i < earN || i >= n - 1 - earN)) continue;
      const inGap = i >= iL && i < iR;
      if (isVoid && inGap) continue;
      mesh.quad(A.surf[i], A.surf[i + 1], B.surf[i + 1], B.surf[i]);
      mesh.quad(A.back[i], B.back[i], B.back[i + 1], A.back[i + 1]);
    }
    if (A.ear && B.ear) {
      loftChain(mesh, A, B, [0, 1, 2, 3], A.ear.leftOn, B.ear.leftOn, A.ear.leftHole || B.ear.leftHole);
      loftChain(mesh, A, B, [n - 1, n - 2, n - 3, n - 4], A.ear.rightOn, B.ear.rightOn, A.ear.rightHole || B.ear.rightHole);
    } else {
      mesh.quad(A.surf[0], A.back[0], B.back[0], B.surf[0]);
      mesh.quad(A.surf[n - 1], B.surf[n - 1], B.back[n - 1], A.back[n - 1]);
    }
    if (isVoid) {
      mesh.quad(A.surf[iL], B.surf[iL], B.back[iL], A.back[iL]);
      mesh.quad(A.surf[iR], A.back[iR], B.back[iR], B.surf[iR]);
    }
  }
}

function ringLeft(row) {
  const ids = [];
  for (let i = 0; i <= row.iL; i++) ids.push(row.surf[i]);
  for (let i = row.iL; i >= 0; i--) ids.push(row.back[i]);
  return ids;
}
function ringRight(row) {
  const ids = [];
  for (let i = row.iR; i < row.surf.length; i++) ids.push(row.surf[i]);
  for (let i = row.surf.length - 1; i >= row.iR; i--) ids.push(row.back[i]);
  return ids;
}
function ringFull(row) {
  const ids = [];
  for (let i = 0; i < row.surf.length; i++) ids.push(row.surf[i]);
  for (let i = row.back.length - 1; i >= 0; i--) ids.push(row.back[i]);
  return ids;
}
function ringMiddle(row) {
  const ids = [];
  for (let i = row.iL; i <= row.iR; i++) ids.push(row.surf[i]);
  for (let i = row.iR; i >= row.iL; i--) ids.push(row.back[i]);
  return ids;
}

function segmentPlans(c) {
  const segs = c.printableSegments;
  const joint = effectiveJoint(c);
  const split = segs.length > 1;
  return segs.map((seg, index) => {
    const hasStart = split && index > 0;
    const hasEnd = split && index < segs.length - 1;
    const yTongue0 = seg.end;
    const yTongue1 = seg.end + (hasEnd ? jointDepthMm(station(c, seg.end).chord, joint) : 0);
    const maleEnv = faceEnvelope(c, seg.start, seg.end, 'upper');
    const femaleEnv = faceEnvelope(c, seg.start, seg.end, 'lower');
    // Tongue lives in the next segment's span; include it so the back clears the tongue face.
    if (hasEnd) {
      const extraM = faceEnvelope(c, yTongue0, yTongue1, 'upper');
      const extraF = faceEnvelope(c, yTongue0, yTongue1, 'lower');
      // The tongue uses the NEXT segment's back, not this one. Don't expand this segment's bulk
      // with the tongue. Bulk envelope stays on [start, end].
      void extraM; void extraF;
    }
    return {
      ...seg,
      index,
      hasStart,
      hasEnd,
      male: {
        ownBase: maleEnv.minZ - c.moldBackThickness,
        ownMax: maleEnv.maxZ,
        minZ: maleEnv.minZ,
        maxZ: maleEnv.maxZ
      },
      female: {
        ownCap: femaleEnv.maxZ + c.moldBackThickness,
        ownMin: femaleEnv.minZ,
        minZ: femaleEnv.minZ,
        maxZ: femaleEnv.maxZ
      }
    };
  });
}

function backAt(kind, y, seg, plans, c) {
  const mine = kind === 'upper' ? seg.male : seg.female;
  const own = kind === 'upper' ? mine.ownBase : mine.ownCap;
  if (!seg.hasEnd) return own;
  const next = plans[seg.index + 1];
  const nextPlane = kind === 'upper' ? next.male.ownBase : next.female.ownCap;
  const depth = seg.hasStart ? jointDepthMm(station(c, seg.start).chord, effectiveJoint(c, 'mold')) : 0;
  const trans = Math.min(36, Math.max(14, (seg.end - seg.start) * 0.12));
  let y0 = seg.end - trans;
  if (seg.hasStart) y0 = Math.max(y0, seg.start + depth + 2);
  if (y <= y0) return own;
  const t = smoothstep((y - y0) / Math.max(1e-6, seg.end - y0));
  return interp(own, nextPlane, t);
}

function profileFor(c, seamY) {
  const joint = effectiveJoint(c, 'mold');
  const chord = station(c, seamY).chord;
  const profile = seamProfile(joint, chord);
  profile.y0 = seamY;
  return profile;
}

/**
 * Build one mold segment.
 * kind: 'lower' | 'upper'
 */
export function buildSegmentMesh(c, segmentIndex, kind) {
  const plans = segmentPlans(c);
  const seg = plans[segmentIndex];
  const mesh = new MeshBuilder();
  const warnings = [];
  const hasJoint = seg.hasStart || seg.hasEnd;
  const socketProfile = seg.hasStart ? profileFor(c, seg.start) : null;
  const tongueProfile = seg.hasEnd ? profileFor(c, seg.end) : null;
  const startDepth = socketProfile ? socketProfile.depth : 0;
  const endDepth = tongueProfile ? tongueProfile.depth : 0;

  const centers = c.clampEnabled ? lugCenters(seg) : null;
  const ys = collectYs(c, seg, startDepth);
  let clamped = false;
  const rows = ys.map(y => {
    const split = hasJoint ? spacingSplit(c, y, seg, tongueProfile, socketProfile) : null;
    if (split?.clamped) clamped = true;
    // Plane first, then push it clear of this row's samples while keeping the seam value exact.
    let plane = backAt(kind === 'lower' ? 'lower' : 'upper', y, seg, plans, c);
    const probe = buildXList(c, y, kind, split, centers);
    let minZ = Infinity, maxZ = -Infinity;
    for (const s of probe.xs) {
      const st = station(c, y);
      const zLocal = faceLocalZ(c, y, s.xLocal, st.chord, kind, s.fenceBottom);
      const p = transformed(c, y, s.xLocal, zLocal);
      minZ = Math.min(minZ, p[2]);
      maxZ = Math.max(maxZ, p[2]);
    }
    if (kind === 'upper') {
      const safe = minZ - c.moldBackThickness;
      if (!(seg.hasEnd && Math.abs(y - seg.end) < 1e-6)) plane = Math.min(plane, safe);
      else plane = Math.min(plane, safe);
    } else {
      const safe = maxZ + c.moldBackThickness;
      plane = Math.max(plane, safe);
    }
    return makeRow(mesh, c, y, kind, split, plane, centers);
  });

  const iL = rows[0].iL;
  const iR = rows[0].iR;
  const voidTest = (ya, yb) => seg.hasStart && (ya + yb) / 2 < seg.start + startDepth - 1e-6;
  loftRows(mesh, rows, iL, iR, voidTest);

  if (!seg.hasStart) capStrip(mesh, rows[0].surf, rows[0].back);
  else {
    capStrip(mesh, rows[0].surf.slice(0, iL + 1), rows[0].back.slice(0, iL + 1));
    capStrip(mesh, rows[0].surf.slice(iR), rows[0].back.slice(iR));
  }

  // Socket end wall on the row that sits at start+depth.
  if (seg.hasStart) {
    let endRow = rows[0];
    for (const row of rows) if (Math.abs(row.y - (seg.start + startDepth)) < 1e-3) endRow = row;
    capStrip(mesh, endRow.surf.slice(iL, iR + 1), endRow.back.slice(iL, iR + 1));
  }

  if (!seg.hasEnd) capStrip(mesh, rows[rows.length - 1].surf, rows[rows.length - 1].back);
  else {
    const endRow = rows[rows.length - 1];
    capStrip(mesh, endRow.surf.slice(0, iL + 1), endRow.back.slice(0, iL + 1));
    capStrip(mesh, endRow.surf.slice(iR), endRow.back.slice(iR));
    // Tongue shares the end-row middle vertices and grows to end+depth.
    const tRows = [endRow];
    const next = plans[seg.index + 1];
    const plane = kind === 'upper' ? next.male.ownBase : next.female.ownCap;
    // Force the body end plane to the mating plane. Rebuild is unnecessary if backAt already
    // returns it; the tongue uses `plane` exactly so the socket (next.own) matches.
    for (const y of tongueYs(seg.end, endDepth)) {
      const edges = jointEdgesAt(c, y, tongueProfile, 'tongue');
      if (edges.clamped) clamped = true;
      tRows.push(makeRow(mesh, c, y, kind, { xL: edges.xL, xR: edges.xR }, plane, centers));
    }
    // Loft tongue middle only.
    for (let r = 0; r < tRows.length - 1; r++) {
      const A = tRows[r], B = tRows[r + 1];
      for (let i = iL; i < iR; i++) {
        mesh.quad(A.surf[i], A.surf[i + 1], B.surf[i + 1], B.surf[i]);
        mesh.quad(A.back[i], B.back[i], B.back[i + 1], A.back[i + 1]);
      }
      mesh.quad(A.surf[iL], B.surf[iL], B.back[iL], A.back[iL]);
      mesh.quad(A.surf[iR], A.back[iR], B.back[iR], B.surf[iR]);
    }
    const tip = tRows[tRows.length - 1];
    capStrip(mesh, tip.surf.slice(iL, iR + 1), tip.back.slice(iL, iR + 1));
  }

  if (clamped) {
    warnings.push('鳩尾凹槽在這個間隙下會穿出模具外皮，已限制寬度。請減小單側間隙或鳩尾寬度百分比。');
  }

  const built = finalizeMesh(mesh.pos, mesh.idx);

  const stats = measure(built.positions);
  const mating = matingPlane(kind, seg, plans);
  return {
    positions: built.positions,
    indices: built.indices,
    warnings,
    kind,
    segmentIndex,
    height: stats.maxZ - stats.minZ,
    minZ: stats.minZ,
    maxZ: stats.maxZ,
    mating,
    clamped
  };
}

function matingPlane(kind, seg, plans) {
  if (!seg.hasEnd) {
    return kind === 'upper' ? seg.male.ownBase : seg.female.ownCap;
  }
  const next = plans[seg.index + 1];
  return kind === 'upper' ? next.male.ownBase : next.female.ownCap;
}

function measure(pos) {
  let minZ = Infinity, maxZ = -Infinity, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    minX = Math.min(minX, pos[i]); maxX = Math.max(maxX, pos[i]);
    minY = Math.min(minY, pos[i + 1]); maxY = Math.max(maxY, pos[i + 1]);
    minZ = Math.min(minZ, pos[i + 2]); maxZ = Math.max(maxZ, pos[i + 2]);
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

export function meshAnalysis(positions, indices) {
  const pos = positions;
  const idx = indices;
  const edge = new Map();
  const key = (a, b) => (a < b ? a + '_' + b : b + '_' + a);
  let degenerates = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i], b = idx[i + 1], c = idx[i + 2];
    if (triArea(pos, a, b, c) < 1e-12) degenerates++;
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const k = key(u, v);
      edge.set(k, (edge.get(k) || 0) + 1);
    }
  }
  let open = 0, nonManifold = 0;
  for (const n of edge.values()) {
    if (n === 1) open++;
    else if (n > 2) nonManifold++;
  }
  // Connected components via vertex adjacency of triangles.
  const parent = new Uint32Array(pos.length / 3);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (a) => {
    while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
    return a;
  };
  const unite = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
  for (let i = 0; i < idx.length; i += 3) {
    unite(idx[i], idx[i + 1]);
    unite(idx[i], idx[i + 2]);
  }
  const roots = new Set();
  const used = new Set();
  for (let i = 0; i < idx.length; i++) used.add(idx[i]);
  for (const v of used) roots.add(find(v));
  const vol = volumeOf(pos, idx);
  return {
    triangles: idx.length / 3,
    vertices: pos.length / 3,
    openEdges: open,
    nonManifoldEdges: nonManifold,
    components: roots.size,
    volume: vol,
    degenerates,
    watertight: open === 0 && nonManifold === 0 && roots.size === 1 && vol > 0
  };
}

export function buildMold(c, segmentIndex, kind) {
  const mesh = buildSegmentMesh(c, segmentIndex, kind);
  return mesh;
}
