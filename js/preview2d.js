import { airfoilYZ } from './airfoil.js';
import { effectiveJoint, seamProfile, profilePolyline } from './joint.js';
import {
  clamp, station, rawStation, planformYs, surfaceZ, lowerMoldSurfaceZ, faceEnvelope, fenceStartY, reliefDepth
} from './model.js';
import { ribStations } from './svg-ribs.js';

let jointViewAngle = 0;
let jointExploded = false;

const $ = id => document.getElementById(id);

export function drawAll(c) {
  drawAirfoil(c);
  drawPreview(c);
  drawJoint(c);
  drawRib(c);
}

export function bindJointControls(redraw) {
  $('jointRotateLeft').addEventListener('click', () => { jointViewAngle = (jointViewAngle + 348) % 360; redraw(); });
  $('jointRotateRight').addEventListener('click', () => { jointViewAngle = (jointViewAngle + 12) % 360; redraw(); });
  $('jointExplode').addEventListener('click', () => { jointExploded = !jointExploded; redraw(); });
}

function drawAirfoil(c) {
  const selector = $('airfoilStation');
  const old = Number(selector.value) || 0;
  selector.innerHTML = c.stations.map((s, i) => `<option value="${i}">${i === 0 ? '根部' : i === c.stations.length - 1 ? '葉尖' : `站位 ${i}`} · ${s.y} mm</option>`).join('');
  const index = Math.min(old, c.stations.length - 1);
  selector.value = String(index);
  const s = c.stations[index];
  const chord = s.chord;
  const scale = 480, x0 = 80, cy = 90;
  const axisX = x0 + scale * c.twistAxis / 100;
  const points = [];
  for (let i = 0; i <= 120; i++) {
    const u = (1 - Math.cos(Math.PI * i / 120)) / 2;
    const yz = airfoilYZ(u);
    points.push([x0 + u * scale, cy - yz.upper * scale]);
  }
  for (let i = 120; i >= 0; i--) {
    const u = (1 - Math.cos(Math.PI * i / 120)) / 2;
    const yz = airfoilYZ(u);
    points.push([x0 + u * scale, cy - yz.lower * scale]);
  }
  const d = points.map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(2)} ${q[1].toFixed(2)}`).join(' ') + ' Z';
  $('airfoilInfo').textContent = `${s.y} mm 站位　·　弦長 ${chord} mm　·　扭角 ${s.twist}°　·　扭轉軸 ${c.twistAxis}% 弦長　·　最大厚度 ${(0.12 * chord).toFixed(1)} mm`;
  $('airfoilSvg').innerHTML = `<line x1="${x0}" y1="${cy}" x2="${x0 + scale}" y2="${cy}" stroke="#9aa69d" stroke-dasharray="4 4"/><path d="${d}" fill="#dce8df" stroke="#326b55" stroke-width="2.5"/><line x1="${axisX}" y1="35" x2="${axisX}" y2="145" stroke="#7354a5" stroke-dasharray="4 3" stroke-width="1.5"/><circle cx="${axisX}" cy="${cy}" r="3" fill="#7354a5"/><text x="${x0}" y="24" font-size="11" fill="#326b55">前緣</text><text x="${x0 + scale}" y="24" text-anchor="end" font-size="11" fill="#326b55">後緣</text><line x1="${x0}" y1="157" x2="${x0 + scale}" y2="157" stroke="#7f8983"/><line x1="${x0}" y1="153" x2="${x0}" y2="161" stroke="#7f8983"/><line x1="${x0 + scale}" y1="153" x2="${x0 + scale}" y2="161" stroke="#7f8983"/><text x="${x0 + scale / 2}" y="174" text-anchor="middle" font-size="11" fill="#66716b">弦長 ${chord} mm</text><text x="${axisX + 5}" y="40" font-size="10" fill="#7354a5">扭轉軸 ${c.twistAxis}%</text>`;
}

function drawPreview(c) {
  const ss = c.stations, span = ss.at(-1).y, segments = c.printableSegments, shapeYs = planformYs(c), svg = $('previewSvg');
  $('segmentCount').textContent = `${segments.length} 件`;
  const maxw = Math.max(...ss.map(s => s.chord));
  const planScale = Math.min(610 / span, 148 / maxw);
  const spanPx = span * planScale, x0 = 75 + (610 - spanPx) / 2, y0 = 78;
  const planPoint = y => {
    const x = x0 + y * planScale, chord = station(c, y).chord;
    return { x, top: y0, bottom: y0 + chord * planScale };
  };
  let plan = '';
  for (const seg of segments) {
    const ys = [seg.start, ...shapeYs.filter(y => y > seg.start && y < seg.end), seg.end];
    const points = ys.map(planPoint);
    const top = points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.top}`).join(' ');
    const bottom = points.slice().reverse().map(p => `L${p.x} ${p.bottom}`).join(' ');
    plan += `<path d="${top} ${bottom} Z" fill="#dce8df" stroke="#557d65" stroke-width="1.4"/>`;
    const mid = planPoint((seg.start + seg.end) / 2);
    plan += `<text x="${mid.x}" y="${y0 + maxw * planScale + 20}" text-anchor="middle" font-size="11" fill="#66716b">${Math.round(seg.end - seg.start)} mm</text>`;
  }
  const flatEnd = c.rootPadLength, blendEnd = c.rootPadLength + c.rootBlendLength;
  const rootOverlay = c.rootPadEnabled ? (() => {
    const a = planPoint(0), b = planPoint(flatEnd), d = planPoint(blendEnd);
    return `<path d="M${a.x} ${a.top} L${b.x} ${b.top} L${b.x} ${b.bottom} L${a.x} ${a.bottom} Z" fill="#e8c98f" opacity=".76"/><path d="M${b.x} ${b.top} L${d.x} ${d.top} L${d.x} ${d.bottom} L${b.x} ${b.bottom} Z" fill="#dce8df" opacity=".85" stroke="#79907e" stroke-dasharray="4 3"/>`;
  })() : '';
  for (const s of ss.slice(1, -1)) {
    const p = planPoint(s.y);
    plan += `<line x1="${p.x}" y1="${p.top}" x2="${p.x}" y2="${p.bottom}" stroke="#8b978f" stroke-dasharray="3 4"/>`;
  }
  for (const seg of segments.slice(1)) {
    const p = planPoint(seg.start);
    plan += `<line x1="${p.x}" y1="${p.top}" x2="${p.x}" y2="${p.bottom}" stroke="#bd8040" stroke-width="3"/>`;
  }
  const axisPoints = [...new Set([0, ...shapeYs, span])].sort((a, b) => a - b).map(y => {
    const p = planPoint(y);
    return { x: p.x, y: p.top + (p.bottom - p.top) * c.twistAxis / 100 };
  });
  const axisPath = axisPoints.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  let clampPreview = '';
  if (c.clampEnabled) {
    for (const seg of segments) {
      const len = seg.end - seg.start, offset = Math.min(15, len / 2 - 7);
      for (const y of [seg.start + offset, seg.end - offset]) {
        const p = planPoint(y), lugW = 9 * planScale, lugH = 10 * planScale, r = 1.7 * planScale;
        for (const side of [-1, 1]) {
          const cy = side < 0 ? p.top - 4.1 * planScale : p.bottom + 4.1 * planScale;
          clampPreview += `<rect x="${p.x - lugW / 2}" y="${cy - lugH / 2}" width="${lugW}" height="${lugH}" rx="2" fill="#e8c98f" stroke="#9a6b35" stroke-width="1.2"/><circle cx="${p.x}" cy="${cy}" r="${r}" fill="#fff" stroke="#765128" stroke-width="1.1"/>`;
        }
      }
    }
  }
  let locatorPreview = '';
  if (c.locatorEnabled) {
    for (const seg of segments) {
      const locatorStart = Math.max(seg.start, fenceStartY(c));
      if (seg.end - locatorStart < 0.1) continue;
      const ys = [locatorStart, ...shapeYs.filter(y => y > locatorStart && y < seg.end), seg.end];
      const points = ys.map(planPoint);
      const strip = (outer, inner) => {
        const a = points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${outer(p)}`).join(' ');
        const b = points.slice().reverse().map(p => `L${p.x} ${inner(p)}`).join(' ');
        return `<path d="${a} ${b} Z" fill="#c9964e" stroke="#8c622e" stroke-width="0.8"/>`;
      };
      locatorPreview += strip(p => p.top - 1.5 * planScale, p => p.top - 0.3 * planScale);
      locatorPreview += strip(p => p.bottom + 0.3 * planScale, p => p.bottom + 1.5 * planScale);
    }
  }
  const sectionY = c.rootPadEnabled ? c.rootBarPosition : 0;
  const section = station(c, sectionY);
  const cx = 519, cy = 270, scale = 1.1, chord = section.chord, margin = c.moldMargin;
  const leftEdge = cx - margin * scale, rightEdge = cx + (chord + margin) * scale;
  const pts = [];
  const sectionAxisX = cx + chord * scale * c.twistAxis / 100;
  for (let i = 0; i <= 48; i++) {
    const u = i / 48;
    pts.push([cx + u * chord * scale, cy - surfaceZ(c, sectionY, u * chord, chord) * scale]);
  }
  const lowerPts = [];
  for (let i = 0; i <= 48; i++) {
    const u = i / 48;
    lowerPts.push([cx + u * chord * scale, cy - lowerMoldSurfaceZ(c, sectionY, u * chord, chord) * scale]);
  }
  const lowerCurve = lowerPts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const offset = Math.max(4, (c.wood + c.clearance) * scale);
  const woodPath = lowerPts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ') + lowerPts.slice().reverse().map(p => `L${p[0].toFixed(1)} ${(p[1] - offset).toFixed(1)}`).join(' ') + ' Z';
  const up = faceEnvelope(c, 0, span, 'upper');
  const lo = faceEnvelope(c, 0, span, 'lower');
  const maleBaseY = cy - (Math.min(up.minZ, lo.minZ) - c.moldBackThickness) * scale;
  const femaleTopY = cy - (Math.max(up.maxZ, lo.maxZ) + c.moldBackThickness) * scale;
  const shellLower = `M${leftEdge} ${cy} L${lowerCurve.slice(1)} L${rightEdge} ${cy} L${rightEdge} ${maleBaseY} L${leftEdge} ${maleBaseY} Z`;
  const femTop = lowerPts.map(p => [p[0], p[1] - offset]).map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const shellFemale = `M${leftEdge} ${cy - offset} L${femTop.slice(1)} L${rightEdge} ${cy - offset} L${rightEdge} ${femaleTopY} L${leftEdge} ${femaleTopY} Z`;
  const profileSpan = 610, padX = 75, padY = 394, padW = c.rootPadEnabled ? c.rootPadLength / span * profileSpan : 0;
  const blendW = c.rootPadEnabled ? c.rootBlendLength / span * profileSpan : 0;
  const endX = padX + padW + blendW, profileRight = padX + profileSpan;
  const sideCurve = c.rootPadEnabled
    ? `<rect x="${padX}" y="${padY - 4}" width="${padW}" height="14" rx="2" fill="#e8c98f"/><path d="M${padX + padW} ${padY + 3} C${padX + padW + blendW * 0.25} ${padY + 3}, ${padX + padW + blendW * 0.65} ${padY - 18}, ${endX} ${padY - 18} L${profileRight} ${padY - 18}" fill="none" stroke="#557d65" stroke-width="3"/><line x1="${padX}" y1="${padY + 12}" x2="${profileRight}" y2="${padY + 12}" stroke="#bd8040" stroke-width="2"/><text x="265" y="${padY + 30}" text-anchor="middle" font-size="11" fill="#765128">平面接合段 ${c.rootPadLength} mm</text><text x="490" y="${padY + 30}" text-anchor="middle" font-size="11" fill="#557d65">過渡段 ${c.rootBlendLength} mm</text>`
    : `<path d="M${padX} ${padY - 18} L${profileRight} ${padY - 18}" stroke="#557d65" stroke-width="3"/><text x="${padX}" y="${padY + 30}" font-size="10" fill="#66716b">未加入平面接合段</text>`;
  svg.innerHTML = `<text x="26" y="30" font-size="12" fill="#66716b">俯視・列印零件</text><line x1="26" y1="48" x2="48" y2="48" stroke="#7354a5" stroke-width="2" stroke-dasharray="5 3"/><text x="54" y="52" font-size="11" fill="#7354a5">扭轉軸：${c.twistAxis}% 弦長</text>${plan}${rootOverlay}<path d="${axisPath}" fill="none" stroke="#7354a5" stroke-width="2" stroke-dasharray="5 3"/>${clampPreview}${locatorPreview}
        <text x="510" y="30" font-size="12" fill="#66716b">葉根截面・配對模具</text>
        <path d="${shellFemale}" transform="translate(0 ${2 * cy}) scale(1 -1)" fill="#b8d1bf" stroke="#557d65" stroke-width="1.5"/>
        <path d="${woodPath}" transform="translate(0 ${2 * cy}) scale(1 -1)" fill="#d7a36d" stroke="#bd8040" stroke-width="1"/>
        <path d="${shellLower}" transform="translate(0 ${2 * cy}) scale(1 -1)" fill="#dce8df" stroke="#557d65" stroke-width="1.5"/>
        <line x1="${sectionAxisX}" y1="${cy - 14}" x2="${sectionAxisX}" y2="${cy + 15}" stroke="#7354a5" stroke-width="2" stroke-dasharray="4 2"/><circle cx="${sectionAxisX}" cy="${cy}" r="2.4" fill="#7354a5"/>
        <line x1="${cx}" y1="${cy + 47}" x2="${cx + chord * scale}" y2="${cy + 47}" stroke="#7f8983" stroke-width="1"/>
        <line x1="${cx}" y1="${cy + 43}" x2="${cx}" y2="${cy + 51}" stroke="#7f8983"/><line x1="${cx + chord * scale}" y1="${cy + 43}" x2="${cx + chord * scale}" y2="${cy + 51}" stroke="#7f8983"/>
        <text x="${cx + chord * scale / 2}" y="${cy + 63}" text-anchor="middle" font-size="11" fill="#66716b">${sectionY.toFixed(1)} mm 站位弦長 ${section.chord} mm</text>
        <line x1="${leftEdge}" y1="${cy + 86}" x2="${rightEdge}" y2="${cy + 86}" stroke="#7f8983" stroke-width="1"/>
        <line x1="${leftEdge}" y1="${cy + 82}" x2="${leftEdge}" y2="${cy + 90}" stroke="#7f8983"/><line x1="${rightEdge}" y1="${cy + 82}" x2="${rightEdge}" y2="${cy + 90}" stroke="#7f8983"/>
        <text x="${(leftEdge + rightEdge) / 2}" y="${cy + 103}" text-anchor="middle" font-size="10" fill="#66716b">模具外寬 ${ss[0].chord + 2 * margin} mm</text>
        <text x="${cx + 8}" y="${cy - 27}" font-size="10" fill="#66716b">上模（凸面支撐）</text>
        <text x="${cx + 8}" y="${cy + 42}" font-size="10" fill="#66716b">下模（凹面配合${c.rootPadEnabled ? '；橫條凹座' : ''}）</text>
        <text x="26" y="${y0 + maxw * planScale + 48}" font-size="11" fill="#66716b">總長 ${span} mm　｜　尖端弦長 ${ss.at(-1).chord} mm　｜　扭轉 ${ss[0].twist}° → ${ss.at(-1).twist}°</text>
        <text x="26" y="370" font-size="12" fill="#66716b">葉根平面接合段與翼型過渡示意</text>${sideCurve}`;
  void reliefDepth;
}

function outlineFromProfile(samples, xAt, yAt) {
  const top = samples.map((p, i) => `${i ? 'L' : 'M'}${xAt(p, p.xL).toFixed(1)} ${yAt(p).toFixed(1)}`);
  const bot = samples.slice().reverse().map(p => `L${xAt(p, p.xR).toFixed(1)} ${yAt(p).toFixed(1)}`);
  return top.concat(bot).join(' ');
}

function drawSeamSection(mode, profile, chord, split) {
  const svg = $('jointSeamSvg');
  if (!svg) return;
  const card = svg.closest('.joint-visual-card');
  if (mode !== 'blade') {
    if (card) card.hidden = true;
    return;
  }
  if (card) card.hidden = false;
  const W = 340, H = 168, pad = 36;
  const scale = (W - pad * 2) / chord;
  const mid = 92;
  const pts = [];
  for (let i = 0; i <= 48; i++) {
    const u = i / 48;
    const a = airfoilYZ(u);
    pts.push({
      x: pad + u * chord * scale,
      zu: mid - a.upper * chord * scale,
      zl: mid - a.lower * chord * scale
    });
  }
  const outline = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.zu.toFixed(1)}`).join(' ')
    + pts.slice().reverse().map(p => `L${p.x.toFixed(1)} ${p.zl.toFixed(1)}`).join(' ') + ' Z';
  const x0 = pad + (profile.center - profile.head / 2) * scale;
  const x1 = pad + (profile.center + profile.head / 2) * scale;
  const uc = profile.center / chord;
  const ac = airfoilYZ(uc);
  const zc = mid - ((ac.upper + ac.lower) / 2) * chord * scale;
  const thick = (ac.upper - ac.lower) * chord;
  const halfHpx = Math.max(3, Math.min(4, (thick - 2.4) / 2) * scale);
  const rect = `${x0.toFixed(1)},${(zc - halfHpx).toFixed(1)} ${x1.toFixed(1)},${(zc - halfHpx).toFixed(1)} ${x1.toFixed(1)},${(zc + halfHpx).toFixed(1)} ${x0.toFixed(1)},${(zc + halfHpx).toFixed(1)}`;
  const lead = pad;
  const trail = pad + chord * scale;
  svg.innerHTML = `<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="6" fill="#fbfcfa"/>
    <path d="${outline}" fill="#e7efe9" stroke="#557d65" stroke-width="1.6"/>
    <polygon points="${rect}" fill="#c4553a" fill-opacity="0.85" stroke="#8d2e22" stroke-width="1.2"/>
    <line x1="${lead}" y1="148" x2="${trail}" y2="148" stroke="#34463b" stroke-width="1.4"/>
    <text x="${lead}" y="24" font-size="10" fill="#31573e">前緣</text>
    <text x="${trail - 22}" y="24" font-size="10" fill="#31573e">後緣</text>
    <text x="${((x0 + x1) / 2).toFixed(1)}" y="${(zc - halfHpx - 6).toFixed(1)}" text-anchor="middle" font-size="9" fill="#8d2e22">鳩尾 ${ (profile.centerFraction * 100 - profile.joint.widthPercent / 2).toFixed(0) }–${ (profile.centerFraction * 100 + profile.joint.widthPercent / 2).toFixed(0) }%</text>
    <text x="170" y="162" text-anchor="middle" font-size="8" fill="#66716b">${split ? '接縫截面（前緣在左）' : '示意截面（目前整段、無接縫）'}・頭部在厚的一側</text>`;
}

function drawJoint(c) {
  const mode = $('toolingMode')?.value === 'blade' ? 'blade' : 'mold';
  const joint = effectiveJoint(c, mode);
  const split = c.printableSegments.length > 1;
  const seam = split ? c.printableSegments[0].end : 0;
  const chord = split
    ? (mode === 'blade' ? rawStation(c, seam).chord : station(c, seam).chord)
    : c.stations[0].chord;
  const profile = seamProfile(joint, chord);
  const tongue = profilePolyline(profile, 'tongue', 22);
  const socket = profilePolyline(profile, 'socket', 22);
  const neck = profile.neck;
  const head = profile.head;
  const px = 36 / Math.max(head, 6);
  const depthPx = Math.max(18, Math.min(56, 34 * profile.depth / 8));
  const bodyTop = 40, bodyBot = 118, mid = (bodyTop + bodyBot) / 2;
  const tonguePath = `M20 ${bodyTop} L90 ${bodyTop} ` + tongue.map(p => {
    const x = 90 + (p.t * depthPx);
    return `L${x.toFixed(1)} ${(mid - p.width * px / 2).toFixed(1)}`;
  }).join(' ') + tongue.slice().reverse().map(p => {
    const x = 90 + (p.t * depthPx);
    return `L${x.toFixed(1)} ${(mid + p.width * px / 2).toFixed(1)}`;
  }).join(' ') + ` L90 ${bodyBot} L20 ${bodyBot} Z`;
  const sockDepth = depthPx;
  const socketPath = `M150 ${bodyTop} L246 ${bodyTop} L246 ${bodyBot} L150 ${bodyBot} ` + socket.slice().reverse().map(p => {
    const x = 150 + p.t * sockDepth;
    return `L${x.toFixed(1)} ${(mid + p.width * px / 2).toFixed(1)}`;
  }).join(' ') + socket.map(p => {
    const x = 150 + p.t * sockDepth;
    return `L${x.toFixed(1)} ${(mid - p.width * px / 2).toFixed(1)}`;
  }).join(' ') + ' Z';
  $('jointDirectionSvg').innerHTML = `<rect x="1" y="1" width="258" height="148" rx="6" fill="#fbfcfa"/><text x="68" y="18" text-anchor="middle" font-size="9" fill="#31573e">A 段・一體凸舌</text><text x="198" y="18" text-anchor="middle" font-size="9" fill="#31573e">B 段・配合凹槽</text><path d="${tonguePath}" fill="#dce8df" stroke="#557d65" stroke-width="2"/><path d="${socketPath}" fill="#eaf0e9" stroke="#557d65" stroke-width="2"/><line x1="34" y1="133" x2="225" y2="133" stroke="#34463b" stroke-width="2"/><path d="M220 128 L230 133 L220 138" fill="none" stroke="#34463b" stroke-width="2"/><text x="130" y="146" text-anchor="middle" font-size="8" fill="#34463b">葉片長度方向（接合方向）・舌根 ${neck.toFixed(1)} mm → 頭部 ${head.toFixed(1)} mm</text>`;

  const yaw = jointViewAngle * Math.PI / 180;
  const dx = 22 * Math.cos(yaw), dy = -13;
  const P = (ox, oy, x, y, d = 0) => [ox + x + d * dx, oy + y + d * dy];
  const extrude = (ox, oy, poly, fill, side) => {
    const front = poly.map(([x, y]) => P(ox, oy, x, y));
    const back = poly.map(([x, y]) => P(ox, oy, x, y, 1));
    const polyS = pts => pts.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ');
    const sides = poly.map((_, i) => {
      const j = (i + 1) % poly.length;
      return `<polygon points="${polyS([front[i], front[j], back[j], back[i]])}" fill="${side}" stroke="#557d65" stroke-width="1"/>`;
    }).join('');
    return `${sides}<polygon points="${polyS(back)}" fill="#e8eee9" stroke="#557d65" stroke-width="1.3"/><polygon points="${polyS(front)}" fill="${fill}" stroke="#476d56" stroke-width="2"/>`;
  };
  const tab = Math.max(16, Math.min(54, 32 * profile.depth / 8));
  const aPoly = [[0, 0], [78, 0]];
  tongue.forEach(p => aPoly.push([78 + p.t * tab, 28 - p.width * px * 0.55]));
  tongue.slice().reverse().forEach(p => aPoly.push([78 + p.t * tab, 28 + p.width * px * 0.55]));
  aPoly.push([78, 56], [0, 56]);
  const bPoly = [[0, 0], [78, 0], [78, 56], [0, 56]];
  socket.slice().reverse().forEach(p => bPoly.push([p.t * tab, 28 + p.width * px * 0.55]));
  socket.forEach(p => bPoly.push([p.t * tab, 28 - p.width * px * 0.55]));
  const bx = 150 + (jointExploded ? 28 : 0);
  const arrow = jointExploded ? `<line x1="116" y1="166" x2="164" y2="166" stroke="#bd5545" stroke-width="2.5"/><path d="M157 161 L166 166 L157 171" fill="none" stroke="#bd5545" stroke-width="2.5"/>` : '';
  $('joint3dSvg').innerHTML = `<rect x="1" y="1" width="338" height="188" rx="7" fill="#fbfcfa"/><text x="78" y="22" text-anchor="middle" font-size="10" fill="#31573e">A 段・窄頸寬頭凸舌</text><text x="250" y="22" text-anchor="middle" font-size="10" fill="#31573e">B 段・窄口寬腹凹槽</text>${extrude(bx, 58, bPoly, '#eaf0e9', '#c2d6c7')}${extrude(24, 58, aPoly, '#dce8df', '#afc9b7')}${arrow}<line x1="40" y1="158" x2="300" y2="158" stroke="#34463b" stroke-width="1.8"/><path d="M294 153 L303 158 L294 163" fill="none" stroke="#34463b" stroke-width="1.8"/><text x="170" y="174" text-anchor="middle" font-size="8" fill="#34463b">與 STL 同一鳩尾剖面；舌根窄、外端寬</text><text x="170" y="184" text-anchor="middle" font-size="8" fill="#66716b">每側 ${joint.clearance.toFixed(1)} mm，凹槽總寬增加 ${(joint.clearance * 2).toFixed(1)} mm</text>`;
  $('jointExplode').textContent = jointExploded ? '合起' : '分開';
  drawSeamSection(mode, profile, chord, split);
}

export function drawRib(c) {
  const ys = ribStations(c);
  const span = c.stations.at(-1).y;
  const step = 620 / span, x0 = 70, y0 = 55, w = 620, h = 100;
  const chordMax = Math.max(...c.stations.map(s => s.chord));
  let ribs = '';
  for (const y of ys) {
    const x = x0 + y * step;
    const st = station(c, y);
    const chordH = Math.max(8, st.chord / chordMax * h * 0.82);
    const top = y0 + (h - chordH) / 2;
    const slotWidth = c.ribStockThickness * step;
    ribs += `<line x1="${x.toFixed(2)}" y1="${top.toFixed(2)}" x2="${x.toFixed(2)}" y2="${(top + chordH).toFixed(2)}" stroke="#557d65" stroke-width="1.2"/>`;
    [0.2, 0.8].forEach(f => {
      const sy = top + chordH * f;
      const th = c.ribTabWidth / chordMax * h * 0.82;
      ribs += `<rect x="${(x - slotWidth / 2).toFixed(2)}" y="${(sy - th / 2).toFixed(2)}" width="${slotWidth.toFixed(2)}" height="${th.toFixed(2)}" fill="#e8c98f"/>`;
    });
  }
  $('ribPreviewSvg').innerHTML = `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" rx="2" fill="#fff" stroke="#66716b"/><text x="${x0}" y="35" font-size="11" fill="#66716b">底板俯視：每站兩個外側卡槽，沒有中央槽</text>${ribs}<text x="${x0}" y="180" font-size="11" fill="#66716b">根部 0 mm</text><text x="${x0 + w}" y="180" text-anchor="end" font-size="11" fill="#66716b">葉尖 ${span} mm</text><text x="70" y="215" font-size="11" fill="#66716b">同一片木板：弧線切穿後分成上下模（示意）</text><path d="M110 230 H510 V268 H440 V278 H410 V268 H210 V278 H180 V268 H110 Z" fill="#fff" stroke="#557d65" stroke-width="2"/><path d="M110 249 Q300 263 510 237" fill="none" stroke="#e15b4a" stroke-width="2"/><text x="310" y="241" text-anchor="middle" font-size="10" fill="#0000ff">上模具</text><text x="310" y="267" text-anchor="middle" font-size="10" fill="#0000ff">下模具</text><text x="535" y="243" font-size="10" fill="#66716b">紅線切至兩側</text><text x="535" y="261" font-size="10" fill="#66716b">兩側卡槽固定</text>`;
  $('ribPreviewNote').textContent = `共 ${ys.length} 片站位板；每片 SVG 同張排版含上、下模標示，紅色弧線切穿板件後分成兩片。底板每站只保留兩個外側卡槽，不輸出中央卡槽或梳齒固定梁。`;
}
