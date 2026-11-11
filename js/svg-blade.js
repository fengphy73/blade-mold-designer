import { clamp, station, planformYs, bladeSvgStart, slitRows } from './model.js';

/** Two-layer balsa planform. Chord width is the mold chord, as in the original. */
export function bladePlanformSvg(c) {
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
          out += `<path d="M ${fmt(x0 + x)} ${fmt(margin + y - svgStart)} L ${fmt(x0 + endX)} ${fmt(margin + endY - svgStart)}"/>`;
        }
        x += period;
        columnIndex++;
      }
    }
    return out;
  }
  const layer1X = margin;
  const layer2X = margin + panelWidth + margin;
  const patternName = p => p === 'chevron' ? '魚骨斜切' : p === 'staggered' ? '沿葉片方向交錯直切' : '沿葉片方向直切';
  const phase2 = c.slitStagger / 100;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(w)}mm" height="${fmt(h)}mm" viewBox="0 0 ${fmt(w)} ${fmt(h)}"><title>風機葉片雙層巴沙木雷切圖</title><desc>1:1 mm；第一層為${patternName(c.slitPattern1)}，第二層為${patternName(c.slitPattern2)}；第二層錯位 ${c.slitStagger}%。魚骨斜角 ${c.slitAngle}°。SVG 葉片長 ${fmt(span)} mm，從距圓心 ${fmt(svgStart)} mm 延伸至 ${fmt(fullSpan)} mm；切線距葉片邊緣至少 ${c.slitEdgeKeep} mm。</desc><g id="LAYER_1" data-label="第一層巴沙木｜${patternName(c.slitPattern1)}"><path id="LAYER_1_OUTLINE" d="${pathForOutline(layer1X)}" fill="none" stroke="#ff0000" stroke-width="0.1"/><g id="LAYER_1_SLITS" fill="none" stroke="#ff0000" stroke-width="0.1">${slits(layer1X, c.slitPitch1, 0, c.slitPattern1)}</g></g><g id="LAYER_2" data-label="第二層巴沙木｜${patternName(c.slitPattern2)}"><path id="LAYER_2_OUTLINE" d="${pathForOutline(layer2X)}" fill="none" stroke="#ff0000" stroke-width="0.1"/><g id="LAYER_2_SLITS" fill="none" stroke="#ff0000" stroke-width="0.1">${slits(layer2X, c.slitPitch2, phase2, c.slitPattern2)}</g></g></svg>`;
}
