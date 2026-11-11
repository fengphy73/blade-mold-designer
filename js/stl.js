/** Binary STL writer. 80-byte header carries the part name, matching the original files. */

export function meshToStl(mesh, title) {
  const { positions, indices } = mesh;
  const triangles = indices.length / 3;
  const buffer = new ArrayBuffer(84 + triangles * 50);
  const view = new DataView(buffer);
  const header = new TextEncoder().encode(String(title || 'mold').slice(0, 80));
  new Uint8Array(buffer, 0, 80).set(header);
  view.setUint32(80, triangles, true);
  let offset = 84;
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] * 3, ib = indices[i + 1] * 3, ic = indices[i + 2] * 3;
    const ax = positions[ia], ay = positions[ia + 1], az = positions[ia + 2];
    const bx = positions[ib], by = positions[ib + 1], bz = positions[ib + 2];
    const cx = positions[ic], cy = positions[ic + 1], cz = positions[ic + 2];
    let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const mag = Math.hypot(nx, ny, nz) || 1;
    nx /= mag; ny /= mag; nz /= mag;
    for (const n of [nx, ny, nz, ax, ay, az, bx, by, bz, cx, cy, cz]) {
      view.setFloat32(offset, n, true);
      offset += 4;
    }
    view.setUint16(offset, 0, true);
    offset += 2;
  }
  return buffer;
}

export function stlToMesh(buffer) {
  const view = new DataView(buffer);
  const count = view.getUint32(80, true);
  const positions = [];
  const indices = [];
  let offset = 84;
  for (let i = 0; i < count; i++) {
    offset += 12;
    const base = positions.length / 3;
    for (let v = 0; v < 3; v++) {
      positions.push(view.getFloat32(offset, true), view.getFloat32(offset + 4, true), view.getFloat32(offset + 8, true));
      offset += 12;
    }
    offset += 2;
    indices.push(base, base + 1, base + 2);
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) };
}
