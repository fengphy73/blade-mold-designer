// Hash every output (mold STL, full-blade STL, laser SVG, parameter file) for one parameter set.
// Used by check-outputs.mjs and by make-v122-reference.mjs (run against the v1.2.2 tree).
import { createHash } from 'crypto';
import { readFileSync } from 'fs';

export const FORM_ORDER = ['wood', 'clearance', 'printer', 'jointClearance', 'jointWidth', 'jointDepth', 'jointAngle', 'rootPadLength', 'rootBlendLength', 'rootBarWidth', 'rootBarThickness', 'rootBarPosition', 'rootBarClearance', 'moldMargin', 'moldBackThickness', 'stopHeight', 'cornerRadius', 'slitLength', 'slitPitch1', 'slitPitch2', 'slitGap', 'twistPerRow', 'minSlitPitch', 'slitPitchScale', 'twistAxis', 'slitAngle', 'slitStagger', 'chordSlitPitch', 'slitRootKeep', 'slitEdgeKeep', 'ribStockThickness', 'ribSpacing', 'ribTabWidth', 'ribSlotClearance', 'ribSheetWidth', 'ribSheetHeight', 'teMinThickness', 'rootPadEnabled', 'clampEnabled', 'locatorEnabled', 'jointManual', 'autoSlitDensity', 'slitPattern1', 'slitPattern2'];

export function paramSets() {
  return JSON.parse(readFileSync(new URL('./fixtures/param-sets.json', import.meta.url), 'utf8'));
}

/** Same key order as main.js readForm(); extra keys (v1.3.0 root-slit fields) go after slitPattern2. */
export function formLike(defaults, overrides, extra = {}) {
  const merged = { ...defaults, ...overrides };
  const o = {};
  for (const k of FORM_ORDER) o[k] = merged[k];
  Object.assign(o, extra);
  o.stations = (merged.stations || defaults.stations).map(s => ({ ...s }));
  return o;
}

const sha = buf => createHash('sha256').update(buf).digest('hex');

export function hashOutputs(mods, input, { skipConfig = false } = {}) {
  const { validateConfig, buildMold, buildBlade, bladePlans, meshToStl, bladePlanformSvg, configText } = mods;
  const c = validateConfig(input);
  const out = { svg: sha(Buffer.from(bladePlanformSvg(c), 'utf8')), molds: [], blades: [] };
  for (let i = 0; i < c.printableSegments.length; i++) {
    for (const kind of ['lower', 'upper']) {
      const pad = String(i + 1).padStart(2, '0');
      const name = kind === 'lower' ? `lower-concave-mold-${pad}` : `upper-convex-mold-${pad}`;
      out.molds.push(sha(Buffer.from(meshToStl(buildMold(c, i, kind), name))));
    }
  }
  bladePlans(c).forEach((_, i) => {
    const pad = String(i + 1).padStart(2, '0');
    out.blades.push(sha(Buffer.from(meshToStl(buildBlade(c, i), `blade-full-${pad}`))));
  });
  if (!skipConfig) out.config = sha(Buffer.from(configText(c), 'utf8'));
  return out;
}
