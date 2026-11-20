import { clamp, station, planformYs, bladeSvgStart, slitRows } from './model.js';
import { buildRootSlitLayer, outlineCorners, rootSlitSwitchLines, ROOT_SLIT_MODE_NAMES, RS } from './root-slits.js';

/** v1.2.2 short slits of one layer, as segments in sheet coordinates (x from the leading edge, y = r). */
export function slitSegments(c, basePitch, phase, pattern) {
  const fullSpan = c.stations.at(-1).y;
  const svgStart = bladeSvgStart(c);
  const out = [];
  const rows = slitRows(c, basePitch, phase, svgStart);
  const period = c.chordSlitPitch;
  const edge = c.slitEdgeKeep;
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const y = rows[rowIndex];
    const chord = station(c, y).chord;
    const chordOffset = period * phase;
    const rowStagger = pattern === 'staggered' && rowIndex % 2 === 1 ? period * 0.5 : 0;
    let x = edge + chordOffset + rowStagger - (Math.floor((edge + chordOffset + rowStagger) / period) * period);
    if (x < edge) x += period;
    let columnIndex = 0;
    while (x + 0.05 < chord - edge) {
      let endY = Math.min(y + c.slitLength, fullSpan - edge);
      if (station(c, endY).chord < x + edge) {
        let lo = y, hi = endY;
        for (let i = 0; i < 12; i++) {
          const mid = (lo + hi) / 2;
          if (station(c, mid).chord >= x + edge) lo = mid;
          else hi = mid;
        }
        endY = lo;
      }
      if (endY - y >= 1) {
        const sign = (rowIndex + columnIndex) % 2 === 0 ? 1 : -1;
        const dx = pattern === 'chevron' ? Math.tan(c.slitAngle * Math.PI / 180) * sign * (endY - y) : 0;
        const endX = clamp(x + dx, edge, station(c, endY).chord - edge);
        out.push({ x, y, endX, endY });
      }
      x += period;
      columnIndex++;
    }
  }
  return out;
}

/** Two-layer balsa planform. Chord width is the mold chord, as in the original. */
export function bladePlanformSvg(c) {
  if (c.rootSlitMode && c.rootSlitMode !== 'off') return bladePlanformSvgRootSlits(c);
  const fullSpan = c.stations.at(-1).y;
  const svgStart = bladeSvgStart(c);
  const span = fullSpan - svgStart;
  const margin = 10;
  const fmt = n => Number(n).toFixed(3);
  const ys = [0, ...planformYs(c).filter(y => y > svgStart && y < fullSpan).map(y => y - svgStart), span];
  const chordAt = y => station(c, svgStart + y).chord;
  const maxChord = Math.max(...ys.map(chordAt));
  const panelWidth = maxChord + 2 * margin;
  const w = 2 * panelWidth + margin;
  const h = span + 2 * margin;
  function pathForOutline(x0) {
    const points = [
      { x: x0, y: 0 },
      { x: x0, y: span },
      { x: x0 + chordAt(span), y: span },
      ...ys.slice(1, -1).reverse().map(y => ({ x: x0 + chordAt(y), y })),
      { x: x0 + chordAt(0), y: 0 }
    ];
    const corners = new Set([0, 1, 2, points.length - 1]);
    const ends = points.map((p, i) => {
      if (!corners.has(i) || c.cornerRadius === 0) return { entry: p, exit: p, rounded: false };
      const prev = points[(i - 1 + points.length) % points.length];
      const next = points[(i + 1) % points.length];
      const l1 = Math.hypot(prev.x - p.x, prev.y - p.y);
      const l2 = Math.hypot(next.x - p.x, next.y - p.y);
      const d = Math.min(c.cornerRadius, l1 / 2, l2 / 2);
      return {
        entry: { x: p.x + (prev.x - p.x) * d / l1, y: p.y + (prev.y - p.y) * d / l1 },
        exit: { x: p.x + (next.x - p.x) * d / l2, y: p.y + (next.y - p.y) * d / l2 },
        rounded: d > 0
      };
    });
    const cmdPoint = p => `${fmt(p.x)} ${fmt(margin + p.y)}`;
    const cmd = [`M ${cmdPoint(ends[0].exit)}`];
    for (let i = 1; i < points.length; i++) {
      cmd.push(`L ${cmdPoint(ends[i].entry)}`);
      if (ends[i].rounded) cmd.push(`Q ${cmdPoint(points[i])} ${cmdPoint(ends[i].exit)}`);
    }
    cmd.push(`L ${cmdPoint(ends[0].entry)}`);
    if (ends[0].rounded) cmd.push(`Q ${cmdPoint(points[0])} ${cmdPoint(ends[0].exit)}`);
    cmd.push('Z');
    return cmd.join(' ');
  }
  function slits(x0, basePitch, phase, pattern) {
    let out = '';
    for (const { x, y, endX, endY } of slitSegments(c, basePitch, phase, pattern)) {
      out += `<path d="M ${fmt(x0 + x)} ${fmt(margin + y - svgStart)} L ${fmt(x0 + endX)} ${fmt(margin + endY - svgStart)}"/>`;
    }
    return out;
  }
  const layer1X = margin;
  const layer2X = margin + panelWidth + margin;
  const patternName = p => p === 'chevron' ? '魚骨斜切' : p === 'staggered' ? '沿葉片方向交錯直切' : '沿葉片方向直切';
  const phase2 = c.slitStagger / 100;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(w)}mm" height="${fmt(h)}mm" viewBox="0 0 ${fmt(w)} ${fmt(h)}"><title>風機葉片雙層巴沙木雷切圖</title><desc>1:1 mm；第一層為${patternName(c.slitPattern1)}，第二層為${patternName(c.slitPattern2)}；第二層錯位 ${c.slitStagger}%。魚骨斜角 ${c.slitAngle}°。SVG 葉片長 ${fmt(span)} mm，從距圓心 ${fmt(svgStart)} mm 延伸至 ${fmt(fullSpan)} mm；切線距葉片邊緣至少 ${c.slitEdgeKeep} mm。</desc><g id="LAYER_1" data-label="第一層巴沙木｜${patternName(c.slitPattern1)}"><path id="LAYER_1_OUTLINE" d="${pathForOutline(layer1X)}" fill="none" stroke="#ff0000" stroke-width="0.1"/><g id="LAYER_1_SLITS" fill="none" stroke="#ff0000" stroke-width="0.1">${slits(layer1X, c.slitPitch1, 0, c.slitPattern1)}</g></g><g id="LAYER_2" data-label="第二層巴沙木｜${patternName(c.slitPattern2)}"><path id="LAYER_2_OUTLINE" d="${pathForOutline(layer2X)}" fill="none" stroke="#ff0000" stroke-width="0.1"/><g id="LAYER_2_SLITS" fill="none" stroke="#ff0000" stroke-width="0.1">${slits(layer2X, c.slitPitch2, phase2, c.slitPattern2)}</g></g></svg>`;
}

const patternLabel = p => p === 'chevron' ? '魚骨斜切' : p === 'staggered' ? '沿葉片方向交錯直切' : '沿葉片方向直切';

/** Root-slit layout for one layer: v1.2.2 slits that stay, plus the new root features. */
export function rootSlitLayers(c) {
  const layers = [
    { layer: 1, existing: slitSegments(c, c.slitPitch1, 0, c.slitPattern1) },
    { layer: 2, existing: slitSegments(c, c.slitPitch2, c.slitStagger / 100, c.slitPattern2) }
  ];
  return layers.map(L => ({ ...L, ...buildRootSlitLayer(c, L.layer, L.existing) }));
}

/** v1.3.0 葉根割線模式 A／B／C：葉尖段沿用 v1.2.2 短切，葉根段改成新割線；C 外形多 5 mm 修切量。 */
function bladePlanformSvgRootSlits(c) {
  const fullSpan = c.stations.at(-1).y;
  const svgStart = bladeSvgStart(c);
  const trim = c.rootSlitMode === 'C' ? RS.trim : 0;
  const outStart = svgStart - trim;
  const span = fullSpan - outStart;
  const margin = 10;
  const fmt = n => Number(n).toFixed(3);
  const { points, ends } = outlineCorners(c, outStart, fullSpan);
  const maxChord = Math.max(...points.map(p => p.x));
  const panelWidth = maxChord + 2 * margin;
  const w = 2 * panelWidth + margin;
  const h = span + 2 * margin;
  const P = (x0, x, y) => `${fmt(x0 + x)} ${fmt(margin + y - outStart)}`;
  function pathForOutline(x0) {
    const cmdPoint = p => `${fmt(x0 + p.x)} ${fmt(margin + p.y)}`;
    const cmd = [`M ${cmdPoint(ends[0].exit)}`];
    for (let i = 1; i < points.length; i++) {
      cmd.push(`L ${cmdPoint(ends[i].entry)}`);
      if (ends[i].rounded) cmd.push(`Q ${cmdPoint(points[i])} ${cmdPoint(ends[i].exit)}`);
    }
    cmd.push(`L ${cmdPoint(ends[0].entry)}`);
    if (ends[0].rounded) cmd.push(`Q ${cmdPoint(points[0])} ${cmdPoint(ends[0].exit)}`);
    cmd.push('Z');
    return cmd.join(' ');
  }
  const layers = rootSlitLayers(c);
  const xs = [margin, margin + panelWidth + margin];
  const modeName = ROOT_SLIT_MODE_NAMES[c.rootSlitMode];
  const lines = rootSlitSwitchLines(c);
  const fmtLines = (arr, t) => arr.length ? arr.map(x => `${t} 在 r≈${x.y.toFixed(1)} mm`).join('、') : `${t} 在葉片 SVG 範圍內沒有交點`;
  const groups = layers.map((L, idx) => {
    const x0 = xs[idx];
    const keptPaths = L.kept.map(i => {
      const { x, y, endX, endY } = L.existing[i];
      return `<path d="M ${P(x0, x, y)} L ${P(x0, endX, endY)}"/>`;
    }).join('');
    const rootPaths = L.added.map(f => f.lines.map(l => `<path d="M ${l.map(p => P(x0, p.x, p.y)).join(' L ')}"/>`).join('')
      + f.holes.map(hh => { const [cx, cy] = P(x0, hh.x, hh.y).split(' '); return `<circle cx="${cx}" cy="${cy}" r="${fmt(hh.r)}"/>`; }).join('')).join('');
    const pattern = idx === 0 ? c.slitPattern1 : c.slitPattern2;
    const trimLine = trim
      ? `<path id="LAYER_${L.layer}_TRIM_LINE" d="M ${P(x0, 0, svgStart)} L ${P(x0, station(c, svgStart).chord, svgStart)}" fill="none" stroke="#0000ff" stroke-width="0.1"/>`
      : '';
    return `<g id="LAYER_${L.layer}" data-label="第${idx === 0 ? '一' : '二'}層巴沙木｜${patternLabel(pattern)}＋葉根${modeName}"><path id="LAYER_${L.layer}_OUTLINE" d="${pathForOutline(x0)}" fill="none" stroke="#ff0000" stroke-width="0.1"/><g id="LAYER_${L.layer}_SLITS" fill="none" stroke="#ff0000" stroke-width="0.1">${keptPaths}</g><g id="LAYER_${L.layer}_ROOT_SLITS" data-label="葉根割線｜${modeName}" fill="none" stroke="#ff0000" stroke-width="0.1">${rootPaths}</g>${trimLine}</g>`;
  }).join('');
  const lengthText = trim
    ? `SVG 葉片長 ${fmt(span)} mm（含葉根修切量 ${trim} mm，壓好後沿藍色修切線 r=${fmt(svgStart)} mm 切齊），從距圓心 ${fmt(outStart)} mm 延伸至 ${fmt(fullSpan)} mm`
    : `SVG 葉片長 ${fmt(span)} mm，從距圓心 ${fmt(svgStart)} mm 延伸至 ${fmt(fullSpan)} mm`;
  const desc = `1:1 mm；第一層為${patternLabel(c.slitPattern1)}，第二層為${patternLabel(c.slitPattern2)}；第二層錯位 ${c.slitStagger}%。魚骨斜角 ${c.slitAngle}°。${lengthText}；切線距葉片邊緣至少 ${c.slitEdgeKeep} mm。葉根割線模式：${modeName}；θ1=${c.rootSlitTheta1}°、θ2=${c.rootSlitTheta2}°、過渡帶 ${c.rootSlitBand} mm；${fmtLines(lines.theta2, 'θ2')}；${fmtLines(lines.theta1, 'θ1')}。扭角低於 θ1 的葉尖段沿用原本短切。紅色切穿（含 Ø${(RS.hole * 2).toFixed(1)} mm 縫端圓孔${c.rootSlitMode === 'C' ? `、Ø${(RS.splitHole * 2).toFixed(1)} mm 止裂孔` : ''}）${trim ? '；藍色為修切參考線（雷雕或不輸出）' : ''}。`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(w)}mm" height="${fmt(h)}mm" viewBox="0 0 ${fmt(w)} ${fmt(h)}"><title>風機葉片雙層巴沙木雷切圖</title><desc>${desc}</desc>${groups}</svg>`;
}
