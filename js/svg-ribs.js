import { station, lowerMoldSurfaceZ } from './model.js';

/** Rib stations. The cut line does not subtract wood thickness — original behaviour. */
export function ribStations(c) {
  const span = c.stations.at(-1).y;
  const ys = [0, span, ...c.stations.map(s => s.y)];
  for (let y = c.ribSpacing; y < span; y += c.ribSpacing) ys.push(y);
  if (c.rootPadEnabled) {
    ys.push(
      c.rootPadLength,
      c.rootPadLength + c.rootBlendLength,
      c.rootBarPosition,
      c.rootBarPosition - (c.rootBarWidth + 2 * c.rootBarClearance) / 2,
      c.rootBarPosition + (c.rootBarWidth + 2 * c.rootBarClearance) / 2
    );
  }
  return [...new Set(ys.filter(y => y >= 0 && y <= span).map(y => +y.toFixed(3)))].sort((a, b) => a - b);
}

export function ribGeometry(c, y, isUpper) {
  const st = station(c, y);
  const chord = st.chord;
  const rad = st.twist * Math.PI / 180;
  if (Math.abs(Math.cos(rad)) < 0.12) throw new Error(`距根部 ${y.toFixed(1)} mm 的扭角接近 90°，翼肋卡榫投影過短，請調整扭角。`);
  const axis = chord * c.twistAxis / 100;
  const at = (u, z) => {
    const x = u * chord, dx = x - axis;
    return { x: axis + dx * Math.cos(rad) + z * Math.sin(rad), z: -dx * Math.sin(rad) + z * Math.cos(rad) };
  };
  const le = at(0, 0), te = at(1, 0);
  const zLift = -Math.min(le.z, te.z);
  const baseline = x => le.z + (te.z - le.z) * (x - le.x) / (te.x - le.x) + zLift;
  const upper = [];
  for (let i = 0; i <= 48; i++) {
    const u = i / 48;
    const bladeZ = lowerMoldSurfaceZ(c, y, u * chord, chord);
    const p = at(u, bladeZ + (isUpper ? c.wood + c.clearance : 0));
    upper.push({ x: p.x, z: p.z + zLift });
  }
  const direction = Math.sign(le.x - te.x);
  const tabs = [{ u: 0.18, width: c.ribTabWidth, depth: 8 }, { u: 0.82, width: c.ribTabWidth, depth: 8 }]
    .map(t => ({ ...t, cx: at(t.u, 0).x })).sort((a, b) => direction * (a.cx - b.cx));
  for (let i = 1; i < tabs.length; i++) {
    const clearance = (tabs[i - 1].width + tabs[i].width) / 2 + 2 * c.ribSlotClearance + 1;
    if (Math.abs(tabs[i].cx - tabs[i - 1].cx) < clearance) throw new Error(`距根部 ${y.toFixed(1)} mm 的翼肋卡榫太接近；請縮小卡榫寬度或調整扭角。`);
  }
  const points = [...upper, { x: te.x, z: te.z + zLift }];
  for (const tab of tabs) {
    const x1 = tab.cx - direction * tab.width / 2, x2 = tab.cx + direction * tab.width / 2;
    points.push({ x: x1, z: baseline(x1) }, { x: x1, z: -tab.depth }, { x: x2, z: -tab.depth }, { x: x2, z: baseline(x2) });
  }
  points.push({ x: le.x, z: le.z + zLift });
  const minX = Math.min(...points.map(p => p.x));
  const maxX = Math.max(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => -p.z));
  const maxY = Math.max(...points.map(p => -p.z));
  return { y, points, tabs, minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

export function packRibSheets(c) {
  const sheetW = c.ribSheetWidth, sheetH = c.ribSheetHeight, margin = 5, gap = 4, labelH = 8;
  const geoms = ribStations(c).map(y => ribGeometry(c, y, false));
  const baseFrameMinX = Math.min(...geoms.map(g => g.minX));
  const panelLeft = baseFrameMinX - c.moldMargin - 11;
  const pages = [];
  let page = { placements: [], x: margin, y: margin, rowH: 0 };
  const nextPage = () => { if (page.placements.length) pages.push(page); page = { placements: [], x: margin, y: margin, rowH: 0 }; };
  for (const [ribIndex, g] of geoms.entries()) {
    const panelW = g.maxX - panelLeft + c.moldMargin;
    const panelH = Math.max(panelW, g.height + 2 * c.moldMargin);
    const tabDepth = 8;
    g.panel = { x: panelLeft, w: panelW, bodyH: panelH, tabDepth };
    const w = panelW + 2 * gap, h = panelH + tabDepth + 2 * gap + labelH;
    if (w > sheetW - 2 * margin || h > sheetH - 2 * margin) throw new Error(`距根部 ${g.y.toFixed(1)} mm 的上下模合併翼肋超出排版板尺寸；請加大翼肋板寬／高。`);
    if (page.x + w > sheetW - margin) { page.x = margin; page.y += page.rowH + gap; page.rowH = 0; }
    if (page.y + h > sheetH - margin) nextPage();
    page.placements.push({ g, ribNumber: ribIndex + 1, x: page.x + gap - g.panel.x, y: page.y + gap + labelH, labelY: page.y + gap + 3 });
    page.x += w + gap;
    page.rowH = Math.max(page.rowH, h);
  }
  nextPage();
  return pages.map((pg, i) => {
    const paths = pg.placements.map(({ g, ribNumber, x, y, labelY }) => {
      const P = g.panel;
      const px = v => v + x, py = v => v + y;
      const tabs = g.tabs.map(t => ({ ...t, cx: t.cx - P.x })).sort((a, b) => a.cx - b.cx);
      let outline = `M${px(2)} ${py(2)} L${px(P.w - 2)} ${py(2)} L${px(P.w)} ${py(4)} L${px(P.w)} ${py(P.bodyH - 2)} L${px(P.w - 2)} ${py(P.bodyH)}`;
      for (const t of [...tabs].reverse()) {
        const left = t.cx - t.width / 2, right = t.cx + t.width / 2;
        outline += ` L${px(right)} ${py(P.bodyH)} L${px(right)} ${py(P.bodyH + 8)} L${px(left)} ${py(P.bodyH + 8)} L${px(left)} ${py(P.bodyH)}`;
      }
      outline += ` L${px(2)} ${py(P.bodyH)} L${px(0)} ${py(P.bodyH - 2)} L${px(0)} ${py(4)} Z`;
      const curve = g.points.slice(0, 49);
      const zMin = Math.min(...curve.map(p => p.z));
      const zMax = Math.max(...curve.map(p => p.z));
      const profileRange = zMax - zMin;
      const yOffset = Math.min(P.bodyH * 0.2, P.bodyH - profileRange - 6) - zMin;
      const section = curve.map(p => ({ x: p.x - P.x, y: yOffset + p.z }));
      const cut = [{ x: 0, y: section[0].y }, ...section, { x: P.w, y: section.at(-1).y }];
      const splitPath = `<path d="${cut.map((p, j) => `${j ? 'L' : 'M'}${px(p.x).toFixed(3)} ${py(p.y).toFixed(3)}`).join(' ')}"/>`;
      const sectionMinY = Math.min(...section.map(p => p.y));
      const sectionMaxY = Math.max(...section.map(p => p.y));
      const upperLabelY = py(Math.max(8, sectionMinY - P.bodyH * 0.12));
      const lowerLabelY = py(Math.min(P.bodyH - 8, sectionMaxY + P.bodyH * 0.12));
      return `<text x="${px(P.w / 2)}" y="${labelY}" text-anchor="middle" font-size="3.5" fill="#0000ff">R${String(ribNumber).padStart(2, '0')} · ${g.y.toFixed(1)} mm</text><path d="${outline}" fill="none" stroke="#ff0000" stroke-width="0.1"/>${splitPath}<text x="${px(P.w * 0.52)}" y="${upperLabelY}" text-anchor="middle" font-size="4" fill="#0000ff">上模具</text><text x="${px(P.w * 0.52)}" y="${lowerLabelY}" text-anchor="middle" font-size="4" fill="#0000ff">下模具</text>`;
    }).join('');
    return {
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${sheetW}mm" height="${sheetH}mm" viewBox="0 0 ${sheetW} ${sheetH}"><title>上、下模合併翼肋雷切排版 ${i + 1}</title><desc>1:1 mm；每站上、下模在同一片木板排版，紅線由左側切至右側，切下後分為上模具與下模具兩片；每片以兩個外側卡榫定位，不設中央卡榫或固定梁；藍字為雷雕編號。</desc>${paths}</svg>`,
      count: pg.placements.length
    };
  });
}

export function ribBaseSvg(c) {
  const ys = ribStations(c);
  const geoms = ys.map(y => ribGeometry(c, y, false));
  const minX = Math.min(...geoms.map(g => g.minX));
  const maxX = Math.max(...geoms.map(g => g.maxX));
  const margin = c.moldMargin;
  const span = c.stations.at(-1).y;
  const labelBand = 11;
  const w = maxX - minX + 2 * margin + labelBand;
  const h = span + 2 * margin;
  const slotH = c.ribStockThickness + 2 * c.ribSlotClearance;
  const slots = geoms.map(g => g.tabs.map(t => {
    const slotW = t.width + 2 * c.ribSlotClearance;
    const x = t.cx - minX + margin + labelBand - slotW / 2;
    const y = g.y + margin - slotH / 2;
    return `<rect x="${x.toFixed(3)}" y="${y.toFixed(3)}" width="${slotW.toFixed(3)}" height="${slotH.toFixed(3)}"/>`;
  }).join('')).join('');
  const labels = geoms.map((g, i) => `<text x="2" y="${(g.y + margin + 1.2).toFixed(3)}" font-size="3.2" fill="#0000ff">R${String(i + 1).padStart(2, '0')}</text>`).join('');
  const holes = [[margin + 2, margin + 2], [w - margin - 2, margin + 2], [margin + 2, h - margin - 2], [w - margin - 2, h - margin - 2]]
    .map(([x, y]) => `<circle cx="${x.toFixed(3)}" cy="${y.toFixed(3)}" r="1.6"/>`).join('');
  const outline = `M2 0.1 H${(w - 2).toFixed(3)} L${(w - 0.1).toFixed(3)} 2 V${(h - 2).toFixed(3)} L${(w - 2).toFixed(3)} ${(h - 0.1).toFixed(3)} H2 L0.1 ${(h - 2).toFixed(3)} V2 Z`;
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w.toFixed(3)}mm" height="${h.toFixed(3)}mm" viewBox="0 0 ${w.toFixed(3)} ${h.toFixed(3)}"><title>翼肋底板雙側卡槽</title><desc>1:1 mm；紅線切割，藍字 R 編號雷雕。每站只開兩個外側卡槽，中央卡槽和固定梁已取消。另有四個直徑 3.2 mm 底板固定孔。</desc><path d="${outline}" fill="none" stroke="#ff0000" stroke-width="0.1"/><g fill="none" stroke="#ff0000" stroke-width="0.1">${slots}${holes}</g><g font-family="sans-serif" text-anchor="start">${labels}</g></svg>`,
    width: w,
    height: h,
    count: geoms.length
  };
}
