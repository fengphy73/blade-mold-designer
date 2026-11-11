import { clamp, interp, smoothstep, upperY, upperSurfaceLengthRatio } from './airfoil.js';
import { effectiveJoint } from './joint.js';

export { upperY, upperSurfaceLengthRatio, clamp, interp, smoothstep };

export const DEFAULT_STATIONS = [
  { y: 0, chord: 73, twist: 0 },
  { y: 30, chord: 73, twist: 64.4 },
  { y: 75, chord: 73, twist: 41.9 },
  { y: 150, chord: 73, twist: 23.1 },
  { y: 225, chord: 68, twist: 14.6 },
  { y: 300, chord: 63, twist: 9.9 },
  { y: 375, chord: 58, twist: 7 },
  { y: 450, chord: 53, twist: 5.1 }
];

export function defaultConfig() {
  return {
    wood: 2,
    clearance: 0.2,
    printer: 250,
    jointClearance: 0.4,
    jointWidth: 12,
    jointDepth: 4,
    jointAngle: 45,
    rootPadLength: 30,
    rootBlendLength: 5,
    rootBarWidth: 6,
    rootBarThickness: 3,
    rootBarPosition: 15,
    rootBarClearance: 0.2,
    moldMargin: 8,
    moldBackThickness: 5,
    stopHeight: 1.5,
    cornerRadius: 2,
    slitLength: 6,
    slitPitch1: 8,
    slitPitch2: 10,
    slitGap: 3,
    twistPerRow: 1,
    minSlitPitch: 5,
    slitPitchScale: 1,
    twistAxis: 25,
    slitAngle: 12,
    slitStagger: 50,
    chordSlitPitch: 9,
    slitRootKeep: 0,
    slitEdgeKeep: 3,
    ribStockThickness: 3,
    ribSpacing: 10,
    ribTabWidth: 8,
    ribSlotClearance: 0.2,
    ribSheetWidth: 600,
    ribSheetHeight: 400,
    rootPadEnabled: false,
    clampEnabled: false,
    locatorEnabled: true,
    jointManual: false,
    autoSlitDensity: true,
    slitPattern1: 'staggered',
    slitPattern2: 'staggered',
    teMinThickness: 1.2,
    stations: DEFAULT_STATIONS.map(s => ({ ...s }))
  };
}

export function printableSegments(c) {
  const span = c.stations.at(-1).y;
  const joint = effectiveJoint(c);
  const jointAllowance = clamp(joint.depth, 1, 8);
  let count = span <= c.printer ? 1 : Math.ceil(span / (c.printer - jointAllowance));
  const len = span / count;
  if (count > 1 && len <= 12) {
    throw new Error('自動拆件後的零件太短，無法保留接縫定位面；請增加列印長度或縮短葉片。');
  }
  if (count > 1 && len <= jointAllowance) {
    throw new Error('列印段長度必須大於鳩尾接合深度。請加大列印機可用長度或減小接合深度。');
  }
  return Array.from({ length: count }, (_, i) => ({
    start: i * len,
    end: i === count - 1 ? span : (i + 1) * len
  }));
}

export function validateConfig(input) {
  const c = { ...input, stations: input.stations.map(s => ({ ...s })) };
  const num = (v, name) => {
    if (!Number.isFinite(v)) throw new Error(`請檢查數字欄位（${name}）。`);
    return v;
  };
  const ids = ['wood', 'clearance', 'printer', 'jointClearance', 'jointWidth', 'jointDepth', 'jointAngle', 'rootPadLength', 'rootBlendLength', 'rootBarWidth', 'rootBarThickness', 'rootBarPosition', 'rootBarClearance', 'moldMargin', 'moldBackThickness', 'stopHeight', 'cornerRadius', 'slitLength', 'slitPitch1', 'slitPitch2', 'slitGap', 'twistPerRow', 'minSlitPitch', 'slitPitchScale', 'twistAxis', 'slitAngle', 'slitStagger', 'chordSlitPitch', 'slitRootKeep', 'slitEdgeKeep', 'ribStockThickness', 'ribSpacing', 'ribTabWidth', 'ribSlotClearance', 'ribSheetWidth', 'ribSheetHeight', 'teMinThickness'];
  for (const id of ids) num(c[id], id);
  if (!(c.wood >= 0.5 && c.wood <= 5)) throw new Error('木片厚度請設定在 0.5–5 mm。');
  if (!(c.clearance >= 0 && c.clearance <= 1)) throw new Error('模具間隙請設定在 0–1 mm。');
  if (!(c.printer >= 80)) throw new Error('列印機可用長度請設定在 80 mm 以上。');
  if (!(c.teMinThickness >= 0.4 && c.teMinThickness <= 4)) throw new Error('後緣最小厚度請設定在 0.4–4 mm。');
  if (c.ribStockThickness <= 0 || c.ribSpacing < 3 || c.ribTabWidth <= 0 || c.ribSlotClearance < 0 || c.ribSheetWidth < 100 || c.ribSheetHeight < 100) {
    throw new Error('請檢查雷切翼肋板厚、間距、外側卡榫、配合間隙與排版尺寸。');
  }
  if (c.moldMargin < 0 || c.moldMargin > 25) throw new Error('模具兩側預留請設定在 0–25 mm／側。');
  if (c.moldBackThickness < 3 || c.moldBackThickness > 30) throw new Error('模具背板厚度請設定在 3–30 mm。');
  if (c.twistAxis < 0 || c.twistAxis > 100) throw new Error('扭轉軸位置請設定在 0–100% 弦長。');
  if (c.stopHeight < 0.5 || c.stopHeight > 30) throw new Error('擋邊高度請設定在 0.5–30 mm。');
  if (c.cornerRadius < 0 || c.cornerRadius > 20) throw new Error('葉片邊角圓角請設定在 0–20 mm。');
  if (c.slitAngle < 0 || c.slitAngle > 30) throw new Error('魚骨斜角請設定在 0–30°。');
  if (c.slitStagger < 0 || c.slitStagger > 50) throw new Error('第二層錯位請設定在 0–50%。');
  if (c.chordSlitPitch < 3 || c.chordSlitPitch > 25) throw new Error('弦向切線間距請設定在 3–25 mm。');
  if (c.slitRootKeep < 0 || c.slitRootKeep > 50) throw new Error('葉根保留不切長度請設定在 0–50 mm。');
  if (c.slitEdgeKeep < 1 || c.slitEdgeKeep > 10) throw new Error('葉片外緣保留距離請設定在 1–10 mm。');
  if (c.slitLength + c.slitGap > 30) throw new Error('切線長度加切段間隔不可超過 30 mm。');
  if (!['straight', 'staggered', 'chevron'].includes(c.slitPattern1) || !['straight', 'staggered', 'chevron'].includes(c.slitPattern2)) {
    throw new Error('請選擇有效的切線圖樣。');
  }
  if (c.slitLength < 1 || c.slitLength > 30 || c.slitGap < 0.5 || c.slitGap > 15) throw new Error('請檢查短切線長度與切段間隔。');
  if (c.slitPitch1 < 2 || c.slitPitch1 > 30 || c.slitPitch2 < 2 || c.slitPitch2 > 30) throw new Error('兩層切線列距請設定在 2–30 mm。');
  if (c.twistPerRow < 0.2 || c.twistPerRow > 3) throw new Error('每列目標扭角變化請設定在 0.2–3°。');
  if (c.minSlitPitch < 3 || c.minSlitPitch > 12) throw new Error('最小列距請設定在 3–12 mm。');
  if (c.slitPitchScale < 0.6 || c.slitPitchScale > 1.5) throw new Error('列距微調倍率請設定在 0.6–1.5 倍。');
  if (c.minSlitPitch > Math.min(c.slitPitch1, c.slitPitch2)) throw new Error('最小列距不可大於兩層的基礎列距。');
  if (c.locatorEnabled && c.moldMargin < 1.5) throw new Error('加入定位擋邊時，模具每側預留至少需 1.5 mm。');
  if (c.locatorEnabled && Math.max(0, c.stopHeight - (c.wood + c.clearance - 0.3)) > c.moldBackThickness - 1.5) {
    throw new Error(`擋邊太高：上模退讓後背板至少要留 1.5 mm；目前最高可設 ${(c.wood + c.clearance - 0.3 + c.moldBackThickness - 1.5).toFixed(1)} mm。`);
  }
  const joint = effectiveJoint(c);
  if (c.jointManual) {
    if (c.jointClearance < 0.1 || c.jointClearance > 3 || c.jointWidth < 6 || c.jointWidth > 24 || c.jointDepth < 1 || c.jointDepth > 8 || c.jointAngle < 25 || c.jointAngle > 60) {
      throw new Error('請檢查分段定位面的間隙、寬度、深度與斜面角度。');
    }
  }
  if (!(c.printer > joint.depth)) throw new Error('列印機可用長度必須大於鳩尾接合深度。');
  if (!Array.isArray(c.stations) || c.stations.length < 2) throw new Error('至少需要根部與尖端兩個站位。');
  if (c.stations[0].y !== 0) throw new Error('根部距離固定為 0 mm。');
  for (let i = 0; i < c.stations.length; i++) {
    const s = c.stations[i];
    if (!Number.isFinite(s.y) || !Number.isFinite(s.chord) || !Number.isFinite(s.twist) || s.chord <= 0) {
      throw new Error('請檢查站位數字，弦長必須大於 0。');
    }
    if (i > 0 && s.y <= c.stations[i - 1].y) throw new Error('站位距離要由根部往尖端遞增。');
  }
  c.printableSegments = printableSegments(c);
  if (c.clampEnabled && c.printableSegments.some(s => s.end - s.start < 36)) {
    throw new Error('啟用 M3 夾模鎖耳時，每個列印段至少需要 36 mm 長。');
  }
  if (c.rootPadEnabled) {
    if (c.rootPadLength < 0 || c.rootBlendLength < 5) throw new Error('平面段長度不可為負值，過渡段至少 5 mm。');
    if (c.rootPadLength + c.rootBlendLength >= c.stations.at(-1).y) throw new Error('平面段加過渡段必須短於葉片總長。');
    if (c.rootBarWidth <= 0 || c.rootBarThickness <= 0 || c.rootBarClearance < 0 || c.rootBarPosition < (c.rootBarWidth + 2 * c.rootBarClearance) / 2 || c.rootBarPosition + (c.rootBarWidth + 2 * c.rootBarClearance) / 2 > c.rootPadLength) {
      throw new Error('橫條承座必須完整落在平面接合段內，請調整橫條中心位置或平面段長度。');
    }
  }
  return c;
}

export function rawStation(c, y) {
  const ss = c.stations;
  let i = ss.length - 2;
  for (let k = 0; k < ss.length - 1; k++) if (y <= ss[k + 1].y) { i = k; break; }
  const a = ss[i], b = ss[i + 1], t = clamp((y - a.y) / (b.y - a.y), 0, 1);
  return { chord: interp(a.chord, b.chord, t), twist: interp(a.twist, b.twist, t) };
}

export function station(c, y) {
  const root = c.stations[0];
  if (!c.rootPadEnabled) return rawStation(c, y);
  if (y <= c.rootPadLength) return { chord: root.chord, twist: root.twist };
  const blendEnd = c.rootPadLength + c.rootBlendLength;
  if (y < blendEnd) {
    const target = rawStation(c, blendEnd), t = smoothstep((y - c.rootPadLength) / c.rootBlendLength);
    return { chord: interp(root.chord, target.chord, t), twist: interp(root.twist, target.twist, t) };
  }
  return rawStation(c, y);
}

export function surfaceZ(c, y, xLocal, chord) {
  const airfoil = upperY(xLocal / chord) * chord;
  if (!c.rootPadEnabled) return airfoil;
  if (y <= c.rootPadLength) return 0;
  const t = smoothstep((y - c.rootPadLength) / c.rootBlendLength);
  return airfoil * t;
}

/** Mold face before the wood offset. Crossbar seat is applied on both molds (original behaviour). */
export function lowerMoldSurfaceZ(c, y, xLocal, chord) {
  const z = surfaceZ(c, y, xLocal, chord);
  if (!c.rootPadEnabled) return z;
  const half = (c.rootBarWidth + 2 * c.rootBarClearance) / 2;
  const d = Math.abs(y - c.rootBarPosition);
  const edge = Math.min(1.2, half * 0.35);
  const depth = c.rootBarThickness / 2;
  const seat = d <= half - edge ? 1 : d < half ? smoothstep((half - d) / edge) : 0;
  return z - depth * seat;
}

export function fenceStartY(c) {
  return c.rootPadEnabled ? c.rootPadLength + c.rootBlendLength : 0;
}

export function reliefDepth(c) {
  return Math.max(0, c.stopHeight - (c.wood + c.clearance - 0.3));
}

/**
 * Local mold-face z before twist.
 * kind 'lower' is the concave mold (surface shifted by wood+clearance).
 * kind 'upper' is the convex mold.
 */
export function faceLocalZ(c, y, xLocal, chord, kind, fenceBottom = false) {
  if (fenceBottom) {
    const edgeX = xLocal < chord / 2 ? 0 : chord;
    const faceZ = lowerMoldSurfaceZ(c, y, edgeX, chord) + c.wood + c.clearance;
    return faceZ - c.stopHeight;
  }
  let z = lowerMoldSurfaceZ(c, y, xLocal, chord);
  if (kind === 'lower') z += c.wood + c.clearance;
  if (kind === 'upper' && c.locatorEnabled && reliefDepth(c) > 0 && y >= fenceStartY(c) - 1e-9) {
    const reliefW = Math.min(c.moldMargin, 4.5);
    if ((xLocal >= -reliefW && xLocal <= -0.3) || (xLocal >= chord + 0.3 && xLocal <= chord + reliefW)) {
      z -= reliefDepth(c);
    }
  }
  return z;
}

export function transformed(c, y, xLocal, zLocal) {
  const st = station(c, y);
  const rad = st.twist * Math.PI / 180;
  const axisX = st.chord * c.twistAxis / 100;
  const dx = xLocal - axisX;
  const x = axisX + dx * Math.cos(rad) + zLocal * Math.sin(rad);
  const z = -dx * Math.sin(rad) + zLocal * Math.cos(rad);
  return [x, y, z];
}

export function worldToLocal(c, y, x, z) {
  const st = station(c, y);
  const axisX = st.chord * c.twistAxis / 100;
  const rad = st.twist * Math.PI / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const xw = x - axisX;
  const dx = cos * xw - sin * z;
  const zLocal = sin * xw + cos * z;
  return { xLocal: axisX + dx, zLocal, chord: st.chord, twist: st.twist };
}

export function planformYs(c) {
  const span = c.stations.at(-1).y;
  const ys = [0, span, ...c.stations.map(s => s.y)];
  if (c.rootPadEnabled) {
    const start = c.rootPadLength, end = start + c.rootBlendLength;
    const steps = Math.ceil(c.rootBlendLength / 8);
    ys.push(start, end);
    for (let i = 1; i < steps; i++) ys.push(start + (end - start) * i / steps);
  }
  return [...new Set(ys)].sort((a, b) => a - b);
}

export function slitRootStart(c) { return Math.max(c.slitEdgeKeep, c.slitRootKeep); }
export function bladeSvgStart(c) { return c.rootPadEnabled ? c.rootPadLength + c.rootBlendLength : 0; }

export function localTwistRate(c, y) {
  const span = c.stations.at(-1).y;
  const a = Math.max(0, y - 0.5), b = Math.min(span, y + 0.5);
  if (b <= a) return 0;
  return Math.abs(station(c, b).twist - station(c, a).twist) / (b - a);
}

export function slitPitchAt(c, basePitch, y) {
  const rate = localTwistRate(c, y);
  const minPitch = Math.max(c.minSlitPitch, c.slitLength + c.slitGap);
  let pitch = basePitch;
  if (c.autoSlitDensity && rate > 1e-6) pitch = Math.min(basePitch, c.twistPerRow / rate);
  return clamp(pitch * c.slitPitchScale, minPitch, 30);
}

export function slitPitchRange(c, basePitch, origin = 0) {
  const span = c.stations.at(-1).y;
  const start = origin + slitRootStart(c);
  const end = span - c.slitEdgeKeep;
  const values = [];
  for (let y = start; y <= end; y += 2) values.push(slitPitchAt(c, basePitch, y));
  if (!values.length) values.push(slitPitchAt(c, basePitch, Math.min(start, span)));
  return { min: Math.min(...values), max: Math.max(...values) };
}

export function slitRows(c, basePitch, phase = 0, origin = 0) {
  const span = c.stations.at(-1).y;
  const start = origin + slitRootStart(c);
  const end = span - c.slitEdgeKeep;
  if (start >= end) return [];
  const minPitch = Math.max(c.minSlitPitch, c.slitLength + c.slitGap);
  const base = clamp(basePitch * c.slitPitchScale, minPitch, 30);
  const first = start + base * phase;
  const rows = [first];
  let last = first, previous = first, angleSinceRow = 0;
  for (let y = first + 0.5; y < end + 0.25; y += 0.5) {
    const current = Math.min(y, end);
    angleSinceRow += Math.abs(station(c, current).twist - station(c, previous).twist);
    const distance = current - last;
    const baseReached = distance >= base - 0.001;
    const angleReached = c.autoSlitDensity && angleSinceRow >= c.twistPerRow * c.slitPitchScale && distance >= minPitch - 0.001;
    if (baseReached || angleReached) { rows.push(current); last = current; angleSinceRow = 0; }
    previous = current;
  }
  return rows;
}

/** World-z envelope of one mold face over a span, including the locating lip when it applies. */
export function faceEnvelope(c, y0, y1, kind) {
  let minZ = Infinity, maxZ = -Infinity;
  const ySamples = [];
  const span = Math.max(1e-6, y1 - y0);
  const n = Math.max(4, Math.ceil(span / 2));
  for (let i = 0; i <= n; i++) ySamples.push(y0 + span * i / n);
  const fenceOn = kind === 'lower' && c.locatorEnabled;
  const f0 = fenceStartY(c);
  if (fenceOn) ySamples.push(clamp(f0, y0, y1), clamp(f0 + 0.2, y0, y1));
  for (const y of ySamples) {
    const st = station(c, y);
    const chord = st.chord;
    const xs = [];
    const m = c.moldMargin;
    const nx = 36;
    for (let i = 0; i <= nx; i++) xs.push(-m + (chord + 2 * m) * i / nx);
    if (fenceOn && y >= f0 - 1e-9) {
      xs.push(-1.5, -0.9, -0.3, chord + 0.3, chord + 0.9, chord + 1.5);
    }
    for (const x of xs) {
      const zLocal = faceLocalZ(c, y, x, chord, kind, false);
      const p = transformed(c, y, x, zLocal);
      minZ = Math.min(minZ, p[2]);
      maxZ = Math.max(maxZ, p[2]);
    }
    if (fenceOn && y >= f0 - 1e-9) {
      for (const x of [-1.5, -0.9, -0.3, chord + 0.3, chord + 0.9, chord + 1.5]) {
        const zLocal = faceLocalZ(c, y, x, chord, kind, true);
        const p = transformed(c, y, x, zLocal);
        minZ = Math.min(minZ, p[2]);
        maxZ = Math.max(maxZ, p[2]);
      }
    }
  }
  return { minZ, maxZ };
}
