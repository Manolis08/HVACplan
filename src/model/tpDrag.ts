// Φυσική του συρσίματος στο Τ+Π: το κομμάτι κρέμεται από το σημείο λαβής (το χεράκι), ακολουθεί τον
// στόχο (το ποντίκι) με ελατήριο, στρίβει και γέρνει από την αδράνειά του (ragdoll), και δεν περνά μέσα
// από το ακίνητο κομμάτι. Οι συγκρούσεις λύνονται στην κάτοψη (XY) με μικρά υποβήματα, ώστε ένα γρήγορο
// τράβηγμα να μη «διαπερνά» λεπτά σημεία (π.χ. τα σκέλη του Π).
// Κοντά στη θέση του μέσα στο σύνολο, ένα «μαγνητικό πεδίο» το τραβά πίσω (το Π προς το Τ και το Τ προς
// το Π)· αν το αφήσεις εκεί, ξαναμπαίνει στη θέση του και η επιλογή ακυρώνεται.
import type { Vec3 } from './types';

/** Ορθογώνιο κάτοψης: x0, y0, x1, y1. */
export type Rect = [number, number, number, number];

export interface DragBody {
  /** σημείο λαβής στις συντεταγμένες του κομματιού: γύρω από αυτό στρίβει και γέρνει */
  pivot: Vec3;
  /** τα ορθογώνια του κομματιού που σέρνεται (στις δικές του συντεταγμένες) και του ακίνητου */
  own: Rect[];
  other: Rect[];
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  yawV: number;
  rx: number;
  rxV: number;
  ry: number;
  ryV: number;
  /** ακουμπά στο άλλο κομμάτι (στο τελευταίο βήμα) */
  contact: boolean;
}

const FOLLOW_K = 260; // ελατήριο θέσης (1/s²)
const FOLLOW_C = 26; // απόσβεση θέσης, λίγο κάτω από την κρίσιμη (2√K ≈ 32): ελαφρύ ξεπέρασμα
const YAW_K = 18;
const YAW_C = 3.2;
const YAW_GAIN = 0.5;
const YAW_MAX = 1.2;
const TILT_K = 70;
const TILT_C = 6;
const TILT_PER_SPEED = 0.0025; // rad ανά mm/s
const TILT_MAX = 0.3;
/** μέγιστη μετατόπιση ανά υποβήμα (mm): πολύ μικρότερη από το λεπτότερο σημείο των κομματιών */
const MAX_STEP = 0.5;
const MAX_SUBSTEPS = 80;
const EPS = 1e-4;
/** αν για να λυθεί μια στροφή χρειάζεται να σπρωχτεί το κομμάτι πάνω από τόσο, η στροφή εμποδίζεται */
const YAW_PUSH_LIMIT = 0.3;
/**
 * Μαγνητικό πεδίο γύρω από τη θέση συναρμογής, σε δύο μέρη: από πιο μακριά ευθυγραμμίζει το κομμάτι
 * (πλάγια, κατά Y, και στροφή), ώστε η γλώσσα να βρει την εγκοπή, και από πιο κοντά το τραβά μέσα (κατά X).
 */
export const MAGNET_RADIUS = 50;
const ALIGN_FULL = 33; // mm: από εδώ και μέσα πλήρης ευθυγράμμιση (λίγο πάνω από το μήκος της γλώσσας, 30)
const ALIGN_MAX = 1;
const PULL_RADIUS = 35;
const PULL_MAX = 0.9;
/** τριβή κατά μήκος του τοίχου (1/s) */
const FRICTION = 5;
/** αν αφήσεις το κομμάτι μέσα σε αυτή την απόσταση (mm), ξαναμπαίνει στη θέση του */
export const RETURN_RADIUS = 12;

/** Απόσταση (κάτοψη) του σημείου λαβής από τη θέση συναρμογής. */
export function homeDistance(b: DragBody) {
  return Math.hypot(b.pos[0] - b.pivot[0], b.pos[1] - b.pivot[1]);
}

/** Αφέθηκε αρκετά κοντά στη θέση του ώστε να ξαναμπεί (ακύρωση της επιλογής). */
export const nearHome = (b: DragBody) => homeDistance(b) < RETURN_RADIUS && Math.abs(b.yaw) < 0.4;

/** Έχει κάτσει στη θέση του (ακίνητο, ίσιο). */
export const atHome = (b: DragBody) =>
  homeDistance(b) < 0.05 && Math.abs(b.pos[2] - b.pivot[2]) < 0.05 && Math.hypot(...b.vel) < 1 && Math.abs(b.yaw) < 0.005;

/** Βάρη του μαγνητικού πεδίου στη θέση του κομματιού (0 = καθόλου, κοντά στο 1 = πλήρως). */
function magnet(b: DragBody) {
  const d = homeDistance(b);
  const align = ALIGN_MAX * Math.min(1, Math.max(0, (MAGNET_RADIUS - d) / (MAGNET_RADIUS - ALIGN_FULL)));
  const pull = d >= PULL_RADIUS ? 0 : PULL_MAX * (1 - d / PULL_RADIUS) ** 2;
  return { align, pull };
}

export function createDrag(pivot: Vec3, own: Rect[], other: Rect[]): DragBody {
  return { pivot, own, other, pos: [...pivot], vel: [0, 0, 0], yaw: 0, yawV: 0, rx: 0, rxV: 0, ry: 0, ryV: 0, contact: false };
}

type Pt = [number, number];

function corners(b: DragBody, r: Rect): Pt[] {
  const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
  const pts: Pt[] = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
  return pts.map(([x, y]) => {
    const dx = x - b.pivot[0], dy = y - b.pivot[1];
    return [b.pos[0] + c * dx - s * dy, b.pos[1] + s * dx + c * dy];
  });
}

/**
 * Βαθύτερη επικάλυψη ανάμεσα στο κομμάτι που σέρνεται και στο ακίνητο (SAT). Επιστρέφει το βάθος και
 * τη μοναδιαία κατεύθυνση προς την οποία πρέπει να μετακινηθεί το κομμάτι για να βγει, ή null.
 */
export function deepestOverlap(b: DragBody): { depth: number; nx: number; ny: number } | null {
  const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
  const axes: Pt[] = [[1, 0], [0, 1], [c, s], [-s, c]];
  let worst: { depth: number; nx: number; ny: number } | null = null;
  for (const r of b.own) {
    const a = corners(b, r);
    for (const o of b.other) {
      const oc: Pt[] = [[o[0], o[1]], [o[2], o[1]], [o[2], o[3]], [o[0], o[3]]];
      let depth = Infinity, nx = 0, ny = 0;
      for (const [ax, ay] of axes) {
        let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
        for (const [x, y] of a) {
          const v = x * ax + y * ay;
          if (v < a0) a0 = v;
          if (v > a1) a1 = v;
        }
        for (const [x, y] of oc) {
          const v = x * ax + y * ay;
          if (v < b0) b0 = v;
          if (v > b1) b1 = v;
        }
        // δύο τρόποι να χωρίσουν: το δικό μας προς τα αρνητικά (κατά a1 − b0) ή προς τα θετικά (κατά b1 − a0)
        const back = a1 - b0, fwd = b1 - a0;
        const d = Math.min(back, fwd);
        if (d <= EPS) {
          depth = 0;
          break;
        }
        if (d < depth) {
          depth = d;
          const sign = back < fwd ? -1 : 1;
          nx = ax * sign;
          ny = ay * sign;
        }
      }
      if (depth > EPS && (!worst || depth > worst.depth)) worst = { depth, nx, ny };
    }
  }
  return worst;
}

/** Βγάζει το κομμάτι από το ακίνητο, σβήνοντας την ταχύτητα προς τον τοίχο (με λίγη τριβή). */
function resolve(b: DragBody, h: number): number {
  let moved = 0;
  for (let i = 0; i < 8; i++) {
    const o = deepestOverlap(b);
    if (!o) break;
    b.pos[0] += o.nx * o.depth;
    b.pos[1] += o.ny * o.depth;
    moved += o.depth;
    b.contact = true;
    const vn = b.vel[0] * o.nx + b.vel[1] * o.ny;
    if (vn < 0) {
      b.vel[0] -= vn * o.nx;
      b.vel[1] -= vn * o.ny;
      // τριβή κατά μήκος του τοίχου (ανά δευτερόλεπτο, όχι ανά υποβήμα)
      const f = Math.exp(-FRICTION * h);
      b.vel[0] *= f;
      b.vel[1] *= f;
    }
  }
  return moved;
}

const clamp = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v));

/** Ένα καρέ (dt σε s) προς τον στόχο του σημείου λαβής. */
export function stepDrag(b: DragBody, target: Vec3, dt: number) {
  dt = Math.min(Math.max(dt, 0), 1 / 30);
  if (dt === 0) return;
  // αρκετά υποβήματα ώστε καμία μετατόπιση να μην ξεπερνά το MAX_STEP
  const speed = Math.hypot(b.vel[0], b.vel[1]) + Math.hypot(target[0] - b.pos[0], target[1] - b.pos[1]) * Math.sqrt(FOLLOW_K);
  const n = Math.min(MAX_SUBSTEPS, Math.max(4, Math.ceil((speed * dt) / MAX_STEP)));
  const h = dt / n;
  b.contact = false;
  for (let k = 0; k < n; k++) {
    // μαγνήτης: ο στόχος μετατοπίζεται προς τη θέση συναρμογής, τόσο περισσότερο όσο πιο κοντά είναι το κομμάτι
    const m = magnet(b);
    const acc: Vec3 = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const w = i === 1 ? Math.max(m.align, m.pull) : m.pull; // Y: ευθυγράμμιση· X, Z: τράβηγμα μέσα
      const goal = target[i] + (b.pivot[i] - target[i]) * w;
      acc[i] = FOLLOW_K * (goal - b.pos[i]) - FOLLOW_C * b.vel[i];
      b.vel[i] += acc[i] * h;
    }
    let mx = b.vel[0] * h, my = b.vel[1] * h;
    const len = Math.hypot(mx, my);
    if (len > MAX_STEP) {
      mx *= MAX_STEP / len;
      my *= MAX_STEP / len;
    }
    b.pos[0] += mx;
    b.pos[1] += my;
    b.pos[2] += b.vel[2] * h;
    resolve(b, h);
    // σφήνωμα που δεν λύνεται με μετακίνηση (π.χ. η γλώσσα 20 στην εγκοπή 20 με ελάχιστη στροφή, που
    // ακουμπά και στους δύο τοίχους): το κομμάτι ισιώνει
    for (let i = 0; i < 6 && deepestOverlap(b); i++) {
      b.yaw *= 0.5;
      b.yawV = 0;
      if (Math.abs(b.yaw) < 1e-6) b.yaw = 0;
      resolve(b, h);
    }

    // στροφή: η επιτάχυνση του σημείου λαβής στρίβει το κομμάτι που κρέμεται από αυτό
    const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
    let cx = 0, cy = 0, area = 0;
    for (const r of b.own) {
      const a = (r[2] - r[0]) * (r[3] - r[1]);
      cx += ((r[0] + r[2]) / 2) * a;
      cy += ((r[1] + r[3]) / 2) * a;
      area += a;
    }
    const lx = cx / area - b.pivot[0], ly = cy / area - b.pivot[1];
    const armX = c * lx - s * ly, armY = s * lx + c * ly;
    const torque = (armX * acc[1] - armY * acc[0]) / (armX * armX + armY * armY + 200);
    // κοντά στη θέση του ισιώνει κιόλας (ώστε η γλώσσα να βρει την εγκοπή)
    const w = m.align;
    b.yawV += (-YAW_K * (1 + 8 * w) * b.yaw - YAW_C * (1 + 3 * w) * b.yawV + YAW_GAIN * (1 - w) * torque) * h;
    const prevYaw = b.yaw;
    const prevPos: Vec3 = [b.pos[0], b.pos[1], b.pos[2]];
    b.yaw = clamp(b.yaw + b.yawV * h, YAW_MAX);
    // αν η στροφή το σφηνώνει στο άλλο κομμάτι (π.χ. η γλώσσα μέσα στην εγκοπή), δεν γίνεται
    if (b.yaw !== prevYaw && deepestOverlap(b)) {
      const pushed = resolve(b, h);
      if (pushed > YAW_PUSH_LIMIT || deepestOverlap(b)) {
        b.yaw = prevYaw;
        b.yawV = 0;
        b.pos = prevPos;
      }
    }
  }

  // γέρσιμο προς την κίνηση· σε επαφή ισιώνει, ώστε να μη φαίνεται να βουτά μέσα στο άλλο κομμάτι
  const tx = b.contact ? 0 : -clamp(b.vel[1] * TILT_PER_SPEED, TILT_MAX);
  const ty = b.contact ? 0 : clamp(b.vel[0] * TILT_PER_SPEED, TILT_MAX);
  b.rxV += (-TILT_K * (b.rx - tx) - TILT_C * b.rxV) * dt;
  b.ryV += (-TILT_K * (b.ry - ty) - TILT_C * b.ryV) * dt;
  b.rx = clamp(b.rx + b.rxV * dt, TILT_MAX);
  b.ry = clamp(b.ry + b.ryV * dt, TILT_MAX);
}
