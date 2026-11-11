/**
 * One dovetail profile shared by the 2D diagram, the 3D preview and the STL.
 *
 * t = 0 is the tongue root (where it joins segment A): NARROW.
 * t = 1 is the tongue tip: WIDE.
 * The socket is the same curve widened by exactly 2 × per-side clearance.
 *
 * Fillets:
 *  - root: circular flare into the shoulder (adds material; does not undercut the neck)
 *  - tip: circular round on the head corners (removes the sharp corner, head stays wider than the root)
 * The flank between them is the original smoothstep, narrow to wide.
 */

export const JOINT_DEFAULTS = Object.freeze({
  clearance: 0.4,
  width: 12,
  depth: 4,
  angle: 45
});

export function effectiveJoint(config) {
  if (!config.jointManual) return { ...JOINT_DEFAULTS };
  return {
    clearance: config.jointClearance,
    width: config.jointWidth,
    depth: config.jointDepth,
    angle: config.jointAngle
  };
}

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

export function neckWidth(head, depth, angleDeg) {
  const ang = angleDeg * Math.PI / 180;
  return Math.max(1.5, head - 2 * depth * Math.tan(ang));
}

export function filletRadii(neck, head, depth) {
  const span = Math.max(0.2, head - neck);
  const rTip = Math.min(0.75, depth * 0.18, span * 0.22);
  const rRoot = Math.min(0.75, depth * 0.18, Math.max(neck, 1) * 0.28, span * 0.22);
  return { rTip, rRoot };
}

/**
 * Full tongue width at fraction t.
 * `neck` is fixed at the seam; `head` may follow the local chord.
 */
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

export function socketWidth(t, neck, head, depth, clearance, radii) {
  return tongueWidth(t, neck, head, depth, radii) + 2 * clearance;
}

/** Head width allowed by the local chord, same rule as the original (chord − 2 mm). */
export function headAtChord(joint, chord) {
  return Math.min(joint.width, Math.max(2, chord - 2));
}

/**
 * Profile parameters locked at a seam so tongue and socket share one definition.
 * Width still follows the local chord's head, but neck and fillet radii stay fixed.
 */
export function seamProfile(joint, chordAtSeam) {
  const head = headAtChord(joint, chordAtSeam);
  const neck = neckWidth(head, joint.depth, joint.angle);
  const radii = filletRadii(neck, head, joint.depth);
  return { joint, head, neck, radii, chordAtSeam };
}

export function widthAt(profile, t, chordHere, kind) {
  const head = headAtChord(profile.joint, chordHere);
  const tongue = tongueWidth(t, profile.neck, head, profile.joint.depth, profile.radii);
  if (kind === 'socket') return tongue + 2 * profile.joint.clearance;
  return tongue;
}

/**
 * How wide the socket may be before it breaks out of the mold skin.
 * Returns the max full width, and whether the requested width had to be limited.
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

/** 2D outline in the chord (x) / span (y) plane, centered on `centerX`, y from 0 at the root to +depth at the tip. */
export function profilePolyline(profile, chordSamples, kind, segments = 28) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const chord = chordSamples(t);
    const half = widthAt(profile, t, chord, kind) / 2;
    const center = chord / 2;
    const y = t * profile.joint.depth;
    pts.push({ t, y, xL: center - half, xR: center + half, width: half * 2, center });
  }
  return pts;
}
