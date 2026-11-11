/** NACA 2412 upper-surface helpers. Formula matches the original designer. */

export function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

export function interp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothstep(t) {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
}

/** Upper-surface camber+thickness z/c. u is clamped, so the margins stay flat. */
export function upperY(u) {
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
  return yc + yt * Math.cos(Math.atan(slope));
}

export function getUpperSurfaceLengthRatio(steps = 2000) {
  let total = 0, prevX = 0, prevY = upperY(0);
  for (let i = 1; i <= steps; i++) {
    const x = i / steps, y = upperY(x);
    total += Math.hypot(x - prevX, y - prevY);
    prevX = x;
    prevY = y;
  }
  return total;
}

export const upperSurfaceLengthRatio = getUpperSurfaceLengthRatio();

/** Full airfoil (upper and lower) for the section diagram only. */
export function airfoilYZ(u) {
  u = clamp(u, 0, 1);
  const m = 0.02, p = 0.4, t = 0.12;
  const yt = 5 * t * (0.2969 * Math.sqrt(u) - 0.1260 * u - 0.3516 * u * u + 0.2843 * u * u * u - 0.1036 * u * u * u * u);
  const yc = u < p ? m / (p * p) * (2 * p * u - u * u) : m / ((1 - p) * (1 - p)) * ((1 - 2 * p) + 2 * p * u - u * u);
  return { upper: yc + yt, lower: yc - yt };
}
