// Εξαγωγή τριγώνων σε STL / OBJ / glTF. Χρησιμοποιείται για τα δοκιμαστικά αρχεία
// (samples/) και τα αυτόματα τεστ εισαγωγής: ίδιο κομμάτι, γνωστές μονάδες και άξονες.
import { writeGlb } from './gltfPrep';
import type { UpAxis } from './units';

export interface ExportOptions {
  /** Μονάδα αρχείου σε mm (π.χ. 1000 για μέτρα). */
  unitMm: number;
  up: UpAxis;
}

/** Από συντεταγμένες εφαρμογής (mm, Z πάνω) σε συντεταγμένες αρχείου. */
export function toFile(src: Float32Array, o: ExportOptions): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    const [x, y, z] = [src[i], src[i + 1], src[i + 2]];
    const p = o.up === 'Y' ? [x, z, -y] : [x, y, z];
    out[i] = p[0] / o.unitMm;
    out[i + 1] = p[1] / o.unitMm;
    out[i + 2] = p[2] / o.unitMm;
  }
  return out;
}

export function toBinaryStl(tris: Float32Array, o: ExportOptions): ArrayBuffer {
  const p = toFile(tris, o);
  const n = p.length / 9;
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  new Uint8Array(buf).set(new TextEncoder().encode('Opseis 3D test model'.padEnd(80, ' ')));
  dv.setUint32(80, n, true);
  for (let t = 0; t < n; t++) {
    const o2 = 84 + t * 50;
    for (let k = 0; k < 9; k++) dv.setFloat32(o2 + 12 + k * 4, p[t * 9 + k], true);
  }
  return buf;
}

export function toAsciiStl(tris: Float32Array, o: ExportOptions): string {
  const p = toFile(tris, o);
  const lines = ['solid test'];
  for (let t = 0; t < p.length; t += 9) {
    lines.push('facet normal 0 0 0', 'outer loop');
    for (let k = 0; k < 9; k += 3) lines.push(`vertex ${p[t + k]} ${p[t + k + 1]} ${p[t + k + 2]}`);
    lines.push('endloop', 'endfacet');
  }
  lines.push('endsolid test');
  return lines.join('\n');
}

export function toObj(tris: Float32Array, o: ExportOptions): string {
  const p = toFile(tris, o);
  const lines = ['# Opseis 3D test model', 'o part'];
  for (let i = 0; i < p.length; i += 3) lines.push(`v ${p[i]} ${p[i + 1]} ${p[i + 2]}`);
  for (let v = 1; v <= p.length / 3; v += 3) lines.push(`f ${v} ${v + 1} ${v + 2}`);
  return lines.join('\n');
}

function gltfJson(p: Float32Array, binUri?: string) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3)
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], p[i + a]);
      max[a] = Math.max(max[a], p[i + a]);
    }
  return {
    asset: { version: '2.0', generator: 'Opseis 3D test' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    // Μετατόπιση κόμβου: ελέγχει ότι εφαρμόζονται οι μετασχηματισμοί (οι διαστάσεις δεν αλλάζουν).
    nodes: [{ mesh: 0, name: 'part', translation: [0.5, 0.25, -0.75] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 4, material: 0 }] }],
    // Υλικό με υφή που ΔΕΝ υπάρχει: η εισαγωγή πρέπει να την αγνοήσει.
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
    textures: [{ source: 0 }],
    images: [{ uri: 'missing-texture.png' }],
    accessors: [{ bufferView: 0, componentType: 5126, count: p.length / 3, type: 'VEC3', min, max }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: p.byteLength }],
    buffers: [binUri ? { uri: binUri, byteLength: p.byteLength } : { byteLength: p.byteLength }],
  };
}

export function toGlb(tris: Float32Array, o: ExportOptions): ArrayBuffer {
  const p = toFile(tris, o);
  return writeGlb(gltfJson(p), new Uint8Array(p.buffer, p.byteOffset, p.byteLength));
}

/** .gltf με εξωτερικό .bin (δύο αρχεία). */
export function toGltfWithBin(tris: Float32Array, o: ExportOptions, binName: string): { gltf: string; bin: ArrayBuffer } {
  const p = toFile(tris, o);
  return { gltf: JSON.stringify(gltfJson(p, binName), null, 2), bin: p.buffer.slice(p.byteOffset, p.byteOffset + p.byteLength) as ArrayBuffer };
}
