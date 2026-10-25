// Ορατές και κρυφές ακμές για ορθογραφικές όψεις (για το φύλλο όψεων).
//
// Για κάθε ακμή ελέγχουμε σε πολλά σημεία κατά μήκος της αν υπάρχει επιφάνεια (τρίγωνο του
// πλέγματος) πιο κοντά στον παρατηρητή στο ίδιο σημείο της όψης. Η ακμή κόβεται σε ορατά και
// κρυφά κομμάτια, με ακριβή όρια (διχοτόμηση). Στο τέλος οι συνευθειακές γραμμές ενώνονται και η
// ορατή γραμμή έχει προτεραιότητα: όπου μια κρυφή συμπίπτει με ορατή, δεν σχεδιάζεται.
import type { Vec3 } from '../model/types';

export interface ViewFrame {
  /** Μοναδιαία κατεύθυνση από το μοντέλο προς τον παρατηρητή. */
  dir: Vec3;
  /** Οριζόντιος και κατακόρυφος άξονας της όψης. */
  right: Vec3;
  up: Vec3;
}

export type P2 = [number, number];

export interface Segment2 {
  a: P2;
  b: P2;
  hidden: boolean;
}

const dot = (p: ArrayLike<number>, i: number, v: Vec3) => p[i] * v[0] + p[i + 1] * v[1] + p[i + 2] * v[2];

// ---------------------------------------------------------------------------
// Τοπολογία πλέγματος: για κάθε ακμή, τα κάθετα των (έως δύο) γειτονικών τριγώνων.
// ---------------------------------------------------------------------------

export interface EdgeTopology {
  /** Ακμές: x1,y1,z1,x2,y2,z2. */
  positions: Float32Array;
  /** Κάθετα γειτονικών τριγώνων: n1 (3) και n2 (3, NaN αν η ακμή έχει ένα τρίγωνο). */
  normals: Float32Array;
}

export function edgeTopology(tris: Float32Array): EdgeTopology {
  const corners = tris.length / 3;
  let span = 1e-9;
  for (let i = 0; i < tris.length; i++) span = Math.max(span, Math.abs(tris[i]));
  const step = span * 1e-7;
  const cap = (n: number) => {
    let c = 16;
    while (c < n) c <<= 1;
    return c;
  };

  const vCap = cap(corners * 2);
  const vKeys = new Int32Array(vCap * 3);
  const vIds = new Int32Array(vCap).fill(-1);
  const vertexOf = new Int32Array(corners);
  const firstCorner: number[] = [];
  for (let c = 0; c < corners; c++) {
    const q = [0, 1, 2].map((a) => Math.round(tris[c * 3 + a] / step));
    let h = (Math.imul(q[0], 73856093) ^ Math.imul(q[1], 19349663) ^ Math.imul(q[2], 83492791)) & (vCap - 1);
    for (;;) {
      if (vIds[h] === -1) {
        vIds[h] = firstCorner.length;
        vKeys.set(q, h * 3);
        vertexOf[c] = firstCorner.length;
        firstCorner.push(c);
        break;
      }
      if (vKeys[h * 3] === q[0] && vKeys[h * 3 + 1] === q[1] && vKeys[h * 3 + 2] === q[2]) {
        vertexOf[c] = vIds[h];
        break;
      }
      h = (h + 1) & (vCap - 1);
    }
  }

  const triCount = corners / 3;
  const eCap = cap(triCount * 4);
  const eA = new Int32Array(eCap).fill(-1);
  const eB = new Int32Array(eCap);
  const eF1 = new Int32Array(eCap);
  const eF2 = new Int32Array(eCap).fill(-1);
  const normal = (t: number): Vec3 => {
    const i = t * 9;
    const u = [tris[i + 3] - tris[i], tris[i + 4] - tris[i + 1], tris[i + 5] - tris[i + 2]];
    const w = [tris[i + 6] - tris[i], tris[i + 7] - tris[i + 1], tris[i + 8] - tris[i + 2]];
    const n: Vec3 = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const l = Math.hypot(...n) || 1;
    return [n[0] / l, n[1] / l, n[2] / l];
  };
  for (let t = 0; t < triCount; t++) {
    const v = [vertexOf[t * 3], vertexOf[t * 3 + 1], vertexOf[t * 3 + 2]];
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) continue;
    for (let e = 0; e < 3; e++) {
      const a = Math.min(v[e], v[(e + 1) % 3]);
      const b = Math.max(v[e], v[(e + 1) % 3]);
      let h = (Math.imul(a, 73856093) ^ Math.imul(b, 19349663)) & (eCap - 1);
      for (;;) {
        if (eA[h] === -1) {
          eA[h] = a;
          eB[h] = b;
          eF1[h] = t;
          break;
        }
        if (eA[h] === a && eB[h] === b) {
          if (eF2[h] === -1) eF2[h] = t;
          break;
        }
        h = (h + 1) & (eCap - 1);
      }
    }
  }

  const pos: number[] = [];
  const nor: number[] = [];
  for (let h = 0; h < eCap; h++) {
    if (eA[h] === -1) continue;
    const ca = firstCorner[eA[h]] * 3;
    const cb = firstCorner[eB[h]] * 3;
    pos.push(tris[ca], tris[ca + 1], tris[ca + 2], tris[cb], tris[cb + 1], tris[cb + 2]);
    nor.push(...normal(eF1[h]), ...(eF2[h] >= 0 ? normal(eF2[h]) : [NaN, NaN, NaN]));
  }
  return { positions: new Float32Array(pos), normals: new Float32Array(nor) };
}

/**
 * Περιγράμματα καμπυλών για την όψη: ακμές όπου το ένα τρίγωνο κοιτά τον παρατηρητή και το άλλο όχι.
 * Το κατώφλι αγνοεί τρίγωνα που βλέπουμε σχεδόν «στην κόψη» (π.χ. μικρές κλίσεις της τριγωνοποίησης
 * γύρω από μια οπή σε καμπύλη επιφάνεια), που δεν είναι πραγματικό περίγραμμα.
 */
const FACING = 0.02;
export function silhouettes(topo: EdgeTopology, dir: Vec3): Float32Array {
  const out: number[] = [];
  const n = topo.normals;
  for (let e = 0; e < n.length / 6; e++) {
    if (Number.isNaN(n[e * 6 + 3])) continue;
    const s1 = dot(n, e * 6, dir) > FACING;
    const s2 = dot(n, e * 6 + 3, dir) > FACING;
    if (s1 !== s2) for (let k = 0; k < 6; k++) out.push(topo.positions[e * 6 + k]);
  }
  return new Float32Array(out);
}

// ---------------------------------------------------------------------------
// Έλεγχος ορατότητας
// ---------------------------------------------------------------------------

class Occluders {
  private tri: Float64Array;
  private cellStart: Int32Array;
  private cellItems: Int32Array;
  private g: number;
  private minU: number;
  private minV: number;
  private cw: number;
  private ch: number;
  private eps: number;

  constructor(tris: Float32Array, f: ViewFrame, diag: number) {
    const n = tris.length / 9;
    const keep: number[] = [];
    const t = new Float64Array(n * 9);
    let minU = Infinity;
    let minV = Infinity;
    let maxU = -Infinity;
    let maxV = -Infinity;
    const minArea = diag * diag * 1e-12;
    for (let i = 0; i < n; i++) {
      const o = keep.length * 9;
      for (let k = 0; k < 3; k++) {
        const p = i * 9 + k * 3;
        t[o + k * 3] = dot(tris, p, f.right);
        t[o + k * 3 + 1] = dot(tris, p, f.up);
        t[o + k * 3 + 2] = dot(tris, p, f.dir);
      }
      const area = (t[o + 3] - t[o]) * (t[o + 7] - t[o + 1]) - (t[o + 6] - t[o]) * (t[o + 4] - t[o + 1]);
      if (Math.abs(area) < minArea) continue; // τρίγωνο «στην κόψη»: δεν κρύβει τίποτα
      for (let k = 0; k < 3; k++) {
        minU = Math.min(minU, t[o + k * 3]);
        maxU = Math.max(maxU, t[o + k * 3]);
        minV = Math.min(minV, t[o + k * 3 + 1]);
        maxV = Math.max(maxV, t[o + k * 3 + 1]);
      }
      keep.push(i);
    }
    this.tri = t.subarray(0, keep.length * 9);
    const m = keep.length;
    this.g = Math.max(1, Math.min(256, Math.ceil(Math.sqrt(m / 4))));
    this.minU = minU;
    this.minV = minV;
    this.cw = Math.max((maxU - minU) / this.g, 1e-12);
    this.ch = Math.max((maxV - minV) / this.g, 1e-12);
    this.eps = diag * 1e-5;

    // Πλέγμα επιτάχυνσης (CSR): ποια τρίγωνα καλύπτουν κάθε κελί.
    const cells = (i: number) => {
      const o = i * 9;
      const us = [this.tri[o], this.tri[o + 3], this.tri[o + 6]];
      const vs = [this.tri[o + 1], this.tri[o + 4], this.tri[o + 7]];
      return [this.cell(Math.min(...us), 'u'), this.cell(Math.max(...us), 'u'), this.cell(Math.min(...vs), 'v'), this.cell(Math.max(...vs), 'v')];
    };
    const counts = new Int32Array(this.g * this.g + 1);
    for (let i = 0; i < m; i++) {
      const [u0, u1, v0, v1] = cells(i);
      for (let a = u0; a <= u1; a++) for (let b = v0; b <= v1; b++) counts[a * this.g + b + 1]++;
    }
    for (let k = 1; k < counts.length; k++) counts[k] += counts[k - 1];
    this.cellStart = counts;
    this.cellItems = new Int32Array(counts[counts.length - 1]);
    const fill = counts.slice(0, -1);
    for (let i = 0; i < m; i++) {
      const [u0, u1, v0, v1] = cells(i);
      for (let a = u0; a <= u1; a++) for (let b = v0; b <= v1; b++) this.cellItems[fill[a * this.g + b]++] = i;
    }
  }

  private cell(x: number, axis: 'u' | 'v') {
    const c = axis === 'u' ? Math.floor((x - this.minU) / this.cw) : Math.floor((x - this.minV) / this.ch);
    return Math.max(0, Math.min(this.g - 1, c));
  }

  /** Υπάρχει επιφάνεια πιο κοντά στον παρατηρητή από το βάθος d στο σημείο (u, v); */
  covers(u: number, v: number, d: number): boolean {
    const a = this.cell(u, 'u');
    const b = this.cell(v, 'v');
    const k = a * this.g + b;
    const t = this.tri;
    for (let j = this.cellStart[k]; j < this.cellStart[k + 1]; j++) {
      const o = this.cellItems[j] * 9;
      const x0 = t[o], y0 = t[o + 1], x1 = t[o + 3], y1 = t[o + 4], x2 = t[o + 6], y2 = t[o + 7];
      const den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
      const l0 = ((y1 - y2) * (u - x2) + (x2 - x1) * (v - y2)) / den;
      const l1 = ((y2 - y0) * (u - x2) + (x0 - x2) * (v - y2)) / den;
      const l2 = 1 - l0 - l1;
      if (l0 < -1e-9 || l1 < -1e-9 || l2 < -1e-9) continue;
      if (l0 * t[o + 2] + l1 * t[o + 5] + l2 * t[o + 8] > d + this.eps) return true;
    }
    return false;
  }
}

/** Γραμμές μιας όψης σε συντεταγμένες όψης (mm), χωρισμένες σε ορατές και κρυφές. */
export function projectView(tris: Float32Array, lines: Float32Array, f: ViewFrame, diag: number): Segment2[] {
  const occ = new Occluders(tris, f, diag);
  const step = diag / 300;
  const raw: Segment2[] = [];
  for (let i = 0; i < lines.length; i += 6) {
    const A: Vec3 = [dot(lines, i, f.right), dot(lines, i, f.up), dot(lines, i, f.dir)];
    const B: Vec3 = [dot(lines, i + 3, f.right), dot(lines, i + 3, f.up), dot(lines, i + 3, f.dir)];
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    if (len < diag * 1e-6) continue; // η ακμή είναι παράλληλη με τη ματιά
    const at = (t: number): Vec3 => [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
    const hiddenAt = (t: number) => {
      const p = at(t);
      return occ.covers(p[0], p[1], p[2]);
    };
    // Δείγματα στα μέσα υποδιαστημάτων (όχι στα άκρα, που είναι γωνίες με αμφίσημη ορατότητα).
    const n = Math.max(2, Math.min(400, Math.ceil(len / step)));
    const ts = Array.from({ length: n }, (_, k) => (k + 0.5) / n);
    const states = ts.map(hiddenAt);
    const cuts = [0];
    const runState = [states[0]];
    for (let k = 1; k < n; k++) {
      if (states[k] === states[k - 1]) continue;
      // ακριβές όριο με διχοτόμηση ανάμεσα στα δύο δείγματα
      let lo = ts[k - 1];
      let hi = ts[k];
      for (let it = 0; it < 14; it++) {
        const mid = (lo + hi) / 2;
        if (hiddenAt(mid) === states[k - 1]) lo = mid;
        else hi = mid;
      }
      cuts.push((lo + hi) / 2);
      runState.push(states[k]);
    }
    cuts.push(1);
    for (let r = 0; r < runState.length; r++) {
      const p0 = at(cuts[r]);
      const p1 = at(cuts[r + 1]);
      raw.push({ a: [p0[0], p0[1]], b: [p1[0], p1[1]], hidden: runState[r] });
    }
  }
  return cleanup(raw, diag);
}

/**
 * Ένωση συνευθειακών κομματιών και προτεραιότητα ορατών: σε κάθε ευθεία, οι ορατές γραμμές
 * ενώνονται και από τις κρυφές αφαιρείται ό,τι καλύπτεται από ορατές.
 */
export function cleanup(segs: Segment2[], diag: number): Segment2[] {
  const tol = diag * 1e-4;
  const groups = new Map<string, { c: number; s: number; cs: number; vis: [number, number][]; hid: [number, number][] }>();
  for (const sg of segs) {
    const dx = sg.b[0] - sg.a[0];
    const dy = sg.b[1] - sg.a[1];
    const len = Math.hypot(dx, dy);
    if (len < tol) continue;
    let th = Math.atan2(dy, dx);
    if (th < 0) th += Math.PI;
    if (th >= Math.PI - 1e-9) th -= Math.PI;
    const cs = Math.cos(th);
    const sn = Math.sin(th);
    const c = -sn * sg.a[0] + cs * sg.a[1];
    const key = `${Math.round(th * 1e5)}|${Math.round(c / tol)}`;
    let g = groups.get(key);
    if (!g) {
      g = { c, s: sn, cs, vis: [], hid: [] };
      groups.set(key, g);
    }
    const t0 = cs * sg.a[0] + sn * sg.a[1];
    const t1 = cs * sg.b[0] + sn * sg.b[1];
    (sg.hidden ? g.hid : g.vis).push([Math.min(t0, t1), Math.max(t0, t1)]);
  }
  const union = (iv: [number, number][]) => {
    const s = [...iv].sort((p, q) => p[0] - q[0]);
    const out: [number, number][] = [];
    for (const [a, b] of s) {
      const last = out[out.length - 1];
      if (last && a <= last[1] + tol) last[1] = Math.max(last[1], b);
      else out.push([a, b]);
    }
    return out;
  };
  const subtract = (iv: [number, number][], minus: [number, number][]) => {
    let cur = iv;
    for (const [m0, m1] of minus) {
      const next: [number, number][] = [];
      for (const [a, b] of cur) {
        if (m1 <= a + tol || m0 >= b - tol) next.push([a, b]);
        else {
          if (m0 > a + tol) next.push([a, m0]);
          if (m1 < b - tol) next.push([m1, b]);
        }
      }
      cur = next;
    }
    return cur;
  };
  const out: Segment2[] = [];
  const hiddenOut: Segment2[] = [];
  for (const g of groups.values()) {
    const vis = union(g.vis);
    const hid = subtract(union(g.hid), vis).filter(([a, b]) => b - a > diag * 2e-3);
    const pt = (t: number): P2 => [t * g.cs - g.c * g.s, t * g.s + g.c * g.cs];
    for (const [a, b] of vis) out.push({ a: pt(a), b: pt(b), hidden: false });
    for (const [a, b] of hid) hiddenOut.push({ a: pt(a), b: pt(b), hidden: true });
  }
  // Κρυφό κομμάτι που ακουμπά πάνω σε ορατή γραμμή (π.χ. το χείλος μιας οπής που συμπίπτει με το
  // περίγραμμα σε καμπύλη) δεν σχεδιάζεται: η ορατή γραμμή έχει προτεραιότητα.
  const near = diag * 2e-3;
  const distToSeg = (p: P2, s: Segment2) => {
    const dx = s.b[0] - s.a[0];
    const dy = s.b[1] - s.a[1];
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - s.a[0]) * dx + (p[1] - s.a[1]) * dy) / l2));
    return Math.hypot(p[0] - s.a[0] - t * dx, p[1] - s.a[1] - t * dy);
  };
  const onVisible = (p: P2) => out.some((v) => distToSeg(p, v) < near);
  for (const h of hiddenOut) {
    const m: P2 = [(h.a[0] + h.b[0]) / 2, (h.a[1] + h.b[1]) / 2];
    if (!(onVisible(h.a) && onVisible(h.b) && onVisible(m))) out.push(h);
  }
  return out;
}
