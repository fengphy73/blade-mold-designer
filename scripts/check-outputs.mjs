import { writeFileSync, mkdirSync } from 'fs';
import { defaultConfig, validateConfig, worldToLocal, station, rawStation, bladeSvgStart } from '../js/model.js';
import { effectiveJoint, seamProfile, widthAt, jointDepthMm } from '../js/joint.js';
import { buildMold, meshAnalysis } from '../js/mesh.js';
import { buildBlade, bladePlans, thickenedSurfaces, unrotateBlade } from '../js/blade.js';
import { meshToStl } from '../js/stl.js';
import { bladePlanformSvg, rootSlitLayers, slitSegments } from '../js/svg-blade.js';
import { configFileText } from '../js/model.js';
import { RS, featureDistance, edgeDistance, featureCutLength, rootSlitWeights, rootSlitSwitchLines, outlinePolygon } from '../js/root-slits.js';
import { paramSets, formLike, hashOutputs } from './output-hashes.mjs';
import { readFileSync } from 'fs';

const config = validateConfig(defaultConfig());
const segments = config.printableSegments;
console.log('default printer', config.printer, 'segments', segments.length, segments.map(s => `${s.start.toFixed(1)}-${s.end.toFixed(1)}`).join(', '));

if (config.printer !== 500 || segments.length !== 1 || segments[0].start !== 0 || segments[0].end !== 450) {
  console.error('FAIL: default printer 500 should be one segment, 0–450 mm');
  process.exit(1);
}
if (!config.rootPadEnabled || config.rootPadLength !== 30 || config.rootBlendLength !== 5) {
  console.error('FAIL: root pad should default on, length 30 mm, blend 5 mm');
  process.exit(1);
}
const svg = bladePlanformSvg(config);
if (bladeSvgStart(config) !== 35 || !svg.includes('SVG 葉片長 415.000 mm，從距圓心 35.000 mm 延伸至 450.000 mm')) {
  console.error('FAIL: default laser SVG should start at 35 mm and be 415 mm long');
  process.exit(1);
}
console.log('default root pad on; laser SVG outline 35–450 mm (415 mm)');

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
  if (!analysis.watertight || analysis.volume <= 0 || analysis.components !== 1 || b.maxY > 450.05 || b.minY < -0.05) failed = true;
}

const padOff = validateConfig({ ...defaultConfig(), rootPadEnabled: false });
console.log('rootPadEnabled=false (v1.2 geometry still builds):');
if (padOff.rootPadEnabled || bladeSvgStart(padOff) !== 0) {
  console.error('FAIL: rootPadEnabled=false should stay off and keep the laser outline from y=0');
  failed = true;
}
const padOffSvg = bladePlanformSvg(padOff);
if (!padOffSvg.includes('SVG 葉片長 450.000 mm，從距圓心 0.000 mm 延伸至 450.000 mm')) {
  console.error('FAIL: rootPadEnabled=false laser SVG should be the full 450 mm');
  failed = true;
}
for (const kind of ['lower', 'upper']) {
  const mesh = buildMold(padOff, 0, kind);
  const analysis = meshAnalysis(mesh.positions, mesh.indices);
  const b = boundsOf(mesh);
  console.log(JSON.stringify({
    rootPadEnabled: false,
    file: kind === 'lower' ? 'lower-concave-mold-01.stl' : 'upper-convex-mold-01.stl',
    watertight: analysis.watertight,
    components: analysis.components,
    volume: +analysis.volume.toFixed(3),
    bbox: `X ${b.minX.toFixed(2)}–${b.maxX.toFixed(2)} Y ${b.minY.toFixed(2)}–${b.maxY.toFixed(2)} Z ${b.minZ.toFixed(2)}–${b.maxZ.toFixed(2)}`
  }));
  if (!analysis.watertight || analysis.volume <= 0 || analysis.components !== 1) failed = true;
}
const bladeOn = Buffer.from(meshToStl(buildBlade(config, 0), 'blade-full-01'));
const bladeOff = Buffer.from(meshToStl(buildBlade(padOff, 0), 'blade-full-01'));
console.log('blade-full-01.stl bytes', bladeOn.length, bladeOn.equals(bladeOff) ? 'identical with root pad on or off' : 'DIFFER');
if (!bladeOn.equals(bladeOff)) {
  console.error('FAIL: full-blade STL must be unchanged by the root-pad default (rawStation)');
  failed = true;
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

// ---------------------------------------------------------------------------
// v1.3.0 葉根割線模式
// ---------------------------------------------------------------------------
console.log('\n=== v1.3.0 root-slit modes ===');
let rsTests = 0;
const rsFail = msg => { console.error('FAIL: ' + msg); failed = true; };
const rsCheck = (ok, msg) => { rsTests++; if (!ok) rsFail(msg); };
const reference = JSON.parse(readFileSync(new URL('./fixtures/v1.2.2-hashes.json', import.meta.url), 'utf8'));
const hashMods = { validateConfig, buildMold, buildBlade, bladePlans, meshToStl, bladePlanformSvg, configText: configFileText };
const ROOT_DEFAULTS = { rootSlitMode: 'off', rootSlitTheta1: 23, rootSlitTheta2: 42, rootSlitBand: 15 };
const sets = paramSets();
rsCheck(sets.length === reference.length, 'v1.2.2 reference set count');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
for (let i = 0; i < sets.length; i++) {
  const ref = reference[i];
  const off = hashOutputs(hashMods, formLike(defaultConfig(), sets[i].overrides, ROOT_DEFAULTS));
  const oldFile = hashOutputs(hashMods, formLike(defaultConfig(), sets[i].overrides));
  for (const key of ['svg', 'molds', 'blades', 'config']) {
    rsCheck(same(off[key], ref[key]), `[${sets[i].name}] mode off: ${key} differs from v1.2.2`);
    rsCheck(same(oldFile[key], ref[key]), `[${sets[i].name}] old parameter file (no root-slit keys): ${key} differs from v1.2.2`);
  }
  for (const mode of ['A', 'B', 'C']) {
    const on = hashOutputs(hashMods, formLike(defaultConfig(), sets[i].overrides, { ...ROOT_DEFAULTS, rootSlitMode: mode }), { skipConfig: true });
    rsCheck(same(on.molds, ref.molds), `[${sets[i].name}] mode ${mode}: mold STL differs from v1.2.2`);
    rsCheck(same(on.blades, ref.blades), `[${sets[i].name}] mode ${mode}: full-blade STL differs from v1.2.2`);
    rsCheck(on.svg !== ref.svg, `[${sets[i].name}] mode ${mode}: SVG should change`);
  }
  console.log(`byte-for-byte vs v1.2.2 [${sets[i].name}]: off/old-file SVG+STL+params identical; A/B/C STL identical (${ref.molds.length} mold + ${ref.blades.length} blade files)`);
}

function auditLayout(c, label) {
  const layers = rootSlitLayers(c);
  const { m } = rootSlitWeights(c);
  const fullSpan = c.stations.at(-1).y;
  const E = Math.max(RS.edge, c.slitEdgeKeep);
  const stats = { minBridge: Infinity, minEdge: Infinity, overlaps: 0, added: 0, rootCut: 0, totalCut: 0, tipKept: 0 };
  for (const L of layers) {
    const keptSet = new Set(L.kept);
    const all = [...L.kept.map(i => L.existingFeatures[i]), ...L.added];
    const poly = outlinePolygon(c, L.outStart, fullSpan);
    let tipMissing = 0;
    L.existing.forEach((s, i) => {
      const tip = m(s.y) <= 0 && m(s.endY) <= 0 && m((s.y + s.endY) / 2) <= 0;
      if (tip) { stats.tipKept++; if (!keptSet.has(i)) tipMissing++; }
    });
    rsCheck(tipMissing === 0, `${label} layer ${L.layer}: ${tipMissing} tip slits (beyond θ1) changed`);
    for (const f of L.added) {
      rsCheck(m(f.bbox.minY) > 0, `${label} layer ${L.layer}: new ${f.kind} lies beyond θ1 (tip side)`);
      const e = f.edgeOk ? edgeDistance(f, poly, L.outStart + E) : edgeDistance(f, poly);
      stats.minEdge = Math.min(stats.minEdge, e);
      rsCheck(e >= E - 1e-6, `${label} layer ${L.layer}: ${f.kind} only ${e.toFixed(3)} mm from the outline`);
      for (const g of all) {
        if (g === f) continue;
        if (g.bbox.minX > f.bbox.maxX + 3 || f.bbox.minX > g.bbox.maxX + 3 || g.bbox.minY > f.bbox.maxY + 3 || f.bbox.minY > g.bbox.maxY + 3) continue;
        const d = featureDistance(f, g);
        if (d <= 0) stats.overlaps++;
        stats.minBridge = Math.min(stats.minBridge, d);
      }
    }
    rsCheck(stats.overlaps === 0, `${label}: cut lines overlap`);
    rsCheck(stats.minBridge >= RS.bridge - 1e-6, `${label}: bridge ${stats.minBridge.toFixed(3)} mm < ${RS.bridge}`);
    stats.added += L.added.length;
    stats.rootCut += L.added.reduce((a, f) => a + featureCutLength(f), 0);
    stats.totalCut += all.reduce((a, f) => a + featureCutLength(f), 0);
  }
  const svg = bladePlanformSvg(c);
  rsCheck(svg.startsWith('<svg') && svg.endsWith('</svg>') && !svg.includes('NaN') && !svg.includes('Infinity'), `${label}: SVG malformed`);
  return { layers, stats, svg };
}

const modeStats = {};
for (const mode of ['A', 'B', 'C']) {
  const c = validateConfig({ ...defaultConfig(), rootSlitMode: mode });
  const { layers, stats, svg } = auditLayout(c, `default ${mode}`);
  const lines = rootSlitSwitchLines(c);
  rsCheck(lines.theta2.length === 1 && Math.abs(lines.theta2[0].y - 74.8) < 0.01, `default ${mode}: θ2 switch line should be r=74.8`);
  rsCheck(lines.theta1.length === 1 && Math.abs(lines.theta1[0].y - 150.88) < 0.02, `default ${mode}: θ1 switch line should be r≈150.9`);
  const text = mode === 'C'
    ? 'SVG 葉片長 420.000 mm（含葉根修切量 5 mm，壓好後沿藍色修切線 r=35.000 mm 切齊），從距圓心 30.000 mm 延伸至 450.000 mm'
    : 'SVG 葉片長 415.000 mm，從距圓心 35.000 mm 延伸至 450.000 mm';
  rsCheck(svg.includes(text), `default ${mode}: SVG length text`);
  rsCheck(svg.includes(`height="${mode === 'C' ? '440.000' : '435.000'}mm"`), `default ${mode}: SVG height`);
  rsCheck(mode !== 'C' || (svg.match(/TRIM_LINE/g) || []).length === 2, 'default C: one trim line per layer');
  // r=35–110: same features as the v1.3.0 test pieces (blade-root-test-*.svg), counted in 35–107 mm
  const inTest = L => [...L.kept.map(i => L.existingFeatures[i]), ...L.added].filter(f => f.bbox.maxY <= 107 + RS.hole + 1e-6 && f.bbox.minY >= 30 - 1e-6);
  const counts = layers.map(L => inTest(L).length);
  const expected = { A: [94, 86], B: [53, 53], C: [44, 34] }[mode];
  rsCheck(same(counts, expected), `default ${mode}: r=35–110 feature counts ${counts} (expected ${expected})`);
  const cfg = configFileText(c);
  rsCheck(cfg.includes(`"rootSlitMode": "${mode}"`) && cfg.includes('"rootSlitTheta2": 42'), `default ${mode}: parameter file keeps root-slit fields`);
  modeStats[mode] = { switchLines: { theta2: lines.theta2.map(x => +x.y.toFixed(2)), theta1: lines.theta1.map(x => +x.y.toFixed(2)) }, newFeatures: stats.added, minBridge: +stats.minBridge.toFixed(3), minEdge: +stats.minEdge.toFixed(3), rootCutMm: +stats.rootCut.toFixed(1), allSlitsCutMm: +stats.totalCut.toFixed(1), r35to110: counts };
  console.log(`mode ${mode}`, JSON.stringify(modeStats[mode]));
}
rsCheck(!configFileText(validateConfig(defaultConfig())).includes('rootSlit'), 'mode off: parameter file must not contain root-slit keys');

// Clamping and old files
{
  const c = validateConfig({ ...defaultConfig(), rootSlitMode: 'A', rootSlitTheta1: 5, rootSlitTheta2: 80, rootSlitBand: 55 });
  rsCheck(c.rootSlitTheta1 === 10 && c.rootSlitTheta2 === 60 && c.rootSlitBand === 40 && c.rootSlitNotes.length === 3, 'out-of-range θ1/θ2/band should clamp to 10/60/40 with three notes');
  const d = validateConfig({ ...defaultConfig(), rootSlitMode: 'B', rootSlitTheta1: 40, rootSlitTheta2: 30 });
  rsCheck(d.rootSlitTheta2 === 45 && d.rootSlitNotes.some(n => n.includes('θ2 必須大於 θ1')), 'θ2 ≤ θ1 should become θ1 + 5');
  const old = { ...defaultConfig() };
  for (const k of ['rootSlitMode', 'rootSlitTheta1', 'rootSlitTheta2', 'rootSlitBand']) delete old[k];
  const e = validateConfig(old);
  rsCheck(e.rootSlitMode === 'off' && e.rootSlitNotes.length === 0, 'old parameter file without root-slit keys → off, no notes');
  const f = validateConfig({ ...defaultConfig(), rootSlitMode: 'Z' });
  rsCheck(f.rootSlitMode === 'off' && f.rootSlitNotes.length === 1, 'unknown mode → off with a note');
  console.log('root-slit clamping / old-file checks done');
}

// Extreme parameters: must not throw, and all layout rules still hold
const scaleStations = k => defaultConfig().stations.map(s => ({ ...s, chord: +(s.chord * k).toFixed(2) }));
const extremes = [
  ['θ1=10 θ2=25', { rootSlitTheta1: 10, rootSlitTheta2: 25 }],
  ['θ1=45 θ2=60', { rootSlitTheta1: 45, rootSlitTheta2: 60 }],
  ['θ1=44 θ2=45', { rootSlitTheta1: 44, rootSlitTheta2: 45 }],
  ['band 0', { rootSlitBand: 0 }],
  ['band 40', { rootSlitBand: 40 }],
  ['chord ×0.6', { stations: scaleStations(0.6) }],
  ['chord ×1.4', { stations: scaleStations(1.4) }],
  ['root pad off', { rootPadEnabled: false }],
  ['printer 250', { printer: 250 }],
  ['chevron + edge 6 + corner 10', { slitPattern1: 'chevron', slitPattern2: 'straight', slitEdgeKeep: 6, cornerRadius: 10 }],
  ['stagger 0, pitch 5', { slitStagger: 0, chordSlitPitch: 5 }],
  ['short blade, high twist', { rootPadLength: 10, rootBarPosition: 5, stations: [{ y: 0, chord: 40, twist: 0 }, { y: 15, chord: 40, twist: 70 }, { y: 60, chord: 35, twist: 50 }, { y: 120, chord: 30, twist: 20 }] }],
  ['negative twist', { stations: defaultConfig().stations.map(s => ({ ...s, twist: -s.twist })) }],
  ['axis 0% / 100%', { twistAxis: 0 }],
  ['axis 100%', { twistAxis: 100 }]
];
for (const [name, o] of extremes) {
  for (const mode of ['A', 'B', 'C']) {
    try {
      const c = validateConfig({ ...defaultConfig(), ...o, rootSlitMode: mode });
      const { stats } = auditLayout(c, `[${name}] ${mode}`);
      rsCheck(Number.isFinite(stats.rootCut), `[${name}] ${mode}: cut length`);
      if (mode === 'C' && stats.added === 0) console.log(`  note [${name}] C: no new features`);
    } catch (e) { rsCheck(false, `[${name}] ${mode} threw: ${e.message}`); }
  }
}
console.log(`extreme parameter sets: ${extremes.length} × 3 modes laid out without errors`);
console.log(`root-slit checks: ${rsTests}`);

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
