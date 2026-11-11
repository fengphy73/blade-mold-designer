import { upperSurfaceLengthRatio } from './airfoil.js';
import { effectiveJoint } from './joint.js';
import {
  DEFAULT_STATIONS, validateConfig, station, slitPitchRange, bladeSvgStart, reliefDepth, clamp
} from './model.js';
import { buildMold } from './mesh.js';
import { buildBlade } from './blade.js';
import { meshToStl } from './stl.js';
import { bladePlanformSvg } from './svg-blade.js';
import { packRibSheets, ribBaseSvg, ribStations } from './svg-ribs.js';
import { drawAll, bindJointControls } from './preview2d.js';
import { initPreview3d, updatePreview3d } from './preview3d.js';

const ids = ['wood', 'clearance', 'printer', 'jointClearance', 'jointWidth', 'jointDepth', 'jointAngle', 'rootPadLength', 'rootBlendLength', 'rootBarWidth', 'rootBarThickness', 'rootBarPosition', 'rootBarClearance', 'moldMargin', 'moldBackThickness', 'stopHeight', 'cornerRadius', 'slitLength', 'slitPitch1', 'slitPitch2', 'slitGap', 'twistPerRow', 'minSlitPitch', 'slitPitchScale', 'twistAxis', 'slitAngle', 'slitStagger', 'chordSlitPitch', 'slitRootKeep', 'slitEdgeKeep', 'ribStockThickness', 'ribSpacing', 'ribTabWidth', 'ribSlotClearance', 'ribSheetWidth', 'ribSheetHeight', 'teMinThickness'];
const paramIds = [...ids, 'rootPadEnabled', 'clampEnabled', 'locatorEnabled', 'jointManual', 'autoSlitDensity', 'slitPattern1', 'slitPattern2'];
const $ = id => document.getElementById(id);
const val = id => Number($(id).value);
let config = null;
let toastTimer;

function readForm() {
  const c = Object.fromEntries(ids.map(id => [id, val(id)]));
  c.rootPadEnabled = $('rootPadEnabled').checked;
  c.clampEnabled = $('clampEnabled').checked;
  c.locatorEnabled = $('locatorEnabled').checked;
  c.jointManual = $('jointManual').checked;
  c.autoSlitDensity = $('autoSlitDensity').checked;
  c.slitPattern1 = $('slitPattern1').value;
  c.slitPattern2 = $('slitPattern2').value;
  c.stations = Array.from($('stationRows').querySelectorAll('tr'), row => ({
    y: Number(row.querySelector('[data-key="y"]').value),
    chord: Number(row.querySelector('[data-key="chord"]').value),
    twist: Number(row.querySelector('[data-key="twist"]').value)
  }));
  return validateConfig(c);
}

function showToast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2800);
}

function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1200);
}

function renderStationRows(data) {
  $('stationRows').innerHTML = data.map((s, i) => `<tr data-index="${i}"><td>${i === 0 ? '根' : i === data.length - 1 ? '尖' : i}</td><td><input data-key="y" aria-label="第 ${i + 1} 站距根部 mm" type="number" min="0" step="1" value="${s.y}" ${i === 0 ? 'disabled' : ''}></td><td><input data-key="chord" aria-label="第 ${i + 1} 站弦長 mm" type="number" min="1" step="1" value="${s.chord}"></td><td><input data-key="twist" aria-label="第 ${i + 1} 站扭角" type="number" step="0.5" value="${s.twist}"></td><td>${i === 0 ? '' : `<button type="button" data-remove="${i}" aria-label="刪除第 ${i + 1} 站">×</button>`}</td></tr>`).join('');
}

function currentStations() {
  return Array.from($('stationRows').querySelectorAll('tr'), row => ({
    y: Number(row.querySelector('[data-key="y"]').value),
    chord: Number(row.querySelector('[data-key="chord"]').value),
    twist: Number(row.querySelector('[data-key="twist"]').value)
  }));
}

function configFile() {
  return JSON.stringify({ ...config, profile: 'NACA 2412', purpose: '上翼面配對壓模（含可選葉根平面接合段）' }, null, 2);
}

function updateLabels(c) {
  const joint = effectiveJoint(c);
  $('slitAngleWrap').hidden = c.slitPattern1 !== 'chevron' && c.slitPattern2 !== 'chevron';
  $('developedWidthRows').innerHTML = c.stations.map((s, i) => {
    const label = i === 0 ? '根' : i === c.stations.length - 1 ? '尖' : String(i);
    const chord = station(c, s.y).chord;
    const developed = chord * upperSurfaceLengthRatio;
    return `<tr><td>${label} · ${s.y}</td><td>${chord.toFixed(1)}</td><td>${developed.toFixed(1)} <span style="color:#66716b">(+${(developed - chord).toFixed(1)})</span></td></tr>`;
  }).join('');
  $('moldDimensionsResult').textContent = `根部 STL 名目外寬：${(station(c, 0).chord + 2 * c.moldMargin).toFixed(1)} mm（弦長 ${station(c, 0).chord} + 每側預留 ${c.moldMargin} mm）；橫條承座 ${c.rootBarPosition.toFixed(1)} mm 位置，凹槽 ${(c.rootBarWidth + 2 * c.rootBarClearance).toFixed(1)} × ${(c.rootBarThickness / 2).toFixed(1)} mm；最薄背板 ${c.moldBackThickness} mm`;
  ['jointClearance', 'jointWidth', 'jointDepth', 'jointAngle'].forEach(id => { $(id).disabled = !c.jointManual; });
  const total = joint.clearance * 2;
  $('jointFitResult').textContent = c.printableSegments.length > 1
    ? `每側 ${joint.clearance.toFixed(1)} mm，凹槽總寬增加 ${total.toFixed(1)} mm · 頭部寬 ${joint.width.toFixed(0)} mm · 接合深 ${joint.depth.toFixed(1)} mm · 斜面 ${joint.angle.toFixed(0)}°${c.jointManual ? '' : ' · 進階未啟用，使用建議值'}`
    : '整段列印，不生成分段定位面';
  const relief = reliefDepth(c);
  $('locatorResult').textContent = c.locatorEnabled
    ? `下模擋邊 ${c.stopHeight.toFixed(1)} mm · 上模對應退讓槽深 ${relief.toFixed(1)} mm · 背板餘厚至少 ${(c.moldBackThickness - relief).toFixed(1)} mm${c.rootPadEnabled ? ` · 葉根 0–${(c.rootPadLength + c.rootBlendLength).toFixed(0)} mm 不設擋邊` : ''}`
    : '下模兩側擋邊；與上模保留 0.3 mm 間隙';
  const svgStart = bladeSvgStart(c);
  const fullSpan = c.stations.at(-1).y;
  const p1 = slitPitchRange(c, c.slitPitch1, svgStart);
  const p2 = slitPitchRange(c, c.slitPitch2, svgStart);
  $('bladeSvgLengthResult').textContent = `葉片 SVG 長度：${(fullSpan - svgStart).toFixed(1)} mm（距圓心 ${svgStart.toFixed(1)}→${fullSpan.toFixed(1)} mm）`;
  $('adaptiveDensityResult').textContent = c.autoSlitDensity
    ? `目前每排間距估算：第一層 ${p1.min.toFixed(1)}–${p1.max.toFixed(1)} mm；第二層 ${p2.min.toFixed(1)}–${p2.max.toFixed(1)} mm`
    : `目前每排間距：第一層 ${Math.max(c.slitPitch1 * c.slitPitchScale, c.minSlitPitch, c.slitLength + c.slitGap).toFixed(1)} mm；第二層 ${Math.max(c.slitPitch2 * c.slitPitchScale, c.minSlitPitch, c.slitLength + c.slitGap).toFixed(1)} mm`;
}

function drawParts(c, molds = []) {
  const list = $('partList');
  list.innerHTML = '';
  const segments = c.printableSegments;
  const joint = effectiveJoint(c);
  for (let i = 0; i < segments.length; i++) {
    const { start, end } = segments[i];
    const len = end - start;
    const row = document.createElement('div');
    row.className = 'part-row';
    const info = document.createElement('div');
    const a = station(c, start), b = station(c, end);
    let suffix = segments.length > 1
      ? (i > 0 ? ' · 起始端鳩尾凹槽' : '') + (i < segments.length - 1 ? ' · 尾端一體鳩尾凸舌' : '')
      : ' · 整段無分段接縫';
    if (c.clampEnabled) suffix += ' · 含 4 個 M3 夾模孔';
    if (c.locatorEnabled) suffix += ' · 下模含兩側定位擋邊';
    const angleWarning = c.stations.some(s => s.y >= start && s.y <= end && Math.abs(s.twist) > 45)
      ? '<div class="part-detail twist-warning">⚠ 本段含有超過 ±45° 的站位扭角，請檢查該站輸入值。</div>' : '';
    const printSpan = len + (segments.length > 1 && i < segments.length - 1 ? clamp(joint.depth, 1, 8) : 0);
    const upper = molds.find(m => m.segmentIndex === i && m.kind === 'upper');
    const lower = molds.find(m => m.segmentIndex === i && m.kind === 'lower');
    const heightNote = upper && lower
      ? `<div class="part-detail">上模高 ${upper.height.toFixed(1)} mm · 下模高 ${lower.height.toFixed(1)} mm（背板依本段扭角，最薄 ${c.moldBackThickness} mm）</div>`
      : '';
    info.innerHTML = `<div class="part-name">${segments.length > 1 ? `列印零件 ${i + 1}` : '整體模具'}・${start.toFixed(1)}–${end.toFixed(1)} mm</div><div class="part-detail">段長 ${len.toFixed(1)} mm${printSpan > len ? `（含凸舌最大長 ${printSpan.toFixed(1)} mm）` : ''}　·　弦長 ${a.chord.toFixed(1)}→${b.chord.toFixed(1)} mm　·　扭角 ${a.twist.toFixed(1)}°→${b.twist.toFixed(1)}°${suffix}</div>${heightNote}${angleWarning}`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '下載這段 STL';
    btn.addEventListener('click', () => downloadSegment(c, i));
    row.append(info, btn);
    list.append(row);
  }
}

function downloadSegment(c, index) {
  const n = index + 1;
  showToast(`正在建立第 ${n} 段 STL…`);
  setTimeout(() => {
    try {
      const pad = String(n).padStart(2, '0');
      const lower = buildMold(c, index, 'lower');
      const upper = buildMold(c, index, 'upper');
      saveBlob(new Blob([meshToStl(lower, `lower-concave-mold-${pad}`)]), `lower-concave-mold-${pad}.stl`);
      setTimeout(() => saveBlob(new Blob([meshToStl(upper, `upper-convex-mold-${pad}`)]), `upper-convex-mold-${pad}.stl`), 250);
      const warn = [...new Set([...lower.warnings, ...upper.warnings])];
      showToast(warn[0] || `第 ${n} 段下模凹面與上模凸面 STL 已下載。`);
    } catch (e) { showToast(e.message); }
  }, 30);
}

function renderRibDownloads(c) {
  const sheets = packRibSheets(c);
  const base = ribBaseSvg(c);
  const box = $('ribDownloads');
  $('ribOutputInfo').textContent = `共 ${ribStations(c).length} 個站位；每張排版板同時含上、下模剖面，弧線切穿後分成兩片；排版板 ${c.ribSheetWidth} × ${c.ribSheetHeight} mm；底板 ${base.width.toFixed(1)} × ${base.height.toFixed(1)} mm；每站兩個外側卡槽。模具工作間隙參考木片 ${c.wood} mm + 模具間隙 ${c.clearance} mm = ${(c.wood + c.clearance).toFixed(1)} mm，需由上下模安裝高度留出。`;
  const buttons = [];
  sheets.forEach((p, i) => buttons.push({ label: `下載上下模合併翼肋 ${i + 1}/${sheets.length}`, svg: p.svg, file: `laser-upper-lower-ribs-${String(i + 1).padStart(2, '0')}.svg` }));
  buttons.push({ label: '下載底板卡槽 SVG', svg: base.svg, file: 'laser-rib-base-slots.svg' });
  box.innerHTML = '';
  for (const item of buttons) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = item.label;
    btn.addEventListener('click', () => {
      saveBlob(new Blob([item.svg], { type: 'image/svg+xml;charset=utf-8' }), item.file);
      showToast(`${item.file} 已下載（1:1 mm）。`);
    });
    box.append(btn);
  }
}

function applyToolingMode() {
  const mode = $('toolingMode').value;
  const ribs = mode === 'ribs';
  const blade = mode === 'blade';
  $('previewSvg').hidden = ribs || blade;
  $('previewCaption').hidden = ribs || blade;
  $('ribPreview').hidden = !ribs;
  $('partList').hidden = ribs || blade;
  $('printedFooter').hidden = ribs || blade;
  $('ribToolingOutput').hidden = !ribs;
  $('bladeToolingOutput').hidden = !blade;
  $('segmentStat').hidden = ribs;
  $('segmentUnit').textContent = blade ? '葉片零件' : '模具零件';
  $('preview3dPanel').hidden = ribs;
  $('previewSubtitle').textContent = ribs
    ? '每站上下模合排在一片木板，紅線切穿分成兩片；底座只留兩側卡槽'
    : blade
      ? '完整翼型直接列印；超過列印長度才以鳩尾或平面對接拆件'
      : '虛線是造型站位；只有超出列印長度的接縫才會拆開';
  $('partsDescription').textContent = ribs
    ? '每張翼肋 SVG 同一排版含上模具、下模具；弧形紅線由板件左側切到右側，切開後分成兩片。另輸出僅有兩側卡槽的底板 SVG；不再輸出中央卡槽或固定梁。'
    : blade
      ? '每一段下載一個封閉的完整翼型 STL，檔名 blade-full-NN.stl。上下表面都是 NACA 2412，扭角與壓模相同。'
      : 'STL 依實際列印零件下載；啟用葉根接合段時，下模只在橫條位置形成局部凹座，其他翼面維持 NACA 2412 形狀。雷切 SVG 並排輸出兩層葉片外形與短切線，單位 mm，比例 1:1。';
}

function drawBladeParts(c, blades) {
  const list = $('bladePartList');
  const notes = [...new Set(blades.flatMap(b => b.warnings))];
  $('bladeJointNote').textContent = notes.length
    ? notes.join(' ')
    : (blades.some(b => b.joint === 'dovetail')
      ? `鳩尾沿葉片長度接合。每側間隙 ${effectiveJoint(c).clearance.toFixed(1)} mm，凹槽比凸舌寬 ${(effectiveJoint(c).clearance * 2).toFixed(1)} mm，並留在翼型截面內部。`
      : '這支葉片不必分段，輸出整段、沒有接縫。');
  list.innerHTML = '';
  blades.forEach((mesh, i) => {
    const row = document.createElement('div');
    row.className = 'part-row';
    const info = document.createElement('div');
    const jointText = mesh.joint === 'dovetail'
      ? (i === 0 ? '尾端凸舌' : '起始端凹槽')
      : mesh.joint === 'butt' ? '平面對接' : '整段無接縫';
    info.innerHTML = `<div class="part-name">葉片段 ${i + 1}・${c.printableSegments[i].start.toFixed(1)}–${c.printableSegments[i].end.toFixed(1)} mm</div><div class="part-detail">弦長 ${mesh.chordStart.toFixed(1)}→${mesh.chordEnd.toFixed(1)} mm · 扭角 ${mesh.twistStart.toFixed(1)}°→${mesh.twistEnd.toFixed(1)}° · ${jointText}</div><div class="part-detail">列印尺寸 X ${ (mesh.maxX - mesh.minX).toFixed(1) } × Y ${ (mesh.maxY - mesh.minY).toFixed(1) } × Z ${mesh.height.toFixed(1)} mm · 後緣至少 ${c.teMinThickness.toFixed(1)} mm</div>`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '下載這段葉片';
    const pad = String(i + 1).padStart(2, '0');
    btn.addEventListener('click', () => {
      saveBlob(new Blob([meshToStl(mesh, `blade-full-${pad}`)]), `blade-full-${pad}.stl`);
      showToast(`blade-full-${pad}.stl 已下載。`);
    });
    row.append(info, btn);
    list.append(row);
  });
}

function update() {
  try {
    config = readForm();
    updateLabels(config);
    drawAll(config);
    const mode = $('toolingMode').value;
    if (mode === 'blade') {
      const blades = config.printableSegments.map((_, i) => buildBlade(config, i));
      drawBladeParts(config, blades);
      updatePreview3d(config, blades, 'blade');
    } else {
      const molds = [];
      for (let i = 0; i < config.printableSegments.length; i++) {
        for (const kind of ['lower', 'upper']) molds.push(buildMold(config, i, kind));
      }
      drawParts(config, molds);
      if (mode !== 'ribs') updatePreview3d(config, molds, 'printed');
    }
    try { renderRibDownloads(config); }
    catch (e) { $('ribOutputInfo').textContent = e.message; $('ribDownloads').innerHTML = ''; }
  } catch (e) { showToast(e.message); }
}

function wire() {
  ids.forEach(id => $(id).addEventListener('input', update));
  ['rootPadEnabled', 'autoSlitDensity', 'clampEnabled', 'locatorEnabled', 'jointManual'].forEach(id => $(id).addEventListener('change', update));
  ['slitPattern1', 'slitPattern2'].forEach(id => $(id).addEventListener('change', update));
  $('airfoilStation').addEventListener('change', () => { if (config) drawAll(config); });
  $('toolingMode').addEventListener('change', () => { applyToolingMode(); update(); });
  bindJointControls(() => { if (config) drawAll(config); });
  $('stationRows').addEventListener('input', update);
  $('stationRows').addEventListener('click', e => {
    const button = e.target.closest('[data-remove]');
    if (!button) return;
    const rows = currentStations();
    if (rows.length <= 2) { showToast('至少保留根部和尖端兩站。'); return; }
    rows.splice(Number(button.dataset.remove), 1);
    renderStationRows(rows);
    update();
  });
  $('addStation').addEventListener('click', () => {
    const rows = currentStations();
    const a = rows.at(-2), b = rows.at(-1);
    const mid = {
      y: Math.round((a.y + b.y) / 2),
      chord: +((a.chord + b.chord) / 2).toFixed(1),
      twist: +((a.twist + b.twist) / 2).toFixed(1)
    };
    if (mid.y === a.y || mid.y === b.y) { showToast('兩個站位距離太近，無法新增中間站。'); return; }
    rows.splice(rows.length - 1, 0, mid);
    renderStationRows(rows);
    update();
  });
  $('downloadSvg').addEventListener('click', () => {
    try {
      const c = readForm();
      saveBlob(new Blob([bladePlanformSvg(c)], { type: 'image/svg+xml;charset=utf-8' }), 'blade-two-layer-slits.svg');
      showToast('雙層雷切 SVG 已下載（圖樣依目前設定）。');
    } catch (e) { showToast(e.message); }
  });
  $('saveParams').addEventListener('click', () => {
    try {
      config = readForm();
      saveBlob(new Blob([configFile()], { type: 'application/json' }), 'blade-mold-parameters.json');
      showToast('參數檔已儲存。');
    } catch (e) { showToast(e.message); }
  });
  $('loadParams').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      for (const id of paramIds) {
        if (data[id] === undefined) continue;
        if (['rootPadEnabled', 'clampEnabled', 'locatorEnabled', 'jointManual', 'autoSlitDensity'].includes(id)) $(id).checked = Boolean(data[id]);
        else $(id).value = data[id];
      }
      if (Array.isArray(data.stations) && data.stations.length >= 2) renderStationRows(data.stations);
      update();
      showToast('參數已載入。');
    } catch { showToast('無法讀取參數檔。'); }
    e.target.value = '';
  });
}

renderStationRows(DEFAULT_STATIONS.map(s => ({ ...s })));
initPreview3d();
wire();
applyToolingMode();
update();
