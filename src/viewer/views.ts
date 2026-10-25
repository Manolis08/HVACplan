import { Vector3 } from 'three';
import type { BBox, Vec3 } from '../model/types';

export type ViewId = 'front' | 'top' | 'right' | 'left' | 'back' | 'bottom' | 'iso';

// Μικρή κλίση για κάτοψη/κάτω: ορίζει τον προσανατολισμό της εικόνας στον πόλο
// (κάτοψη: X δεξιά, Y πάνω · κάτω: X δεξιά, μπροστινή πλευρά πάνω).
const POLE = 1e-4;

export interface ViewDef {
  id: ViewId;
  label: string;
  /** Κατεύθυνση από το κέντρο του μοντέλου προς την κάμερα. */
  dir: Vec3;
}

export const VIEWS: ViewDef[] = [
  { id: 'front', label: 'Πρόσοψη', dir: [0, -1, 0] },
  { id: 'top', label: 'Κάτοψη', dir: [0, -POLE, 1] },
  { id: 'right', label: 'Δεξιά', dir: [1, 0, 0] },
  { id: 'left', label: 'Αριστερά', dir: [-1, 0, 0] },
  { id: 'back', label: 'Πίσω', dir: [0, 1, 0] },
  { id: 'bottom', label: 'Κάτω', dir: [0, -POLE, -1] },
  { id: 'iso', label: 'Ισομετρική', dir: [1, -1, 1] },
];

export const viewById = (id: ViewId): ViewDef => VIEWS.find((v) => v.id === id)!;

export const viewLabel = (id: ViewId | null): string =>
  id ? viewById(id).label : 'Ελεύθερη περιστροφή';

const UP = new Vector3(0, 0, 1);

/** Βάση της κάμερας για μια κατεύθυνση: dir (προς την κάμερα), right και up της οθόνης. */
export function viewBasis(dir: Vec3 | Vector3) {
  const d = (dir instanceof Vector3 ? dir.clone() : new Vector3(...dir)).normalize();
  const forward = d.clone().negate();
  const right = forward.clone().cross(UP).normalize();
  const up = right.clone().cross(forward).normalize();
  return { dir: d, right, up };
}

export function bboxCorners(b: BBox): Vec3[] {
  const out: Vec3[] = [];
  for (const x of [b.min[0], b.max[0]])
    for (const y of [b.min[1], b.max[1]])
      for (const z of [b.min[2], b.max[2]]) out.push([x, y, z]);
  return out;
}

/** Zoom ορθογραφικής κάμερας (pixel ανά mm) ώστε το κουτί να χωρά με περιθώριο. */
export function fitZoom(dir: Vec3 | Vector3, bbox: BBox, width: number, height: number, margin: number): number {
  const { right, up } = viewBasis(dir);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const p = new Vector3();
  for (const c of bboxCorners(bbox)) {
    p.set(...c);
    const x = p.dot(right);
    const y = p.dot(up);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const ex = Math.max(maxX - minX, 1e-6);
  const ey = Math.max(maxY - minY, 1e-6);
  const z = Math.min((width - 2 * margin) / ex, (height - 2 * margin) / ey);
  return Math.max(z, 1e-4);
}

const DIR_TOL = Math.cos((0.5 * Math.PI) / 180);
const RIGHT_TOL = Math.cos((1 * Math.PI) / 180);

/** Ποια όψη βλέπουμε (ή null για ελεύθερη περιστροφή), από την κατεύθυνση και το "δεξιά" της κάμερας. */
export function detectView(camDir: Vector3, camRight: Vector3): ViewId | null {
  for (const v of VIEWS) {
    const b = viewBasis(v.dir);
    if (camDir.dot(b.dir) > DIR_TOL && camRight.dot(b.right) > RIGHT_TOL) return v.id;
  }
  return null;
}
