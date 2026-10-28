// Τ+Π: η κατεργασία βήμα-βήμα, όπως στο εργαστήριο. Από δύο ορθογώνιες λάμες (56 × 55 και 52 × 55, πάχος 8):
//   1. τρύπες με το τρυπάνι: δύο στις εσωτερικές γωνίες του Τ (για να «σταματήσει» εκεί η κοπή) και μια
//      σειρά από πέντε στο βάθος της εγκοπής του Π (το πριόνι δεν κόβει εκεί μέσα),
//   2. κοπή με το σιδεροπρίονο κατά μήκος του περιγράμματος· όταν ελευθερωθεί ένα κομμάτι υλικού, πέφτει,
//   3. οι κομμένες πλευρές είναι ανώμαλες (γρέζια) και η λίμα τις ισιώνει με κινήσεις μπρος-πίσω.
// Όλα είναι συνάρτηση της προόδου τ (0…1), ώστε η μπάρα να πηγαίνει μπρος και πίσω. Η γεωμετρία είναι
// περίγραμμα με τρύπες, εξωθημένο στο πάχος· οι εγκοπές του πριονιού και τα γρέζια είναι μέρος του περιγράμματος.
// Συντεταγμένες κάθε κομματιού: X μήκος (το Τ 0…56, το Π 0…52), Y πλάτος (0…55), Z πάχος (0…8).
import { Matrix4, Quaternion, Vector3 } from 'three';
import { circlePolygon, extrudeProfile, type Pt2 } from './geometry';
import type { PartGeometry, Vec3 } from './types';

export const TP = {
  /** πλάτος των λαμών (βάθος, Y) */
  W: 55,
  /** πάχος */
  T: 8,
  /** μήκος του σώματος της Α (χωρίς τη γλώσσα) */
  LA: 26,
  /** μήκος της Β */
  LB: 52,
  /** γλώσσα / εγκοπή: μήκος (X) και πλάτος (Y) */
  TL: 30,
  TW: 20,
  /** η γλώσσα στη μέση του πλάτους: (55 − 20) / 2 = 17,5 από τη μπροστινή άκρη */
  TY: 17.5,
} as const;

/** Απόσταση των δύο κομματιών όταν είναι χωριστά: η γλώσσα (30) βγαίνει ολόκληρη από την εγκοπή, συν κενό. */
export const TP_APART = TP.TL + 6;

const { W, T, LA, LB, TL, TW, TY } = TP;
const LT = LA + TL; // 56, μήκος του Τ

export type PieceId = 'T' | 'P';
export type ToolKind = 'drill' | 'saw' | 'file';

/** Ακτίνα τρύπας (Ø1,9: ίση με το τρυπάνι) και πλάτος κοπής του πριονιού (mm). */
export const HOLE_R = 0.95;
export const KERF = 0.8;
/** η κοπή σταματά τόσο πριν από την τρύπα (το λεπτό υλικό που μένει σπάει μόλις πέσει το κομμάτι) */
const CUT_STOP = 0.3;
/** διάρκεια (σε τ) της πτώσης ενός κομματιού υλικού μόλις ελευθερωθεί, και βάθος πτώσης (mm): πέφτει ώσπου να βγει από την οθόνη */
const FALL = 0.04;
const FALL_DEPTH = 700;
/** απόσταση (mm) ανάμεσα στα «δόντια» των γρεζιών */
const BUMP_STEP = 1.1;

interface DrillSpec {
  kind: 'drill';
  piece: PieceId;
  id: string;
  region: number;
  x: number;
  y: number;
}
interface SawSpec {
  kind: 'saw';
  piece: PieceId;
  id: string;
  region: number;
  /** αρχή της κοπής (κέντρο της εγκοπής, πάνω στο περίγραμμα) και κατεύθυνσή της */
  p0: Pt2;
  u: Pt2;
  len: number;
  /** με αυτή την κοπή ελευθερώνεται το κομμάτι υλικού της περιοχής */
  last: boolean;
}
interface FileSpec {
  kind: 'file';
  piece: PieceId;
  id: string;
  region: number;
  /** η πλευρά που λιμάρεται (από a σε b) και η κατεύθυνση προς τα έξω από το υλικό */
  a: Pt2;
  b: Pt2;
  out: Pt2;
  /** μέγιστο ύψος γρεζιών (mm) */
  amp: number;
}
type OpSpec = DrillSpec | SawSpec | FileSpec;
export type Op = OpSpec & { t0: number; t1: number };

const R = HOLE_R;
const K = KERF;
/** οι πέντε τρύπες του Π: κέντρα ανά 4 mm, ώστε να μένει 0,2 mm ανάμεσά τους */
const P_HOLES = [-2, -1, 0, 1, 2].map((k) => TY + TW / 2 + k * 4);

/** Οι εργασίες κάθε κομματιού, με τη σειρά που γίνονται. Περιοχές υλικού που φεύγουν: Τ 0 = πάνω, 1 = κάτω· Π 0 = εγκοπή. */
const SPECS: Record<PieceId, OpSpec[]> = {
  T: [
    { kind: 'drill', piece: 'T', id: 'T-h0', region: 0, x: LA + R, y: TY + TW + R },
    { kind: 'drill', piece: 'T', id: 'T-h1', region: 1, x: LA + R, y: TY - R },
    { kind: 'saw', piece: 'T', id: 'T-c0v', region: 0, p0: [LA + K / 2, W], u: [0, -1], len: W - (TY + TW + 2 * R + CUT_STOP), last: false },
    { kind: 'saw', piece: 'T', id: 'T-c0h', region: 0, p0: [LT, TY + TW + K / 2], u: [-1, 0], len: LT - (LA + 2 * R + CUT_STOP), last: true },
    { kind: 'saw', piece: 'T', id: 'T-c1v', region: 1, p0: [LA + K / 2, 0], u: [0, 1], len: TY - 2 * R - CUT_STOP, last: false },
    { kind: 'saw', piece: 'T', id: 'T-c1h', region: 1, p0: [LT, TY - K / 2], u: [-1, 0], len: LT - (LA + 2 * R + CUT_STOP), last: true },
    { kind: 'file', piece: 'T', id: 'T-f0v', region: 0, a: [LA, TY + TW], b: [LA, W], out: [1, 0], amp: 0.45 },
    { kind: 'file', piece: 'T', id: 'T-f0h', region: 0, a: [LT, TY + TW], b: [LA, TY + TW], out: [0, 1], amp: 0.45 },
    { kind: 'file', piece: 'T', id: 'T-f1v', region: 1, a: [LA, 0], b: [LA, TY], out: [1, 0], amp: 0.45 },
    { kind: 'file', piece: 'T', id: 'T-f1h', region: 1, a: [LA, TY], b: [LT, TY], out: [0, -1], amp: 0.45 },
  ],
  P: [
    ...P_HOLES.map((y, i): DrillSpec => ({ kind: 'drill', piece: 'P', id: `P-h${i}`, region: 0, x: TL - R, y })),
    { kind: 'saw', piece: 'P', id: 'P-c0u', region: 0, p0: [0, TY + TW - K / 2], u: [1, 0], len: TL - 2 * R - CUT_STOP, last: false },
    { kind: 'saw', piece: 'P', id: 'P-c0l', region: 0, p0: [0, TY + K / 2], u: [1, 0], len: TL - 2 * R - CUT_STOP, last: true },
    { kind: 'file', piece: 'P', id: 'P-f0u', region: 0, a: [0, TY + TW], b: [TL, TY + TW], out: [0, -1], amp: 0.45 },
    // ο πάτος της εγκοπής βγαίνει από τις τρύπες: πιο ανώμαλος
    { kind: 'file', piece: 'P', id: 'P-f0e', region: 0, a: [TL, TY + TW], b: [TL, TY], out: [-1, 0], amp: 0.9 },
    { kind: 'file', piece: 'P', id: 'P-f0l', region: 0, a: [TL, TY], b: [0, TY], out: [0, 1], amp: 0.45 },
  ],
};

const REGIONS: Record<PieceId, number> = { T: 2, P: 1 };

/** Διαστήματα της προόδου τ για κάθε εργαλείο. */
export const PHASES: Record<ToolKind, [number, number]> = { drill: [0.04, 0.34], saw: [0.37, 0.7], file: [0.73, 0.985] };
/** Μέσα σε κάθε εργασία: πλησίασμα, δουλειά, απομάκρυνση (κλάσματα της διάρκειάς της). */
const WORK: Record<ToolKind, [number, number]> = { drill: [0.25, 0.85], saw: [0.12, 0.9], file: [0.12, 0.9] };

const segLen = (a: Pt2, b: Pt2) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const weight = (s: OpSpec) => (s.kind === 'drill' ? 1 : s.kind === 'saw' ? s.len + 8 : segLen(s.a, s.b) + 8);

/** Χρονοπρόγραμμα: οι εργασίες των κομματιών, η μία μετά την άλλη μέσα στη φάση κάθε εργαλείου. */
export function makeSchedule(pieces: PieceId[]): Op[] {
  const ops: Op[] = [];
  for (const kind of ['drill', 'saw', 'file'] as const) {
    const list = pieces.flatMap((p) => SPECS[p].filter((s) => s.kind === kind));
    const total = list.reduce((n, s) => n + weight(s), 0);
    const [a, b] = PHASES[kind];
    let t = a;
    for (const s of list) {
      const d = ((b - a) * weight(s)) / total;
      ops.push({ ...s, t0: t, t1: t + d });
      t += d;
    }
  }
  return ops;
}

const SCHEDULES = { both: makeSchedule(['T', 'P']), T: makeSchedule(['T']), P: makeSchedule(['P']) };
/** Το χρονοπρόγραμμα για τα δύο κομμάτια μαζί ή για ένα μόνο του. */
export const scheduleFor = (which: 'both' | PieceId) => SCHEDULES[which];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (t: number) => t * t * (3 - 2 * t);
const localT = (op: Op, tau: number) => clamp01((tau - op.t0) / (op.t1 - op.t0));
/** Πόσο έχει γίνει η δουλειά μιας εργασίας (0…1) στην πρόοδο τ. */
export const workOf = (op: Op, tau: number) => {
  const [a, b] = WORK[op.kind];
  return clamp01((localT(op, tau) - a) / (b - a));
};

interface PieceState {
  /** τρύπες με το βάθος τους (0…T) */
  holes: { x: number; y: number; depth: number; region: number }[];
  /** μήκος κάθε κοπής (mm) */
  cut: Map<string, number>;
  /** ανά περιοχή υλικού: −1 = στη θέση του, 0…1 = πέφτει, ≥ 1 = έφυγε */
  fall: number[];
  /** πόσο ανώμαλη είναι κάθε κομμένη πλευρά (1 = όπως την άφησε το πριόνι, 0 = λιμαρισμένη) */
  rough: Map<string, number>;
}

function stateOf(piece: PieceId, schedule: Op[], tau: number): PieceState {
  const ops = schedule.filter((o) => o.piece === piece);
  const fall = Array.from({ length: REGIONS[piece] }, () => -1);
  for (const o of ops) {
    if (o.kind !== 'saw' || !o.last) continue;
    const free = o.t0 + (o.t1 - o.t0) * WORK.saw[1];
    if (tau >= free) fall[o.region] = (tau - free) / FALL;
  }
  const holes: PieceState['holes'] = [];
  const cut = new Map<string, number>();
  const rough = new Map<string, number>();
  for (const o of ops) {
    const w = workOf(o, tau);
    if (o.kind === 'drill' && w > 0 && fall[o.region] < 0) holes.push({ x: o.x, y: o.y, depth: Math.min(T, T * w), region: o.region });
    if (o.kind === 'saw') cut.set(o.id, o.len * w);
    if (o.kind === 'file') rough.set(o.id, 1 - w);
  }
  return { holes, cut, fall, rough };
}

/** Έχουν φύγει όλα τα κομμάτια υλικού (το κομμάτι έχει πάρει το τελικό του σχήμα, ίσως με γρέζια); */
export const shapeCut = (piece: PieceId, schedule: Op[], tau: number) => stateOf(piece, schedule, tau).fall.every((f) => f >= 0);

/** Τέλος κατεργασίας: τρυπημένο, κομμένο και λιμαρισμένο. */
export const machined = (tau: number) => tau >= 1;

// ---------- Γεωμετρία ----------

/** Ψευδοτυχαίο 0…1, ίδιο κάθε φορά για τον ίδιο σπόρο (ώστε τα γρέζια να μην «τρεμοπαίζουν»). */
function hash(seed: number, i: number) {
  const x = Math.sin(seed * 127.1 + i * 311.7) * 43758.5453;
  return x - Math.floor(x);
}
const seedOf = (id: string) => [...id].reduce((s, c) => (s * 31 + c.charCodeAt(0)) % 9973, 7);

interface Outline {
  pts: Pt2[];
  /** κορυφές πάνω σε γρέζια: χωρίς κάθετη ακμή */
  smooth: boolean[];
}

function outlineBuilder() {
  const o: Outline = { pts: [], smooth: [] };
  const add = (p: Pt2, smooth = false) => {
    const last = o.pts[o.pts.length - 1];
    if (last && Math.abs(last[0] - p[0]) < 1e-9 && Math.abs(last[1] - p[1]) < 1e-9) return;
    o.pts.push(p);
    o.smooth.push(smooth);
  };
  /** εγκοπή του πριονιού που ξεκινά από το περίγραμμα στο s, προχωρά κατά u για L, με πλάτος κατά k (ενδιάμεσες κορυφές) */
  const notch = (s: Pt2, u: Pt2, L: number, k: Pt2) => {
    if (L < 0.02) return;
    add(s);
    add([s[0] + u[0] * L, s[1] + u[1] * L]);
    add([s[0] + u[0] * L + k[0], s[1] + u[1] * L + k[1]]);
    add([s[0] + k[0], s[1] + k[1]]);
  };
  /** κομμένη πλευρά από a σε b με γρέζια προς τα έξω (αμ = 0: ευθεία) */
  const rough = (f: FileSpec, from: Pt2, to: Pt2, amount: number) => {
    add(from);
    if (amount > 1e-4) {
      const len = segLen(from, to);
      const n = Math.max(2, Math.round(len / BUMP_STEP));
      const seed = seedOf(f.id);
      // ο σπόρος ακολουθεί τη θέση πάνω στην πλευρά a→b, όποια φορά κι αν τη διασχίζουμε
      const forward = segLen(f.a, from) < 1e-6;
      for (let i = 1; i < n; i++) {
        const t = i / n;
        const d = f.amp * amount * (0.25 + 0.75 * hash(seed, forward ? i : n - i));
        add([from[0] + (to[0] - from[0]) * t + f.out[0] * d, from[1] + (to[1] - from[1]) * t + f.out[1] * d], true);
      }
    }
    add(to);
  };
  return { o, add, notch, rough };
}

/** Αφαιρεί κορυφές πάνω σε ευθεία (π.χ. γωνίες εγκοπών που δεν έχουν ανοίξει ακόμη), ώστε να μη βγαίνουν άσκοπες ακμές. */
function dropCollinear(o: Outline): Outline {
  const out: Outline = { pts: [], smooth: [] };
  const n = o.pts.length;
  for (let i = 0; i < n; i++) {
    const a = o.pts[(i + n - 1) % n], b = o.pts[i], c = o.pts[(i + 1) % n];
    const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1];
    const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
    const straight = Math.abs(ux * vy - uy * vx) <= 1e-9 * lu * lv && ux * vx + uy * vy > 0;
    if (lu > 1e-9 && lv > 1e-9 && straight) continue;
    out.pts.push(b);
    out.smooth.push(o.smooth[i]);
  }
  return out;
}

const spec = (piece: PieceId, id: string) => SPECS[piece].find((s) => s.id === id)!;

/** Περίγραμμα του Τ στην κατάσταση st (αριστερόστροφα). */
function outlineT(st: PieceState): Outline {
  const { o, add, notch, rough } = outlineBuilder();
  const c = (id: string) => st.cut.get(id) ?? 0;
  const f = (id: string) => spec('T', id) as FileSpec;
  const r = (id: string) => st.rough.get(id) ?? 1;
  add([0, 0]);
  if (st.fall[1] < 0) {
    notch([LA, 0], [0, 1], c('T-c1v'), [K, 0]);
    add([LT, 0]);
    notch([LT, TY - K], [-1, 0], c('T-c1h'), [0, K]);
  } else {
    rough(f('T-f1v'), [LA, 0], [LA, TY], r('T-f1v'));
    rough(f('T-f1h'), [LA, TY], [LT, TY], r('T-f1h'));
  }
  add([LT, TY]);
  add([LT, TY + TW]);
  if (st.fall[0] < 0) {
    notch([LT, TY + TW], [-1, 0], c('T-c0h'), [0, K]);
    add([LT, W]);
    notch([LA + K, W], [0, -1], c('T-c0v'), [-K, 0]);
  } else {
    rough(f('T-f0h'), [LT, TY + TW], [LA, TY + TW], r('T-f0h'));
    rough(f('T-f0v'), [LA, TY + TW], [LA, W], r('T-f0v'));
  }
  add([LA, W]);
  add([0, W]);
  return o;
}

/** Περίγραμμα του Π στην κατάσταση st (αριστερόστροφα). */
function outlineP(st: PieceState): Outline {
  const { o, add, notch, rough } = outlineBuilder();
  const c = (id: string) => st.cut.get(id) ?? 0;
  const f = (id: string) => spec('P', id) as FileSpec;
  const r = (id: string) => st.rough.get(id) ?? 1;
  add([0, 0]);
  add([LB, 0]);
  add([LB, W]);
  add([0, W]);
  if (st.fall[0] < 0) {
    notch([0, TY + TW], [1, 0], c('P-c0u'), [0, -K]);
    notch([0, TY + K], [1, 0], c('P-c0l'), [0, -K]);
  } else {
    rough(f('P-f0u'), [0, TY + TW], [TL, TY + TW], r('P-f0u'));
    rough(f('P-f0e'), [TL, TY + TW], [TL, TY], r('P-f0e'));
    rough(f('P-f0l'), [TL, TY], [0, TY], r('P-f0l'));
  }
  add([0, TY]);
  return o;
}

/** Τα κομμάτια υλικού που πέφτουν (ορθογώνια χωρίς τις εγκοπές) και προς τα πού γέρνουν. */
const WASTE: Record<PieceId, { rect: [number, number, number, number]; out: Pt2 }[]> = {
  T: [
    { rect: [LA + K, TY + TW + K, LT, W], out: [0, 1] },
    { rect: [LA + K, 0, LT, TY - K], out: [0, -1] },
  ],
  P: [{ rect: [0, TY + K, TL - 2 * R, TY + TW - K], out: [-1, 0] }],
};

const HOLE_SEGMENTS = 20;

function loopEdges(loop: Pt2[], z: number, dx: number, dy: number, out: number[]) {
  for (let i = 0; i < loop.length; i++) {
    const [ax, ay] = loop[i];
    const [bx, by] = loop[(i + 1) % loop.length];
    out.push(ax + dx, ay + dy, z, bx + dx, by + dy, z);
  }
}

/**
 * Γεωμετρία ενός κομματιού στην πρόοδο τ, μετατοπισμένη κατά (dx, dy). Μια τρύπα που τρυπιέται τώρα
 * (όχι ακόμη πέρα για πέρα) φτιάχνεται με δύο στρώσεις: η επάνω έχει την τρύπα, η κάτω όχι.
 */
export function pieceGeometry(piece: PieceId, schedule: Op[], tau: number, dx = 0, dy = 0): PartGeometry {
  const st = stateOf(piece, schedule, tau);
  const outline = dropCollinear(piece === 'T' ? outlineT(st) : outlineP(st));
  const circle = (h: { x: number; y: number }) => circlePolygon(h.x, h.y, HOLE_R, HOLE_SEGMENTS);
  const through = st.holes.filter((h) => h.depth >= T - 1e-6);
  const partial = st.holes.find((h) => h.depth < T - 1e-6);
  const at = (z0: number) => (u: number, v: number, w: number): Vec3 => [u + dx, v + dy, w + z0];

  const tris: Float32Array[] = [];
  if (partial) {
    const d = partial.depth;
    tris.push(extrudeProfile({ outer: outline.pts, holes: [...through, partial].map(circle) }, d, at(T - d)).triangles);
    tris.push(extrudeProfile({ outer: outline.pts, holes: through.map(circle) }, T - d, at(0)).triangles);
  } else {
    tris.push(extrudeProfile({ outer: outline.pts, holes: through.map(circle) }, T, at(0)).triangles);
  }

  // ακμές: περίγραμμα πάνω και κάτω, κάθετες στις γωνίες (όχι στα γρέζια), κύκλοι των τρυπών
  const edges: number[] = [];
  loopEdges(outline.pts, T, dx, dy, edges);
  loopEdges(outline.pts, 0, dx, dy, edges);
  outline.pts.forEach(([x, y], i) => {
    if (!outline.smooth[i]) edges.push(x + dx, y + dy, 0, x + dx, y + dy, T);
  });
  for (const h of st.holes) loopEdges(circle(h), T, dx, dy, edges);
  for (const h of through) loopEdges(circle(h), 0, dx, dy, edges);
  if (partial) loopEdges(circle(partial), T - partial.depth, dx, dy, edges);

  // υλικό που πέφτει: γέρνει προς τα έξω και κατεβαίνει
  st.fall.forEach((f, region) => {
    if (f < 0 || f >= 1) return;
    const { rect, out } = WASTE[piece][region];
    const [x0, y0, x1, y1] = rect;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const rot = new Matrix4().makeRotationAxis(new Vector3(-out[1], out[0], 0).normalize(), 0.9 * f);
    const v = new Vector3();
    const map = (u: number, w2: number, w: number): Vec3 => {
      v.set(u - cx, w2 - cy, w - T / 2).applyMatrix4(rot);
      return [v.x + cx + out[0] * 10 * f + dx, v.y + cy + out[1] * 10 * f + dy, v.z + T / 2 - FALL_DEPTH * f * f];
    };
    const g = extrudeProfile({ outer: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], holes: [] }, T, map);
    tris.push(g.triangles);
    edges.push(...g.edges);
  });

  const triangles = new Float32Array(tris.reduce((n, t) => n + t.length, 0));
  let i = 0;
  for (const t of tris) {
    triangles.set(t, i);
    i += t.length;
  }
  const len = piece === 'T' ? LT : LB;
  return { triangles, edges: new Float32Array(edges), bbox: { min: [dx, dy, 0], max: [dx + len, dy + W, T] } };
}

// ---------- Εργαλεία ----------

/**
 * Θέση ενός εργαλείου: το «κανονικό» του σύστημα (βλ. TpTools) μεταφέρεται εδώ. Κανονικά συστήματα:
 * τρυπάνι: αρχή στη μύτη, το τρυπάνι προς −Z, η λαβή προς +X· πριόνι: αρχή στη μέση των δοντιών, η λάμα
 * κατά +Z (προς τη λαβή), τα δόντια προς +X· λίμα: αρχή στη μέση της επιφάνειας που λιμάρει, μήκος κατά X,
 * το σώμα της προς +Y (στην κατεργασία στέκεται όρθια, με τη μύτη κάτω).
 */
export interface ToolPose {
  kind: ToolKind;
  opacity: number;
  pos: Vec3;
  quat: [number, number, number, number];
  /** παλινδρόμηση (πριόνι, λίμα): άξονας και πλάτος σε mm */
  strokeAxis: Vec3;
  strokeAmp: number;
  /** το τσοκ του τρυπανιού γυρίζει */
  spin: boolean;
}

/** Διαφάνεια των εργαλείων («φαντάσματα») και πόσο νωρίτερα/αργότερα από τη φάση τους εμφανίζονται. */
const GHOST = 0.4;
const FADE = 0.012;
/** ύψος (mm) πάνω από το κομμάτι όταν το εργαλείο μετακινείται από εργασία σε εργασία */
const TRAVEL = 24;
/** κλίση της λάμας από την κατακόρυφη: 0 = όρθια, μέσα στο επίπεδο της κοπής, με τα δόντια προς το μέτωπό της */
const SAW_TILT = 0;
/** μισό πλάτος της λίμας (mm): μένει μέσα στην πλευρά, ώστε να μην ακουμπά στο διπλανό υλικό */
export const FILE_HALF = 4.5;
/** το κέντρο της λίμας λίγο πιο πάνω από το κομμάτι: η λίμα «έρχεται από πάνω» */
const FILE_RAISE = 12;

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const qOf = (x: Vector3, y: Vector3, z: Vector3) => new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
const qArr = (q: Quaternion): [number, number, number, number] => [q.x, q.y, q.z, q.w];

const DRILL_Q = qOf(new Vector3(0, 1, 0), new Vector3(-1, 0, 0), new Vector3(0, 0, 1)); // λαβή προς +Y (μακριά από τον θεατή)

function sawQ(op: SawSpec) {
  const u = new Vector3(op.u[0], op.u[1], 0);
  const z = new Vector3(0, 0, 1);
  const a = z.clone().multiplyScalar(Math.cos(SAW_TILT)).addScaledVector(u, -Math.sin(SAW_TILT));
  const t = u.clone().multiplyScalar(Math.cos(SAW_TILT)).addScaledVector(z, Math.sin(SAW_TILT));
  return { q: qOf(t, a.clone().cross(t), a), axis: a };
}

/** Η λίμα όρθια πάνω στην πλευρά: η μύτη κάτω, η επίπεδη επιφάνεια πάνω στην πλευρά, το σώμα της προς τα έξω. */
function fileQ(op: FileSpec) {
  const up = new Vector3(0, 0, 1);
  const out = new Vector3(op.out[0], op.out[1], 0);
  return { q: qOf(up, out, up.clone().cross(out)), axis: up };
}

/** Πού είναι τα εργαλεία στην πρόοδο τ. offsets: πού βρίσκεται κάθε κομμάτι (λείπει = δεν φαίνεται). */
export function toolPoses(schedule: Op[], tau: number, offsets: Partial<Record<PieceId, [number, number]>>): ToolPose[] {
  const poses: ToolPose[] = [];
  for (const kind of ['drill', 'saw', 'file'] as const) {
    const ops = schedule.filter((o) => o.kind === kind && offsets[o.piece]);
    if (!ops.length) continue;
    const start = ops[0].t0, end = ops[ops.length - 1].t1;
    if (tau <= start - FADE || tau >= end + FADE) continue;
    const opacity = GHOST * smooth(clamp01((tau - (start - FADE)) / FADE)) * smooth(clamp01((end + FADE - tau) / FADE));
    let idx = ops.findIndex((o) => tau < o.t1);
    if (idx < 0) idx = ops.length - 1;
    const op = ops[idx];
    const prev = ops[Math.max(0, idx - 1)];
    const lt = localT(op, tau);
    const [wa, wb] = WORK[kind];
    const w = clamp01((lt - wa) / (wb - wa));
    const world = (o: Op, p: Pt2, z: number): Vec3 => {
      const off = offsets[o.piece]!;
      return [p[0] + off[0], p[1] + off[1], z];
    };

    if (op.kind === 'drill' && prev.kind === 'drill') {
      const above = (o: DrillSpec) => world(o as Op, [o.x, o.y], T + TRAVEL);
      const here = above(op);
      let pos: Vec3;
      if (lt < wa) {
        const k = lt / wa;
        pos = k < 0.55 ? lerp3(above(prev), here, ease(k / 0.55)) : lerp3(here, [here[0], here[1], T + 0.3], ease((k - 0.55) / 0.45));
      } else if (lt < wb) pos = [here[0], here[1], T + 0.3 - (T + 1.1) * w];
      else pos = lerp3([here[0], here[1], -0.8], here, ease((lt - wb) / (1 - wb)));
      poses.push({ kind, opacity, pos, quat: qArr(DRILL_Q), strokeAxis: [0, 0, 1], strokeAmp: 0, spin: lt > wa * 0.8 && lt < wb + 0.03 });
    } else if (op.kind === 'saw' && prev.kind === 'saw') {
      const cur = sawQ(op);
      const front = (o: SawSpec, s: number) => world(o as Op, [o.p0[0] + o.u[0] * s, o.p0[1] + o.u[1] * s], T / 2);
      const lift = (p: Vec3): Vec3 => [p[0], p[1], p[2] + TRAVEL];
      let pos: Vec3;
      let q = cur.q;
      if (lt < wa) {
        const k = lt / wa;
        const from = prev === op ? lift(front(op, 0)) : lift(front(prev, prev.len));
        if (k < 0.6) {
          pos = lerp3(from, lift(front(op, 0)), ease(k / 0.6));
          q = new Quaternion().slerpQuaternions(sawQ(prev).q, cur.q, ease(k / 0.6));
        } else pos = lerp3(lift(front(op, 0)), front(op, 0), ease((k - 0.6) / 0.4));
      } else if (lt < wb) pos = front(op, op.len * w);
      else pos = lerp3(front(op, op.len), lift(front(op, op.len)), ease((lt - wb) / (1 - wb)));
      const working = lt >= wa && lt < wb;
      poses.push({ kind, opacity, pos, quat: qArr(q), strokeAxis: [cur.axis.x, cur.axis.y, cur.axis.z], strokeAmp: working ? 13 : 0, spin: false });
    } else if (op.kind === 'file' && prev.kind === 'file') {
      const cur = fileQ(op);
      // η λίμα ακουμπά στις κορυφές των γρεζιών, που μικραίνουν όσο λιμάρει
      const contact = (o: FileSpec, s: number, roughness: number) => {
        const e = segLen(o.a, o.b);
        const t = s / e;
        const gap = o.amp * roughness + 0.05;
        return world(o as Op, [o.a[0] + (o.b[0] - o.a[0]) * t + o.out[0] * gap, o.a[1] + (o.b[1] - o.a[1]) * t + o.out[1] * gap], T / 2 + FILE_RAISE);
      };
      const away = (o: FileSpec, p: Vec3): Vec3 => [p[0] + o.out[0] * 10, p[1] + o.out[1] * 10, p[2] + 30];
      const L = segLen(op.a, op.b);
      // το κέντρο της λίμας περνά κατά μήκος της πλευράς, χωρίς να βγαίνει από τα άκρα της
      const lo = Math.min(L / 2, FILE_HALF + 0.5), hi = Math.max(L / 2, L - FILE_HALF - 0.5);
      const sAt = (k: number) => lo + (hi - lo) * k;
      let pos: Vec3;
      let q = cur.q;
      if (lt < wa) {
        const k = lt / wa;
        const from = prev === op ? away(op, contact(op, sAt(0), 1)) : away(prev, contact(prev, segLen(prev.a, prev.b) / 2, 0));
        if (k < 0.6) {
          pos = lerp3(from, away(op, contact(op, sAt(0), 1)), ease(k / 0.6));
          q = new Quaternion().slerpQuaternions(fileQ(prev).q, cur.q, ease(k / 0.6));
        } else pos = lerp3(away(op, contact(op, sAt(0), 1)), contact(op, sAt(0), 1), ease((k - 0.6) / 0.4));
      } else if (lt < wb) pos = contact(op, sAt(w), 1 - w);
      else pos = lerp3(contact(op, sAt(1), 0), away(op, contact(op, sAt(1), 0)), ease((lt - wb) / (1 - wb)));
      const working = lt >= wa && lt < wb;
      // κίνηση πάνω-κάτω κατά μήκος της λίμας
      poses.push({ kind, opacity, pos, quat: qArr(q), strokeAxis: [cur.axis.x, cur.axis.y, cur.axis.z], strokeAmp: working ? 9 : 0, spin: false });
    }
  }
  return poses;
}
