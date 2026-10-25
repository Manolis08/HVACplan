import type { BBox, DimSpec, Part, Vec3 } from '../model/types';
import { unitToMm, type UpAxis, type Unit } from './units';

export interface MeshStats {
  triangles: number;
  /** Ακμές που ανήκουν σε ένα μόνο τρίγωνο (ανοιχτό πλέγμα). */
  boundaryEdges: number;
  /** Ακμές που ανήκουν σε περισσότερα από δύο τρίγωνα. */
  nonManifoldEdges: number;
  degenerateTriangles: number;
}

export const FEATURE_ANGLE_DEG = 20;

function bboxOf(p: Float32Array): BBox {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = p[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return { min, max };
}

const nextPow2 = (n: number) => {
  let c = 1;
  while (c < n) c <<= 1;
  return c;
};

/**
 * Ακμές για σχεδίαση από ένα πλέγμα τριγώνων: όπου δύο τρίγωνα σχηματίζουν γωνία πάνω από
 * `angleDeg`, καθώς και ανοιχτές/μη-πολλαπλές ακμές. Οι κορυφές ενώνονται ανά θέση.
 */
export function extractFeatureEdges(tris: Float32Array, angleDeg = FEATURE_ANGLE_DEG) {
  const corners = tris.length / 3;
  const triCount = corners / 3;
  const box = bboxOf(tris);
  const span = Math.max(...[0, 1, 2].map((a) => Math.max(Math.abs(box.min[a]), Math.abs(box.max[a]), box.max[a] - box.min[a])), 1e-9);
  const step = span * 1e-7;

  // 1. Ενοποίηση κορυφών με πίνακα κατακερματισμού (ανοιχτή διευθυνσιοδότηση).
  const vCap = nextPow2(corners * 2);
  const vKeys = new Int32Array(vCap * 3);
  const vIds = new Int32Array(vCap).fill(-1);
  const vertexOf = new Int32Array(corners);
  const firstCorner: number[] = [];
  for (let c = 0; c < corners; c++) {
    const qx = Math.round(tris[c * 3] / step);
    const qy = Math.round(tris[c * 3 + 1] / step);
    const qz = Math.round(tris[c * 3 + 2] / step);
    let h = (Math.imul(qx, 73856093) ^ Math.imul(qy, 19349663) ^ Math.imul(qz, 83492791)) & (vCap - 1);
    for (;;) {
      const id = vIds[h];
      if (id === -1) {
        vIds[h] = firstCorner.length;
        vKeys[h * 3] = qx;
        vKeys[h * 3 + 1] = qy;
        vKeys[h * 3 + 2] = qz;
        vertexOf[c] = firstCorner.length;
        firstCorner.push(c);
        break;
      }
      if (vKeys[h * 3] === qx && vKeys[h * 3 + 1] === qy && vKeys[h * 3 + 2] === qz) {
        vertexOf[c] = id;
        break;
      }
      h = (h + 1) & (vCap - 1);
    }
  }

  // 2. Κάθετα διανύσματα τριγώνων.
  const normals = new Float32Array(triCount * 3);
  const degenerate = new Uint8Array(triCount);
  let degenerateTriangles = 0;
  for (let t = 0; t < triCount; t++) {
    const a = vertexOf[t * 3];
    const b = vertexOf[t * 3 + 1];
    const c = vertexOf[t * 3 + 2];
    const i = t * 9;
    const ux = tris[i + 3] - tris[i];
    const uy = tris[i + 4] - tris[i + 1];
    const uz = tris[i + 5] - tris[i + 2];
    const wx = tris[i + 6] - tris[i];
    const wy = tris[i + 7] - tris[i + 1];
    const wz = tris[i + 8] - tris[i + 2];
    const nx = uy * wz - uz * wy;
    const ny = uz * wx - ux * wz;
    const nz = ux * wy - uy * wx;
    const len = Math.hypot(nx, ny, nz);
    if (a === b || b === c || a === c || len < step * step) {
      degenerate[t] = 1;
      degenerateTriangles++;
      continue;
    }
    normals[t * 3] = nx / len;
    normals[t * 3 + 1] = ny / len;
    normals[t * 3 + 2] = nz / len;
  }

  // 3. Ακμές: πόσα τρίγωνα μοιράζονται την καθεμία και αν η γωνία ξεπερνά το όριο.
  const eCap = nextPow2(Math.max(16, triCount * 4));
  const eA = new Int32Array(eCap).fill(-1);
  const eB = new Int32Array(eCap);
  const eFace = new Int32Array(eCap);
  const eCount = new Uint8Array(eCap);
  const eSharp = new Uint8Array(eCap);
  const cosLimit = Math.cos((angleDeg * Math.PI) / 180);
  for (let t = 0; t < triCount; t++) {
    if (degenerate[t]) continue;
    for (let e = 0; e < 3; e++) {
      let a = vertexOf[t * 3 + e];
      let b = vertexOf[t * 3 + ((e + 1) % 3)];
      if (a > b) [a, b] = [b, a];
      let h = (Math.imul(a, 73856093) ^ Math.imul(b, 19349663)) & (eCap - 1);
      for (;;) {
        if (eA[h] === -1) {
          eA[h] = a;
          eB[h] = b;
          eFace[h] = t;
          eCount[h] = 1;
          break;
        }
        if (eA[h] === a && eB[h] === b) {
          if (eCount[h] < 255) eCount[h]++;
          const f = eFace[h];
          const d = normals[f * 3] * normals[t * 3] + normals[f * 3 + 1] * normals[t * 3 + 1] + normals[f * 3 + 2] * normals[t * 3 + 2];
          if (d < cosLimit) eSharp[h] = 1;
          break;
        }
        h = (h + 1) & (eCap - 1);
      }
    }
  }

  const out: number[] = [];
  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  for (let h = 0; h < eCap; h++) {
    if (eA[h] === -1) continue;
    const count = eCount[h];
    if (count === 1) boundaryEdges++;
    if (count > 2) nonManifoldEdges++;
    if (count === 1 || count > 2 || eSharp[h]) {
      const ca = firstCorner[eA[h]] * 3;
      const cb = firstCorner[eB[h]] * 3;
      out.push(tris[ca], tris[ca + 1], tris[ca + 2], tris[cb], tris[cb + 1], tris[cb + 2]);
    }
  }

  const stats: MeshStats = { triangles: triCount, boundaryEdges, nonManifoldEdges, degenerateTriangles };
  return { edges: new Float32Array(out), stats };
}

// ---------------------------------------------------------------------------
// Προσανατολισμός και μονάδες
// ---------------------------------------------------------------------------

/** Πίνακας 3×3 κατά γραμμές. */
export type Mat3 = number[];

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function mulMat3(a: Mat3, b: Mat3): Mat3 {
  const r: Mat3 = new Array(9).fill(0);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
}

/** Από τους άξονες του αρχείου στους άξονες της εφαρμογής (Z πάνω, μπροστά = −Y). */
export function upMatrix(up: UpAxis): Mat3 {
  // Y πάνω (π.χ. glTF): στροφή +90° γύρω από X → (x, y, z) ↦ (x, −z, y).
  return up === 'Y' ? [1, 0, 0, 0, 0, -1, 0, 1, 0] : IDENTITY;
}

/** Στροφή +90° (δεξιόστροφος κανόνας) γύρω από άξονα της εφαρμογής. */
export function rot90(axis: 'X' | 'Y' | 'Z'): Mat3 {
  switch (axis) {
    case 'X':
      return [1, 0, 0, 0, 0, -1, 0, 1, 0];
    case 'Y':
      return [0, 0, 1, 0, 1, 0, -1, 0, 0];
    case 'Z':
      return [0, -1, 0, 1, 0, 0, 0, 0, 1];
  }
}

export interface Orientation {
  unit: Unit;
  up: UpAxis;
  rotation: Mat3;
}

function transform(src: Float32Array, m: Mat3, s: number): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    const x = src[i];
    const y = src[i + 1];
    const z = src[i + 2];
    out[i] = s * (m[0] * x + m[1] * y + m[2] * z);
    out[i + 1] = s * (m[3] * x + m[4] * y + m[5] * z);
    out[i + 2] = s * (m[6] * x + m[7] * y + m[8] * z);
  }
  return out;
}

/** Διαστάσεις κουτιού (Μ × Β × Υ σε mm) για δοσμένο προσανατολισμό, χωρίς να μετασχηματιστεί όλο το πλέγμα. */
export function orientedSize(rawBox: BBox, o: Orientation): Vec3 {
  const m = mulMat3(o.rotation, upMatrix(o.up));
  const s = unitToMm(o.unit);
  const size = [0, 1, 2].map((a) => rawBox.max[a] - rawBox.min[a]);
  // Οι πίνακες είναι μεταθέσεις αξόνων με πρόσημο, άρα κάθε νέα διάσταση = μία παλιά.
  return [0, 1, 2].map((r) => s * Math.abs(m[r * 3] * size[0] + m[r * 3 + 1] * size[1] + m[r * 3 + 2] * size[2])) as Vec3;
}

export interface PreparedModel {
  triangles: Float32Array;
  edges: Float32Array;
  rawBox: BBox;
  stats: MeshStats;
}

export function prepareModel(triangles: Float32Array): PreparedModel {
  const { edges, stats } = extractFeatureEdges(triangles);
  return { triangles, edges, rawBox: bboxOf(triangles), stats };
}

const PX: Vec3 = [1, 0, 0];
const NY: Vec3 = [0, -1, 0];
const NZ: Vec3 = [0, 0, -1];

/**
 * Κομμάτι από αρχείο: μετατροπή σε mm, προσανατολισμός, κεντράρισμα (κέντρο στο X/Y,
 * βάση στο z = 0) και συνολικές διαστάσεις από το κουτί που το περικλείει.
 */
export function buildFilePart(model: PreparedModel, o: Orientation): Part {
  const m = mulMat3(o.rotation, upMatrix(o.up));
  const s = unitToMm(o.unit);
  const tris = transform(model.triangles, m, s);
  const edges = transform(model.edges, m, s);
  const b = bboxOf(tris);
  const t: Vec3 = [-(b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2, -b.min[2]];
  for (const arr of [tris, edges]) {
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] += t[0];
      arr[i + 1] += t[1];
      arr[i + 2] += t[2];
    }
  }
  const min: Vec3 = [b.min[0] + t[0], b.min[1] + t[1], 0];
  const max: Vec3 = [b.max[0] + t[0], b.max[1] + t[1], b.max[2] + t[2]];
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const dims: DimSpec[] = [
    { kind: 'linear', id: 'L', value: x1 - x0, a: [x0, y0, z0], b: [x1, y0, z0], offsets: [NZ, NY], overall: true },
    { kind: 'linear', id: 'W', value: y1 - y0, a: [x1, y0, z0], b: [x1, y1, z0], offsets: [NZ, PX], overall: true },
    { kind: 'linear', id: 'H', value: z1 - z0, a: [x1, y0, z0], b: [x1, y0, z1], offsets: [PX, NY], overall: true },
  ];
  return { triangles: tris, edges, bbox: { min, max }, dims, circles: [], info: [], showBox: true };
}
