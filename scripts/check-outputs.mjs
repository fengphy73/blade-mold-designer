import { writeFileSync, mkdirSync } from 'fs';
import { defaultConfig, validateConfig, worldToLocal, station } from '../js/model.js';
import { effectiveJoint, seamProfile, widthAt } from '../js/joint.js';
import { buildMold, meshAnalysis } from '../js/mesh.js';
import { meshToStl } from '../js/stl.js';

const config = validateConfig(defaultConfig());
const joint = effectiveJoint(config);
const segments = config.printableSegments;
console.log('segments', segments.length, segments.map(s => `${s.start.toFixed(1)}-${s.end.toFixed(1)}`).join(', '));
console.log('joint', joint);

if (segments.length !== 2) {
  console.error('FAIL: default parameters should produce 2 segments');
  process.exit(1);
}

const outDir = new URL('../tmp-output/', import.meta.url);
mkdirSync(outDir, { recursive: true });

const parts = [];
let failed = false;
for (let i = 0; i < segments.length; i++) {
  for (const kind of ['lower', 'upper']) {
    const mesh = buildMold(config, i, kind);
    const name = kind === 'lower' ? `lower-concave-mold-${String(i + 1).padStart(2, '0')}` : `upper-convex-mold-${String(i + 1).padStart(2, '0')}`;
    const analysis = meshAnalysis(mesh.positions, mesh.indices);
    const info = {
      file: `${name}.stl`,
      kind,
      segment: i + 1,
      height: mesh.height,
      minZ: mesh.minZ,
      maxZ: mesh.maxZ,
      ...analysis,
      warnings: mesh.warnings
    };
    parts.push(info);
    console.log(JSON.stringify(info, null, 0));
    if (!analysis.watertight) failed = true;
    writeFileSync(new URL(info.file, outDir), Buffer.from(meshToStl(mesh, name)));
  }
}

// Clearance: socket full width − tongue full width == 2 * per-side clearance, on the mesh walls.
const seam = segments[0].end;
const profile = seamProfile(joint, station(config, seam).chord);
profile.y0 = seam;
const tongue = buildMold(config, 0, 'upper');
const socket = buildMold(config, 1, 'upper');
const samples = [2, 4, 8, 12, 16].map(i => i / 18);
console.log('\nClearance samples (upper molds, local chord width):');
let clearanceOk = true;
for (const t of samples) {
  const y = seam + t * joint.depth;
  const chord = station(config, y).chord;
  const expectTongue = widthAt(profile, t, chord, 'tongue');
  const expectSocket = widthAt(profile, t, chord, 'socket');
  const tw = measureWallWidth(config, tongue, y, 'tongue');
  const sw = measureWallWidth(config, socket, y, 'socket');
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
const used = effectiveJoint(custom);
if (used.clearance !== 0.4 || used.width !== 12 || used.depth !== 4 || used.angle !== 45) {
  console.error('FAIL: advanced-off should keep recommended dovetail defaults');
  failed = true;
} else console.log('advanced-off defaults OK', used);

// Tongue and socket share one back plane at the seam (per-segment heights still mate).
const socketMesh = buildMold(config, 1, 'upper');
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
const clamped = validateConfig({ ...defaultConfig(), clampEnabled: true });
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

if (failed) {
  console.error('\nCHECK FAILED');
  process.exit(1);
}
console.log('\nCHECK PASSED');

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
    const near = locals.filter(x => Math.abs(x - center) < 30);
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
