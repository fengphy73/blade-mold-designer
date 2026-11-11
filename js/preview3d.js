import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildMold } from './mesh.js';

const COLORS = {
  lower: [0x3f7d64, 0x6aa88a],
  upper: [0xc4965a, 0xddc092]
};

let renderer, scene, camera, controls, wrap;
let builtFor = null;
const visible = new Map();

function key(i, kind) { return `${i}:${kind}`; }

export function initPreview3d() {
  wrap = document.getElementById('preview3dCanvas');
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  wrap.appendChild(renderer.domElement);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(40, 1, 0.5, 5000);
  camera.position.set(280, -420, 220);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(200, 220, 0);
  scene.add(new THREE.AmbientLight(0xffffff, 0.72));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.15);
  keyLight.position.set(180, -260, 320);
  scene.add(keyLight);
  const fill = new THREE.DirectionalLight(0xd5e4da, 0.45);
  fill.position.set(-200, 80, -40);
  scene.add(fill);
  const grid = new THREE.GridHelper(900, 18, 0xc5cdc4, 0xe3e7df);
  grid.rotation.x = Math.PI / 2;
  grid.position.z = -80;
  scene.add(grid);
  const ro = new ResizeObserver(() => resize());
  ro.observe(wrap);
  resize();
  const tick = () => {
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  };
  tick();
}

function resize() {
  if (!wrap || !renderer) return;
  const w = wrap.clientWidth || 640;
  const h = wrap.clientHeight || 420;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function geometryFromMesh(mesh) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geo.computeVertexNormals();
  return geo;
}

export function updatePreview3d(c, meshes, mode = 'printed') {
  const box = document.getElementById('preview3dToggles');
  const note = document.getElementById('preview3dNote');
  const bladeMode = mode === 'blade';
  const segs = c.printableSegments;
  const toggleKey = `${mode}:${segs.length}`;
  if (box.dataset.key !== toggleKey) {
    box.dataset.key = toggleKey;
    box.innerHTML = '';
    visible.clear();
    const addToggle = (id, text) => {
      visible.set(id, true);
      const label = document.createElement('label');
      label.className = 'toggle-chip';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = true;
      input.addEventListener('change', () => {
        visible.set(id, input.checked);
        const obj = scene.getObjectByName(id);
        if (obj) obj.visible = input.checked;
      });
      label.append(input, document.createTextNode(text));
      box.append(label);
    };
    if (bladeMode) segs.forEach((_, i) => addToggle(`blade:${i}`, `第 ${i + 1} 段葉片`));
    else segs.forEach((_, i) => {
      addToggle(key(i, 'lower'), `第 ${i + 1} 段 下模凹面`);
      addToggle(key(i, 'upper'), `第 ${i + 1} 段 上模凸面`);
    });
  }
  // Drop previous molds but keep lights and grid.
  for (const child of [...scene.children]) {
    if (child.name && child.name.includes(':')) scene.remove(child);
  }
  const warnings = [];
  let min = new THREE.Vector3(Infinity, Infinity, Infinity);
  let max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const place = (mesh, name, color, zLift) => {
    warnings.push(...(mesh.warnings || []));
    const geo = geometryFromMesh(mesh);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.04, side: THREE.DoubleSide });
    const obj = new THREE.Mesh(geo, mat);
    obj.name = name;
    obj.position.z = zLift;
    obj.visible = visible.get(name) !== false;
    scene.add(obj);
    geo.computeBoundingBox();
    const b = geo.boundingBox.clone();
    b.min.add(obj.position);
    b.max.add(obj.position);
    min.min(b.min);
    max.max(b.max);
  };
  if (bladeMode) {
    meshes.forEach((mesh, i) => place(mesh, `blade:${i}`, i % 2 ? 0xc4965a : 0x3f7d64, 0));
  } else {
    segs.forEach((seg, i) => {
      for (const kind of ['lower', 'upper']) {
        const mesh = meshes.find(m => m.segmentIndex === i && m.kind === kind) || buildMold(c, i, kind);
        place(mesh, key(i, kind), COLORS[kind][i % 2], kind === 'upper' ? 28 : 0);
      }
    });
  }
  const center = min.clone().add(max).multiplyScalar(0.5);
  controls.target.copy(center);
  const size = Math.max(80, max.clone().sub(min).length());
  camera.near = Math.max(0.5, size / 400);
  camera.far = size * 12;
  camera.updateProjectionMatrix();
  const frameKey = toggleKey;
  if (!builtFor || builtFor !== frameKey) {
    const dist = size * 1.45;
    camera.position.copy(center).add(new THREE.Vector3(dist * 0.62, -dist * 0.78, dist * 0.38));
    controls.update();
    builtFor = frameKey;
  }
  const unique = [...new Set(warnings)];
  if (note) {
    note.hidden = unique.length === 0;
    note.textContent = unique.join(' ');
  }
  const info = document.getElementById('preview3dInfo');
  if (info) {
    if (bladeMode) {
      const bits = meshes.map((mesh, i) => `第 ${i + 1} 段高 ${mesh.height.toFixed(1)} mm`);
      info.textContent = `實體預覽與 blade-full STL 同一網格。${bits.join('，')}。葉片平放：長度沿 Y、前緣在 x 較小側、最低點貼齊 z=0，根部弦線與列印床平行。`;
    } else {
      const heights = segs.map((seg, i) => {
        const upper = scene.getObjectByName(key(i, 'upper'));
        upper.geometry.computeBoundingBox();
        const box3 = upper.geometry.boundingBox;
        return `第 ${i + 1} 段上模高 ${(box3.max.z - box3.min.z).toFixed(1)} mm`;
      });
      info.textContent = `實體預覽與 STL 同一網格。${heights.join('，')}。上模在畫面中上移 28 mm，方便看清模面；下載檔不含這段位移。`;
    }
  }
}
