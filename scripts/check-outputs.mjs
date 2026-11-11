import { writeFileSync, mkdirSync } from 'fs';
import { defaultConfig, validateConfig, worldToLocal, station, rawStation } from '../js/model.js';
import { effectiveJoint, seamProfile, widthAt, jointDepthMm } from '../js/joint.js';
import { buildMold, meshAnalysis } from '../js/mesh.js';
import { buildBlade, bladePlans, thickenedSurfaces, unrotateBlade } from '../js/blade.js';
import { meshToStl } from '../js/stl.js';

const config = validateConfig(defaultConfig());
const segments = config.printableSegments;
console.log('default printer', config.printer, 'segments', segments.length, segments.map(s => `${s.start.toFixed(1)}-${s.end.toFixed(1)}`).join(', '));

if (config.printer !== 500 || segments.length !== 1 || segments[0].start !== 0 || segments[0].end !== 450) {
  console.error('FAIL: default printer 500 should be one segment, 0–450 mm');
  process.exit(1);
}

function boundsOf(mesh) {
  const p = mesh.positions;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    minX = Math.min(minX, p[i]); maxX = Math.max(maxX, p[i]);
    minY = Math.min(minY, p[i + 1]); maxY = Math.max(maxY, p[i + 1]);
    minZ = Math.min(minZ, p[i + 2]); maxZ = Math.max(maxZ, p[i + 2]);
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

let failed = false;
console.log('default mold (printer 500, one piece):');
for (const kind of ['lower', 'upper']) {
  const mesh = buildMold(config, 0, kind);
  const analysis = meshAnalysis(mesh.positions, mesh.indices);
  const b = boundsOf(mesh);
  const name = kind === 'lower' ? 'lower-concave-mold-01.stl' : 'upper-convex-mold-01.stl';
  console.log(JSON.stringify({
    file: name, segments: 1, watertight: analysis.watertight,
    openEdges: analysis.openEdges, nonManifoldEdges: analysis.nonManifoldEdges,
    components: analysis.components, volume: +analysis.volume.toFixed(3),
    bbox: `X ${b.minX.toFixed(2)}–${b.maxX.toFixed(2)} Y ${b.minY.toFixed(2)}–${b.maxY.toFixed(2)} Z ${b.minZ.toFixed(2)}–${b.maxZ.toFixed(2)}`
  }));
  if (!analysis.watertight || analysis.volume <= 0 || b.maxY > 450.05 || b.minY < -0.05) failed = true;
}

const splitConfig = validateConfig({ ...defaultConfig(), printer: 250 });
const joint = effectiveJoint(splitConfig);
const splitSegments = splitConfig.printableSegments;
console.log('printer=250 segments', splitSegments.length, splitSegments.map(s => `${s.start.toFixed(1)}-${s.end.toFixed(1)}`).join(', '));
console.log('joint', joint);
if (splitSegments.length !== 2) {
  console.error('FAIL: printer 250 should still split into 2 dovetail segments');
  process.exit(1);
}

const outDir = new URL('../tmp-output/', import.meta.url);
mkdirSync(outDir, { recursive: true });

const parts = [];
for (let i = 0; i < splitSegments.length; i++) {
  for (const kind of ['lower', 'upper']) {
    const mesh = buildMold(splitConfig, i, kind);
    const name = kind === 'lower' ? `lower-concave-mold-${String(i + 1).padStart(2, '0')}` : `upper-convex-mold-${String(i + 1).padStart(2, '0')}`;
    const analysis = meshAnalysis(mesh.positions, mesh.indices);
    const b = boundsOf(mesh);
    const span = b.maxY - b.minY;
    const info = {
      file: `${name}.stl`,
      kind,
      segment: i + 1,
      height: mesh.height,
      minZ: mesh.minZ,
      maxZ: mesh.maxZ,
      bbox: `X ${b.minX.toFixed(2)}–${b.maxX.toFixed(2)} Y ${b.minY.toFixed(2)}–${b.maxY.toFixed(2)} Z ${b.minZ.toFixed(2)}–${b.maxZ.toFixed(2)}`,
      spanY: +span.toFixed(2),
      fitsPrinter: span <= splitConfig.printer + 0.05,
      ...analysis,
      warnings: mesh.warnings
    };
    parts.push(info);
    console.log(JSON.stringify(info, null, 0));
    if (!analysis.watertight) failed = true;
    if (span > splitConfig.printer + 0.05) {
      console.error(`FAIL: mold segment ${i + 1} ${kind} is ${span.toFixed(2)} mm, longer than printer ${splitConfig.printer}`);
      failed = true;
    }
    writeFileSync(new URL(info.file, outDir), Buffer.from(meshToStl(mesh, name)));
  }
}

// Clearance: socket full width − tongue full width == 2 * per-side clearance, on the mesh walls.
const seam = splitSegments[0].end;
const profile = seamProfile(joint, station(splitConfig, seam).chord);
profile.y0 = seam;
const tongue = buildMold(splitConfig, 0, 'upper');
const socket = buildMold(splitConfig, 1, 'upper');
const samples = [2, 4, 8, 12, 16].map(i => i / 18);
console.log('\nClearance samples (upper molds, local chord width):');
let clearanceOk = true;
for (const t of samples) {
  const y = seam + t * profile.depth;
  const expectTongue = widthAt(profile, t, 'tongue');
  const expectSocket = widthAt(profile, t, 'socket');
  const tw = measureWallWidth(splitConfig, tongue, y, 'tongue');
  const sw = measureWallWidth(splitConfig, socket, y, 'socket');
  const delta = sw.width - tw.width;
  const row = {
    t, y: +y.toFixed(3),
    expectTongue: +expectTongue.toFixed(4),
    meshTongue: +tw.width.toFixed(4),
    expectSocket: +expectSocket.toFixed(4),
    meshSocket: +sw.width.toFixed(4),
    delta: +delta.toFixed(4),
    expectDelta: +(2 * joint.clearance).toFixed(4)
  };
  console.log(JSON.stringify(row));
  if (Math.abs(delta - 2 * joint.clearance) > 0.02) clearanceOk = false;
  if (Math.abs(tw.width - expectTongue) > 0.05) clearanceOk = false;
  if (Math.abs(sw.width - expectSocket) > 0.05) clearanceOk = false;
}

console.log(clearanceOk ? '\nCLEARANCE OK' : '\nCLEARANCE FAIL');
if (!clearanceOk) failed = true;

// Manual values must be ignored when the advanced option is off.
const custom = validateConfig({ ...defaultConfig(), jointManual: false, jointClearance: 1.2, jointWidth: 20, jointDepth: 6, jointAngle: 30 });
const used = effectiveJoint(custom, 'mold');
const usedBlade = effectiveJoint(custom, 'blade');
if (used.clearance !== 0.1 || used.widthPercent !== 55 || used.depthPercent !== 16 || used.faceAngle !== 60
  || usedBlade.widthPercent !== 50) {
  console.error('FAIL: advanced-off should keep recommended dovetail defaults', used, usedBlade);
  failed = true;
} else console.log('advanced-off defaults OK', used, usedBlade);

// Tongue and socket share one back plane at the seam (per-segment heights still mate).
const socketMesh = buildMold(splitConfig, 1, 'upper');
let tongueMin = Infinity;
for (let i = 0; i < tongue.positions.length; i += 3) {
  if (tongue.positions[i + 1] > seam + 0.2) tongueMin = Math.min(tongueMin, tongue.positions[i + 2]);
}
const mateDelta = Math.abs(tongueMin - socketMesh.minZ);
console.log('seam back z tongue', tongueMin.toFixed(3), 'socket', socketMesh.minZ.toFixed(3), 'delta', mateDelta.toFixed(4));
if (mateDelta > 0.05) {
  console.error('FAIL: tongue and socket backs do not mate');
  failed = true;
}

// M3 lugs stay fused into the same shell.
const clamped = validateConfig({ ...defaultConfig(), printer: 250, clampEnabled: true });
for (let i = 0; i < 2; i++) {
  for (const kind of ['lower', 'upper']) {
    const mesh = buildMold(clamped, i, kind);
    const analysis = meshAnalysis(mesh.positions, mesh.indices);
    console.log('lug', kind, i + 1, analysis.watertight ? 'OK' : 'FAIL', 'open', analysis.openEdges, 'components', analysis.components);
    if (!analysis.watertight) failed = true;
  }
}

// A blade that fits the printer is one solid with no tongue.
const onePiece = validateConfig({
  ...defaultConfig(),
  stations: [
    { y: 0, chord: 73, twist: 0 },
    { y: 180, chord: 60, twist: 8 }
  ]
});
if (onePiece.printableSegments.length !== 1) {
  console.error('FAIL: short blade should be one piece');
  failed = true;
} else {
  const mesh = buildMold(onePiece, 0, 'lower');
  const analysis = meshAnalysis(mesh.positions, mesh.indices);
  let maxY = -Infinity;
  for (let i = 1; i < mesh.positions.length; i += 3) maxY = Math.max(maxY, mesh.positions[i]);
  console.log('one-piece', analysis.watertight ? 'OK' : 'FAIL', 'maxY', maxY.toFixed(2));
  if (!analysis.watertight || maxY > 180.05) failed = true;
}

// printer=500 fits the default 450 mm blade in one piece, with no dovetail.
const longBed = validateConfig({ ...defaultConfig(), printer: 500 });
const longSegs = longBed.printableSegments;
console.log('printer=500 segments', longSegs.length, longSegs.map(s => `${s.start.toFixed(1)}-${s.end.toFixed(1)}`).join(', '));
if (longSegs.length !== 1 || longSegs[0].start !== 0 || longSegs[0].end !== 450) {
  console.error('FAIL: printer=500 with default stations should be one segment, 0–450 mm');
  failed = true;
} else {
  for (const kind of ['lower', 'upper']) {
    const mesh = buildMold(longBed, 0, kind);
    const analysis = meshAnalysis(mesh.positions, mesh.indices);
    let minY = Infinity, maxY = -Infinity;
    for (let i = 1; i < mesh.positions.length; i += 3) {
      minY = Math.min(minY, mesh.positions[i]);
      maxY = Math.max(maxY, mesh.positions[i]);
    }
    console.log(JSON.stringify({
      printer: 500,
      kind,
      height: +mesh.height.toFixed(3),
      minZ: +mesh.minZ.toFixed(3),
      maxZ: +mesh.maxZ.toFixed(3),
      minY: +minY.toFixed(3),
      maxY: +maxY.toFixed(3),
      openEdges: analysis.openEdges,
      nonManifoldEdges: analysis.nonManifoldEdges,
      volume: +analysis.volume.toFixed(3),
      watertight: analysis.watertight
    }));
    if (!analysis.watertight || analysis.volume <= 0 || maxY > 450.05 || minY < -0.05) failed = true;
  }
}

reportSeams('mold printer=250', splitConfig, 'mold');
reportSeams('blade printer=250', splitConfig, 'blade');
failed = checkPrintedBlades(splitConfig, 250) || failed;
failed = checkPrintedBlades(config, 500) || failed;

function reportSeams(label, c, mode) {
  const joint = effectiveJoint(c, mode);
  const segs = c.printableSegments;
  console.log(`\n${label}`);
  if (segs.length < 2) {
    console.log('one piece, no seam');
    return;
  }
  for (let i = 0; i < segs.length - 1; i++) {
    const y = segs[i].end;
    const chord = (mode === 'blade' ? rawStation : station)(c, y).chord;
    const profile = seamProfile(joint, chord);
    const body = segs[i].end - segs[i].start;
    const row = {
      seam: i + 1,
      y: +y.toFixed(2),
      chord: +chord.toFixed(2),
      head: +profile.head.toFixed(2),
      neck: +profile.neck.toFixed(2),
      depth: +profile.depth.toFixed(2),
      clearance: profile.clearance,
      centerFraction: profile.centerFraction,
      headFromLead: `${((profile.center - profile.head / 2) / chord * 100).toFixed(1)}%–${((profile.center + profile.head / 2) / chord * 100).toFixed(1)}%`,
      bodyPlusTongue: +(body + profile.depth).toFixed(2),
      printer: c.printer
    };
    if (mode === 'blade') {
      const fit = bladePlans(c)[i].fit;
      row.edgeThick = fit ? fit.edgeThick.map(v => +v.toFixed(2)) : null;
      row.minAirfoilAtHead = fit ? +fit.minThick.toFixed(2) : null;
      row.butt = !fit;
    }
    console.log(JSON.stringify(row));
    if (body + jointDepthMm(chord, joint) > c.printer + 0.05) {
      console.error('FAIL: segment with tongue exceeds printer');
      failed = true;
    }
    if (profile.neck < profile.head * 0.3 - 1e-6) {
      console.error('FAIL: neck narrower than 30% of head');
      failed = true;
    }
  }
}

if (failed) {
  console.error('\nCHECK FAILED');
  process.exit(1);
}
console.log('\nCHECK PASSED');

function checkPrintedBlades(c, printer) {
  const plans = bladePlans(c);
  const expected = printer >= 450 ? 1 : 2;
  console.log(`blade printer=${printer} segments`, plans.length, plans.map(s => `${s.start.toFixed(1)}-${s.end.toFixed(1)} ${s.hasEnd || s.hasStart ? 'dovetail' : s.butt ? 'butt' : 'none'}`).join(', '));
  if (plans.length !== expected) {
    console.error(`FAIL: printer=${printer} should produce ${expected} blade segment(s)`);
    return true;
  }
  let bad = false;
  const meshes = plans.map((_, i) => buildBlade(c, i));
  for (const mesh of meshes) {
    const analysis = meshAnalysis(mesh.positions, mesh.indices);
    console.log(JSON.stringify({
      blade: true,
      printer,
      segment: mesh.segmentIndex + 1,
      joint: mesh.joint,
      chord: `${mesh.chordStart.toFixed(1)}→${mesh.chordEnd.toFixed(1)}`,
      twist: `${mesh.twistStart.toFixed(1)}→${mesh.twistEnd.toFixed(1)}`,
      size: `X ${(mesh.maxX - mesh.minX).toFixed(2)} Y ${(mesh.maxY - mesh.minY).toFixed(2)} Z ${mesh.height.toFixed(2)}`,
      y: `${mesh.minY.toFixed(2)}–${mesh.maxY.toFixed(2)}`,
      fitsPrinter: (mesh.maxY - mesh.minY) <= printer + 0.05,
      openEdges: analysis.openEdges,
      nonManifoldEdges: analysis.nonManifoldEdges,
      components: analysis.components,
      volume: +analysis.volume.toFixed(3),
      watertight: analysis.watertight
    }));
    if (!analysis.watertight || analysis.volume <= 0 || analysis.components !== 1) bad = true;
    if (mesh.maxY - mesh.minY > printer + 0.05) {
      console.error(`FAIL: blade segment ${mesh.segmentIndex + 1} is ${(mesh.maxY - mesh.minY).toFixed(2)} mm, longer than printer ${printer}`);
      bad = true;
    }
  }
  let minTe = Infinity;
  for (const y of [0, 75, 150, 225, 300, 375, 450]) {
    const chord = rawStation(c, y).chord;
    for (let i = 0; i <= 12; i++) {
      const u = 0.9 + 0.1 * i / 12;
      minTe = Math.min(minTe, thickenedSurfaces(u, chord, c.teMinThickness).thick);
    }
  }
  for (const mesh of meshes) {
    const ys = new Set();
    for (let i = 1; i < mesh.positions.length; i += 3) ys.add(mesh.positions[i].toFixed(2));
    for (const yText of [...ys].filter((_, i) => i % 12 === 0)) {
      const y = Number(yText);
      if (y < plans[mesh.segmentIndex].start - 0.01 || y > plans[mesh.segmentIndex].end + 0.01) continue;
      const chord = rawStation(c, y).chord;
      const zs = [];
      for (let i = 0; i < mesh.positions.length; i += 3) {
        if (Math.abs(mesh.positions[i + 1] - y) > 1e-3) continue;
        const loc = unrotateBlade(c, mesh.positions[i + 1], mesh.positions[i], mesh.positions[i + 2] + mesh.zShift);
        if (loc.xLocal >= chord - 0.35) zs.push(loc.zLocal);
      }
      if (zs.length >= 2) minTe = Math.min(minTe, Math.max(...zs) - Math.min(...zs));
    }
  }
  console.log(`blade printer=${printer} min TE`, minTe.toFixed(4));
  if (!(minTe >= c.teMinThickness - 1e-6)) bad = true;
  if (expected === 2 && meshes[0].joint === 'dovetail') {
    const fit = bladePlans(c)[0].fit;
    for (const t of [0.2, 0.5, 0.8]) {
      const y = plans[0].end + t * fit.depth;
      const expectT = widthAt(fit.profile, t, 'tongue') * fit.scale;
      const widthAtY = (mesh) => {
        const top = [];
        for (let i = 0; i < mesh.positions.length; i += 3) {
          if (Math.abs(mesh.positions[i + 1] - y) > 1e-3) continue;
          const loc = unrotateBlade(c, mesh.positions[i + 1], mesh.positions[i], mesh.positions[i + 2] + mesh.zShift);
          if (Math.abs(loc.zLocal - (fit.zMid + fit.halfH)) < 0.02) top.push(loc.xLocal);
        }
        return Math.max(...top) - Math.min(...top);
      };
      const delta = widthAtY(meshes[1]) - widthAtY(meshes[0]);
      console.log(JSON.stringify({ printer, t, tongue: +expectT.toFixed(4), delta: +delta.toFixed(4), expectDelta: +(2 * fit.clearance).toFixed(4) }));
      if (Math.abs(delta - 2 * fit.clearance) > 0.01) bad = true;
    }
  }
  if (expected === 1) {
    if (meshes[0].joint !== 'none' || meshes[0].maxY > 450.05 || meshes[0].minY < -0.05) {
      console.error('FAIL: printer=500 blade should be one piece without a joint');
      bad = true;
    }
  }
  return bad;
}

function measureWallWidth(config, mesh, y, role) {
  const pos = mesh.positions;
  const band = 0.12;
  const raw = [];
  for (let i = 0; i < pos.length; i += 3) {
    const py = pos[i + 1];
    if (Math.abs(py - y) > band) continue;
    raw.push({ x: pos[i], y: py, z: pos[i + 2] });
  }
  if (!raw.length) return { width: NaN, n: 0 };
  // Back-plane vertices share the surface's world x but not its local x.
  // Keep the mold-face vertices, which sit at least a couple of millimetres off the back.
  const minZ = Math.min(...raw.map(p => p.z));
  const face = raw.filter(p => p.z > minZ + 2);
  const locals = face.map(p => worldToLocal(config, p.y, p.x, p.z).xLocal);
  if (!locals.length) return { width: NaN, n: 0 };
  const chord = station(config, y).chord;
  const center = chord / 2;
  if (role === 'tongue') {
    const near = locals.filter(x => Math.abs(x - center) < chord * 0.49);
    return { width: Math.max(...near) - Math.min(...near), n: near.length };
  }
  const xs = [...new Set(locals.map(x => Math.round(x * 500) / 500))].sort((a, b) => a - b);
  let best = null;
  for (let i = 0; i < xs.length - 1; i++) {
    if (xs[i] <= center && xs[i + 1] >= center) {
      const gap = xs[i + 1] - xs[i];
      if (!best || gap > best.gap) best = { gap, xL: xs[i], xR: xs[i + 1] };
    }
  }
  return { width: best ? best.gap : NaN, n: locals.length };
}
