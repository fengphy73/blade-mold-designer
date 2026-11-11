/**
 * One dovetail profile shared by the 2D diagram, the 3D preview and the STL.
 *
 * t = 0 is the tongue root (narrow); t = 1 is the tongue tip (wide).
 * The socket is the same curve widened by exactly 2 × per-side clearance.
 * Head width and depth follow the seam chord (Bambu Studio style).
 * The UI angle is the flank against the seam face; neckWidth uses the
 * complement, the angle away from the span direction.
 *
 * Fillets: root flares into the shoulder; tip rounds the head corners.
 */

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

export const JOINT_DEFAULTS = Object.freeze({
  clearance: 0.1,
  widthPercentMold: 55,
  widthPercentBlade: 50,
  depthPercent: 16,
  faceAngle: 60
});

export function effectiveJoint(config, mode = 'mold') {
  const blade = mode === 'blade';
  if (!config.jointManual) {
    return {
      clearance: JOINT_DEFAULTS.clearance,
      widthPercent: blade ? JOINT_DEFAULTS.widthPercentBlade : JOINT_DEFAULTS.widthPercentMold,
      depthPercent: JOINT_DEFAULTS.depthPercent,
      faceAngle: JOINT_DEFAULTS.faceAngle,
      mode: blade ? 'blade' : 'mold'
    };
  }
  return {
    clearance: config.jointClearance,
    widthPercent: config.jointWidth,
    depthPercent: config.jointDepth,
    faceAngle: config.jointAngle,
    mode: blade ? 'blade' : 'mold'
  };
}

/** Spanwise dovetail depth in mm, 16% of the seam chord, clamped to 6–15 mm. */
export function jointDepthMm(chord, joint) {
  return clamp(chord * joint.depthPercent / 100, 6, 15);
}

/** Angle of the flank away from the span axis. UI face-angle 60° → 30°. */
export function internalFlankAngle(faceAngle) {
  return 90 - faceAngle;
}

export function neckWidth(head, depth, internalAngleDeg) {
  const raw = head - 2 * depth * Math.tan(internalAngleDeg * Math.PI / 180);
  return Math.max(head * 0.3, raw);
}

export function filletRadii(neck, head, depth) {
  const span = Math.max(0.2, head - neck);
  const rTip = Math.min(0.75, depth * 0.18, span * 0.22);
  const rRoot = Math.min(0.75, depth * 0.18, Math.max(neck, 1) * 0.28, span * 0.22);
  return { rTip, rRoot };
}

export function tongueWidth(t, neck, head, depth, radii) {
  const tt = clamp(t, 0, 1);
  const s = tt * tt * (3 - 2 * tt);
  const safeHead = Math.max(head, neck + 0.4);
  let w = neck + (safeHead - neck) * s;
  const y = tt * depth;
  const { rTip, rRoot } = radii || filletRadii(neck, safeHead, depth);
  if (rTip > 1e-6 && y > depth - rTip) {
    const u = depth - y;
    const trim = rTip - Math.sqrt(Math.max(0, rTip * rTip - (rTip - u) * (rTip - u)));
    w -= 2 * trim;
  }
  if (rRoot > 1e-6 && y < rRoot) {
    const u = rRoot - y;
    const add = rRoot - Math.sqrt(Math.max(0, rRoot * rRoot - u * u));
    w += 2 * add;
  }
  return Math.max(0.8, w);
}

/**
 * Profile locked to one seam chord so the tongue and the socket match.
 * Mold: head centered at mid-chord. Blade: head centered at 40% chord
 * (spans 15%–65% when the width is 50%).
 */
export function seamProfile(joint, chordAtSeam) {
  const head = chordAtSeam * joint.widthPercent / 100;
  const depth = jointDepthMm(chordAtSeam, joint);
  const internalAngle = internalFlankAngle(joint.faceAngle);
  const neck = neckWidth(head, depth, internalAngle);
  const radii = filletRadii(neck, head, depth);
  const centerFraction = joint.mode === 'blade' ? 0.4 : 0.5;
  return {
    joint,
    head,
    neck,
    depth,
    radii,
    chord: chordAtSeam,
    center: chordAtSeam * centerFraction,
    centerFraction,
    faceAngle: joint.faceAngle,
    internalAngle,
    clearance: joint.clearance
  };
}

/** Tongue or socket full width at fraction t. Chord is already locked in the profile. */
export function widthAt(profile, t, kind) {
  const tongue = tongueWidth(t, profile.neck, profile.head, profile.depth, profile.radii);
  if (kind === 'socket') return tongue + 2 * profile.clearance;
  return tongue;
}

/**
 * Socket must leave at least `minWall` mm of mold skin on each side.
 * Centered the same way as the mold joint (mid-chord).
 */
export function limitJointWidth(requestedFullWidth, chord, margin, minWall = 2) {
  const center = chord / 2;
  const maxHalf = Math.min(center - (-margin + minWall), (chord + margin - minWall) - center);
  const maxFull = Math.max(1, 2 * maxHalf);
  if (requestedFullWidth <= maxFull + 1e-6) {
    return { width: requestedFullWidth, clamped: false, maxFull };
  }
  return { width: maxFull, clamped: true, maxFull };
}

export function profilePolyline(profile, kind, segments = 28) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const width = widthAt(profile, t, kind);
    const half = width / 2;
    pts.push({
      t,
      y: t * profile.depth,
      xL: profile.center - half,
      xR: profile.center + half,
      width,
      center: profile.center
    });
  }
  return pts;
}
