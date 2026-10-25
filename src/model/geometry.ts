import { ExtrudeGeometry, Path, Shape, ShapeUtils, Vector2 } from 'three';
import type { BBox, PartGeometry, Vec3 } from './types';

const EPS = 1e-9;

export interface Box {
  min: Vec3;
  max: Vec3;
}

function uniqueSorted(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) {
    if (out.length === 0 || v - out[out.length - 1] > EPS) out.push(v);
  }
  return out;
}

function bboxOf(positions: Float32Array): BBox {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = positions[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return { min, max };
}

// Για κάθε κατεύθυνση έδρας: άξονας, πρόσημο και εφαπτόμενοι άξονες u, v με u × v = κάθετο.
const FACE_DIRS: { axis: number; sign: 1 | -1; u: number; v: number }[] = [
  { axis: 0, sign: 1, u: 1, v: 2 },
  { axis: 0, sign: -1, u: 2, v: 1 },
  { axis: 1, sign: 1, u: 2, v: 0 },
  { axis: 1, sign: -1, u: 0, v: 2 },
  { axis: 2, sign: 1, u: 0, v: 1 },
  { axis: 2, sign: -1, u: 1, v: 0 },
];

/**
 * Ένωση κουτιών ευθυγραμμισμένων με τους άξονες → καθαρή επιφάνεια (χωρίς εσωτερικές
 * έδρες και χωρίς ψεύτικες ραφές). Χωρίζουμε τον χώρο σε πλέγμα από τις συντεταγμένες
 * των κουτιών, σημαδεύουμε τα γεμάτα κελιά και κρατάμε μόνο τις έδρες γεμάτου/άδειου.
 * Ακμή = όπου συναντώνται έδρες με διαφορετικό κάθετο διάνυσμα.
 */
export function boxUnion(boxes: Box[]): PartGeometry {
  const grid = [0, 1, 2].map((a) => uniqueSorted(boxes.flatMap((b) => [b.min[a], b.max[a]])));
  const n = grid.map((g) => g.length - 1);
  const filled = new Uint8Array(n[0] * n[1] * n[2]);
  const cellIndex = (c: number[]) => (c[0] * n[1] + c[1]) * n[2] + c[2];

  for (let i = 0; i < n[0]; i++) {
    for (let j = 0; j < n[1]; j++) {
      for (let k = 0; k < n[2]; k++) {
        const centre = [
          (grid[0][i] + grid[0][i + 1]) / 2,
          (grid[1][j] + grid[1][j + 1]) / 2,
          (grid[2][k] + grid[2][k + 1]) / 2,
        ];
        const inside = boxes.some((b) =>
          [0, 1, 2].every((a) => centre[a] > b.min[a] && centre[a] < b.max[a]),
        );
        if (inside) filled[cellIndex([i, j, k])] = 1;
      }
    }
  }

  const isFilled = (c: number[]) =>
    c.every((v, a) => v >= 0 && v < n[a]) && filled[cellIndex(c)] === 1;

  const pointId = (p: number[]) => (p[0] * (n[1] + 1) + p[1]) * (n[2] + 1) + p[2];
  const toMm = (p: number[]): Vec3 => [grid[0][p[0]], grid[1][p[1]], grid[2][p[2]]];

  const tris: number[] = [];
  // Για κάθε μοναδιαία ακμή πλέγματος: σε ποιες κατευθύνσεις έδρας ανήκει.
  const edgeFaces = new Map<string, { a: number[]; b: number[]; dirs: number[] }>();

  for (let i = 0; i < n[0]; i++) {
    for (let j = 0; j < n[1]; j++) {
      for (let k = 0; k < n[2]; k++) {
        const cell = [i, j, k];
        if (!isFilled(cell)) continue;
        FACE_DIRS.forEach((fd, d) => {
          const neighbour = [...cell];
          neighbour[fd.axis] += fd.sign;
          if (isFilled(neighbour)) return;

          const c0 = [...cell];
          if (fd.sign > 0) c0[fd.axis] += 1;
          const c1 = [...c0];
          c1[fd.u] += 1;
          const c2 = [...c1];
          c2[fd.v] += 1;
          const c3 = [...c0];
          c3[fd.v] += 1;

          for (const p of [c0, c1, c2, c0, c2, c3]) tris.push(...toMm(p));

          const quad = [c0, c1, c2, c3];
          for (let e = 0; e < 4; e++) {
            const a = quad[e];
            const b = quad[(e + 1) % 4];
            const ia = pointId(a);
            const ib = pointId(b);
            const key = ia < ib ? `${ia}_${ib}` : `${ib}_${ia}`;
            const entry = edgeFaces.get(key);
            if (entry) entry.dirs.push(d);
            else edgeFaces.set(key, { a: ia < ib ? a : b, b: ia < ib ? b : a, dirs: [d] });
          }
        });
      }
    }
  }

  // Ακμές χαρακτηριστικών, ομαδοποιημένες ανά ευθεία ώστε να ενωθούν σε ενιαία τμήματα.
  const lines = new Map<string, { axis: number; fixed: number[]; spans: [number, number][] }>();
  for (const { a, b, dirs } of edgeFaces.values()) {
    const isFeature = dirs.length !== 2 || dirs[0] !== dirs[1];
    if (!isFeature) continue;
    const axis = [0, 1, 2].find((ax) => a[ax] !== b[ax])!;
    const fixed = [0, 1, 2].filter((ax) => ax !== axis).map((ax) => a[ax]);
    const key = `${axis}:${fixed.join(',')}`;
    let line = lines.get(key);
    if (!line) {
      line = { axis, fixed, spans: [] };
      lines.set(key, line);
    }
    line.spans.push([a[axis], b[axis]]);
  }

  const edges: number[] = [];
  for (const { axis, fixed, spans } of lines.values()) {
    spans.sort((s, t) => s[0] - t[0]);
    const merged: [number, number][] = [];
    for (const s of spans) {
      const last = merged[merged.length - 1];
      if (last && last[1] === s[0]) last[1] = s[1];
      else merged.push([s[0], s[1]]);
    }
    const others = [0, 1, 2].filter((ax) => ax !== axis);
    for (const [s0, s1] of merged) {
      const p = [0, 0, 0];
      const q = [0, 0, 0];
      p[axis] = s0;
      q[axis] = s1;
      others.forEach((ax, idx) => {
        p[ax] = fixed[idx];
        q[ax] = fixed[idx];
      });
      edges.push(...toMm(p), ...toMm(q));
    }
  }

  const triangles = new Float32Array(tris);
  return { triangles, edges: new Float32Array(edges), bbox: bboxOf(triangles) };
}

export type Pt2 = [number, number];

export interface Profile {
  /** Εξωτερικό περίγραμμα (πολύγωνο, χωρίς συνευθειακές κορυφές). */
  outer: Pt2[];
  /** Οπές ως πολύγωνα (π.χ. κύκλος με πολλές πλευρές). */
  holes: Pt2[][];
  /** Κορυφές του εξωτερικού περιγράμματος πάνω σε καμπύλη (χωρίς διαμήκη ακμή). */
  smooth?: boolean[];
}

/** Απεικόνιση από τοπικές συντεταγμένες εξώθησης (u, v, w) σε συντεταγμένες μοντέλου. Πρέπει να είναι στροφή. */
export type Mapping = (u: number, v: number, w: number) => Vec3;

/** Σημεία τόξου (κέντρο, ακτίνα, από γωνία a0 έως a1 σε ακτίνια), μαζί με τα άκρα. */
export const arcPoints = (cx: number, cy: number, r: number, a0: number, a1: number, segments: number): Pt2[] =>
  Array.from({ length: segments + 1 }, (_, i) => {
    const t = a0 + ((a1 - a0) * i) / segments;
    return [cx + r * Math.cos(t), cy + r * Math.sin(t)] as Pt2;
  });

export const circlePolygon = (cx: number, cy: number, r: number, segments = 64): Pt2[] =>
  Array.from({ length: segments }, (_, i) => {
    const t = (i / segments) * Math.PI * 2;
    return [cx + r * Math.cos(t), cy + r * Math.sin(t)] as Pt2;
  });

/**
 * Εξώθηση προφίλ με οπές κατά βάθος `depth`. Οι ακμές βγαίνουν ρητά από το προφίλ:
 * περιγράμματα στις δύο βάσεις και διαμήκεις ακμές μόνο στις γωνίες του εξωτερικού
 * περιγράμματος (όχι στις πλευρές του πολυγώνου που προσεγγίζει τον κύκλο).
 */
export function extrudeProfile(profile: Profile, depth: number, map: Mapping): PartGeometry {
  const shape = new Shape(profile.outer.map(([x, y]) => new Vector2(x, y)));
  for (const hole of profile.holes) {
    shape.holes.push(new Path(hole.map(([x, y]) => new Vector2(x, y))));
  }
  const geometry = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    steps: 1,
    curveSegments: 1,
  });
  const pos = geometry.getAttribute('position');
  const triangles = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    triangles.set(map(pos.getX(i), pos.getY(i), pos.getZ(i)), i * 3);
  }
  geometry.dispose();

  const edges: number[] = [];
  for (const loop of [profile.outer, ...profile.holes]) {
    for (let i = 0; i < loop.length; i++) {
      const [pu, pv] = loop[i];
      const [qu, qv] = loop[(i + 1) % loop.length];
      for (const w of [0, depth]) edges.push(...map(pu, pv, w), ...map(qu, qv, w));
    }
  }
  profile.outer.forEach(([u, v], i) => {
    if (!profile.smooth?.[i]) edges.push(...map(u, v, 0), ...map(u, v, depth));
  });

  return { triangles, edges: new Float32Array(edges), bbox: bboxOf(triangles) };
}

/** Προσημασμένος όγκος κλειστού πλέγματος (θετικός αν τα κάθετα κοιτάνε προς τα έξω). */
export function signedVolume(triangles: Float32Array): number {
  let vol = 0;
  for (let i = 0; i < triangles.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = triangles.subarray(i, i + 9);
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return vol;
}

export interface BearingParams {
  L: number;
  W: number;
  H: number;
  Hax: number;
  R: number;
  /** Ακτίνα οπής άξονα (κατά Y). */
  r: number;
  Gt: number;
  Gb: number;
  Gd: number;
  /** Ακτίνα κατακόρυφης οπής λίπανσης και θέση της κατά Y. */
  a: number;
  yo: number;
}

const ARC = 32;
const BORE = 64;
const OIL = 24;

/**
 * Έδρανο ως ΕΝΑ κλειστό στερεό, με πραγματική οπή λίπανσης από την κορυφή R ως την οπή του άξονα.
 * Χωρίς CSG: οι δύο καμπύλες επιφάνειες (κορυφή και οπή άξονα) χωρίζονται σε τρεις λωρίδες κατά Y·
 * στη μεσαία λωρίδα, γύρω από την οπή, η επιφάνεια τριγωνοποιείται στις παραμετρικές της
 * συντεταγμένες (γωνία × ακτίνα, y) με την οπή ως «τρύπα». Τα σημεία του περιγράμματος της οπής
 * υπολογίζονται ακριβώς πάνω στους δύο κυλίνδρους και ενώνονται με το τοίχωμα της οπής.
 */
export function bearingSolid(p: BearingParams): PartGeometry {
  const { L, W, H, Hax, R, r, Gt, Gb, Gd, a, yo } = p;
  const xc = L / 2;
  const tris: number[] = [];
  const edges: number[] = [];
  const tri = (A: Vec3, B: Vec3, C: Vec3, n: Vec3) => {
    const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
    const v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const cr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const flip = cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] < 0;
    tris.push(...A, ...(flip ? C : B), ...(flip ? B : C));
  };
  const quad = (A: Vec3, B: Vec3, C: Vec3, D: Vec3, n: Vec3) => {
    tri(A, B, C, n);
    tri(A, C, D, n);
  };
  const line = (A: Vec3, B: Vec3) => edges.push(...A, ...B);

  // Προφίλ (x, z): εξωτερικό CCW και οπή άξονα. Οι γωνίες κρατιούνται για τις καμπύλες λωρίδες.
  const theta = Array.from({ length: ARC + 1 }, (_, i) => (Math.PI * i) / ARC);
  const arc: Pt2[] = theta.map((t) => [xc + R * Math.cos(t), Hax + R * Math.sin(t)]);
  const outer: Pt2[] = [
    [0, 0],
    [xc - Gb / 2, 0],
    [xc - Gt / 2, Gd],
    [xc + Gt / 2, Gd],
    [xc + Gb / 2, 0],
    [L, 0],
    [L, H],
    [xc + R, H],
    ...arc,
    [xc - R, H],
    [0, H],
  ];
  const arcStart = 8;
  const tb = Array.from({ length: BORE }, (_, j) => (2 * Math.PI * j) / BORE);
  const bore: Pt2[] = tb.map((t) => [xc + r * Math.cos(t), Hax + r * Math.sin(t)]);

  // Λωρίδες κατά Y: η μεσαία περιέχει την οπή λίπανσης.
  // (στενή λωρίδα γύρω από την οπή, ώστε τα επίπεδα τρίγωνα να μένουν κοντά στην καμπύλη)
  const y1 = Math.max((yo - a) / 2, yo - 2 * a);
  const y2 = Math.min((yo + a + W) / 2, yo + 2 * a);
  const ys = [0, y1, y2, W];
  const at = (q: Pt2, y: number): Vec3 => [q[0], y, q[1]];

  // Τμήματα του τόξου που καλύπτουν την οπή πάνω σε κύλινδρο ακτίνας ρ (γύρω από την κορυφή π/2).
  // Όσο λιγότερα, τόσο πιο πιστά ακολουθούν τα επίπεδα τρίγωνα την καμπύλη.
  const patchRange = (rho: number, step: number) => {
    const half = Math.asin(a / rho);
    const i0 = Math.floor((Math.PI / 2 - half) / step - 1e-9);
    const i1 = Math.ceil((Math.PI / 2 + half) / step + 1e-9);
    return [i0, i1];
  };
  const [oa, ob] = patchRange(R, Math.PI / ARC);
  const [ba, bb] = patchRange(r, (2 * Math.PI) / BORE);

  // Περίγραμμα οπής λίπανσης πάνω στους δύο κυλίνδρους (ίδια σημεία για επιφάνειες και τοίχωμα).
  const ring = Array.from({ length: OIL }, (_, k) => {
    const f = (2 * Math.PI * k) / OIL;
    const px = a * Math.cos(f);
    const py = a * Math.sin(f);
    return {
      top: [xc + px, yo + py, Hax + Math.sqrt(R * R - px * px)] as Vec3,
      bot: [xc + px, yo + py, Hax + Math.sqrt(r * r - px * px)] as Vec3,
      uTop: R * Math.acos(px / R),
      uBot: r * Math.acos(px / r),
      v: yo + py,
      n: [-px, -py, 0] as Vec3,
    };
  });

  /** Μεσαία λωρίδα καμπύλης επιφάνειας με την οπή: τριγωνοποίηση στο επίπεδο (ρ·γωνία, y). */
  const patch = (pts: Pt2[], angles: number[], i0: number, i1: number, rho: number, holeU: number[], hole3d: Vec3[], outward: boolean) => {
    const contour: { u: number; v: number; p: Vec3 }[] = [];
    for (let i = i0; i <= i1; i++) contour.push({ u: rho * angles[i], v: y1, p: at(pts[i], y1) });
    for (let i = i1; i >= i0; i--) contour.push({ u: rho * angles[i], v: y2, p: at(pts[i], y2) });
    const holeV = ring.map((h) => h.v);
    const faces = ShapeUtils.triangulateShape(
      contour.map((c) => new Vector2(c.u, c.v)),
      [holeU.map((u, k) => new Vector2(u, holeV[k]))],
    );
    const all = [...contour.map((c) => c.p), ...hole3d];
    for (const [i, j, k] of faces) {
      const m: Vec3 = [(all[i][0] + all[j][0] + all[k][0]) / 3 - xc, 0, (all[i][2] + all[j][2] + all[k][2]) / 3 - Hax];
      tri(all[i], all[j], all[k], outward ? m : [-m[0], 0, -m[2]]);
    }
  };

  // Εξωτερικά τοιχώματα (3 λωρίδες), εκτός από τη μεσαία λωρίδα της κορυφής γύρω από την οπή.
  for (let k = 0; k < outer.length; k++) {
    const A = outer[k];
    const B = outer[(k + 1) % outer.length];
    const n: Vec3 = [B[1] - A[1], 0, -(B[0] - A[0])];
    const arcSeg = k - arcStart; // τμήμα τόξου θ_i → θ_{i+1}
    for (let m = 0; m < 3; m++) {
      if (m === 1 && arcSeg >= oa && arcSeg < ob) continue;
      quad(at(A, ys[m]), at(B, ys[m]), at(B, ys[m + 1]), at(A, ys[m + 1]), n);
    }
  }
  patch(arc, theta, oa, ob, R, ring.map((h) => h.uTop), ring.map((h) => h.top), true);

  // Τοίχωμα οπής άξονα (κάθετα προς τον άξονα).
  for (let j = 0; j < BORE; j++) {
    const A = bore[j];
    const B = bore[(j + 1) % BORE];
    const n: Vec3 = [xc - (A[0] + B[0]) / 2, 0, Hax - (A[1] + B[1]) / 2];
    for (let m = 0; m < 3; m++) {
      if (m === 1 && j >= ba && j < bb) continue;
      quad(at(A, ys[m]), at(B, ys[m]), at(B, ys[m + 1]), at(A, ys[m + 1]), n);
    }
  }
  patch(bore, tb, ba, bb, r, ring.map((h) => h.uBot), ring.map((h) => h.bot), false);

  // Τοίχωμα οπής λίπανσης.
  for (let k = 0; k < OIL; k++) {
    const A = ring[k];
    const B = ring[(k + 1) % OIL];
    quad(A.top, B.top, B.bot, A.bot, [(A.n[0] + B.n[0]) / 2, (A.n[1] + B.n[1]) / 2, 0]);
    line(A.top, B.top);
    line(A.bot, B.bot);
  }

  // Μπροστινή και πίσω έδρα: προφίλ με την οπή του άξονα.
  const capFaces = ShapeUtils.triangulateShape(
    outer.map(([x, z]) => new Vector2(x, z)),
    [bore.map(([x, z]) => new Vector2(x, z))],
  );
  const capPts = [...outer, ...bore];
  for (const [y, n] of [
    [0, [0, -1, 0]],
    [W, [0, 1, 0]],
  ] as [number, Vec3][]) {
    for (const [i, j, k] of capFaces) tri(at(capPts[i], y), at(capPts[j], y), at(capPts[k], y), n);
    for (const loop of [outer, bore]) loop.forEach((q, i) => line(at(q, y), at(loop[(i + 1) % loop.length], y)));
  }
  // Διαμήκεις ακμές στις γωνίες (όχι πάνω στο τόξο, που είναι λείο).
  outer.forEach((q, i) => {
    if (i < arcStart || i > arcStart + ARC) line(at(q, 0), at(q, W));
  });

  const triangles = new Float32Array(tris);
  return { triangles, edges: new Float32Array(edges), bbox: bboxOf(triangles) };
}
