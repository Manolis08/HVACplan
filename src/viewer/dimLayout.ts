import { formatScaled, type Scale } from '../lib/scale';
import type { DimSpec, Vec3 } from '../model/types';

export type DimsMode = 'all' | 'overall' | 'none';

type P2 = [number, number];

export interface DimLayoutInput {
  dims: DimSpec[];
  /** Προβολή σημείου μοντέλου σε pixel οθόνης. */
  project: (p: Vec3) => P2;
  /** Μοναδιαία κατεύθυνση από το μοντέλο προς την κάμερα. */
  viewDir: Vec3;
  corners: Vec3[];
  scale: Scale;
  mode: DimsMode;
  style?: DimStyle;
}

export interface DimStyle {
  /** Απόσταση πρώτης γραμμής διάστασης από το περίγραμμα. */
  gap: number;
  /** Απόσταση μεταξύ στοιβαγμένων διαστάσεων. */
  step: number;
  /** Κενό ανάμεσα στο αντικείμενο και τη γραμμή επέκτασης / προέκταση πέρα από τη γραμμή διάστασης. */
  extGap: number;
  extOver: number;
  arrowL: number;
  arrowW: number;
  labelOff: number;
  /** Κάτω από αυτό το μήκος η διάσταση θεωρείται παράλληλη με τη ματιά και παραλείπεται. */
  minLen: number;
  /**
   * Φύλλο χαρτιού: ρητά χρώματα/πάχη (όχι CSS) και κείμενο παράλληλο στη γραμμή διάστασης
   * (κάθετες: αριστερή πλευρά −90°, δεξιά +90°· οριζόντιες 0°).
   */
  paper?: { fontSize: number; lineWidth: number };
}

/** Οθόνη: μονάδες σε pixel. */
export const SCREEN_STYLE: DimStyle = { gap: 14, step: 22, extGap: 3, extOver: 6, arrowL: 8, arrowW: 2.6, labelOff: 7, minLen: 8 };

/** Χαρτί: μονάδες σε mm (κείμενο 3,5 mm, γραμμές 0,25 mm). */
export const PAPER_STYLE: DimStyle = {
  gap: 8,
  step: 7,
  extGap: 1,
  extOver: 2,
  arrowL: 2.5,
  arrowW: 0.8,
  labelOff: 1.6,
  minLen: 1,
  paper: { fontSize: 3.5, lineWidth: 0.25 },
};

const sub = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: P2, b: P2): P2 => [a[0] + b[0], a[1] + b[1]];
const mul = (a: P2, k: number): P2 => [a[0] * k, a[1] * k];
const dot2 = (a: P2, b: P2) => a[0] * b[0] + a[1] * b[1];
const len2 = (a: P2) => Math.hypot(a[0], a[1]);
const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const r = (v: number) => v.toFixed(2);
const pt = (p: P2) => `${r(p[0])} ${r(p[1])}`;

function arrow(tip: P2, dir: P2, s: DimStyle): string {
  const base = sub(tip, mul(dir, s.arrowL));
  const perp: P2 = [-dir[1], dir[0]];
  return `M${pt(tip)}L${pt(add(base, mul(perp, s.arrowW)))}L${pt(add(base, mul(perp, -s.arrowW)))}Z`;
}

/** Ιδιότητες στοιχείων: CSS κλάσεις στην οθόνη, ρητά χρώματα/πάχη στο χαρτί. */
const attrs = (s: DimStyle) =>
  s.paper
    ? {
        ext: `fill="none" stroke="#000" stroke-width="${s.paper.lineWidth}"`,
        line: `fill="none" stroke="#000" stroke-width="${s.paper.lineWidth}"`,
        arrow: 'fill="#000"',
        text: `font-size="${s.paper.fontSize}" font-family="sans-serif" fill="#000"`,
      }
    : { ext: 'class="dim-ext"', line: 'class="dim-line"', arrow: 'class="dim-arrow"', text: 'class="dim-label"' };

/** Ετικέτα πριν τοποθετηθεί οριστικά (για να αποφύγουμε επικαλύψεις). */
interface LabelSpec {
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
  baseline: 'central' | 'hanging' | 'auto' | 'middle';
  angle: number;
  text: string;
  /** Κατεύθυνση της γραμμής διάστασης (για μετακίνηση κατά μήκος της) και προς τα έξω. */
  u: P2;
  n: P2;
}

/** Οθόνη: οριζόντιο κείμενο δίπλα στη γραμμή, προς την πλευρά n. */
function screenLabel(at: P2, u: P2, n: P2, text: string): LabelSpec {
  let anchor: LabelSpec['anchor'] = 'middle';
  let baseline: LabelSpec['baseline'] = 'central';
  if (Math.abs(n[0]) > 0.7) anchor = n[0] > 0 ? 'start' : 'end';
  else baseline = n[1] > 0 ? 'hanging' : 'auto';
  return { x: at[0], y: at[1], anchor, baseline, angle: 0, text, u, n };
}

/**
 * Χαρτί: κείμενο παράλληλο στη γραμμή διάστασης, «από πάνω» της. Οριζόντιες 0°, κάθετες
 * στην αριστερή πλευρά −90° (διαβάζεται από κάτω προς τα πάνω), στη δεξιά +90°.
 */
function paperLabel(mid: P2, u: P2, n: P2, text: string, s: DimStyle): LabelSpec {
  const vertical = Math.abs(u[1]) > Math.abs(u[0]);
  let angle: number;
  let at: P2;
  const off = s.labelOff + s.paper!.fontSize / 2;
  if (vertical) {
    const left = n[0] < 0;
    angle = left ? -90 : 90;
    at = add(mid, [left ? -off : off, 0]);
  } else {
    // πλάγια ή οριζόντια: γωνία της γραμμής, ώστε το κείμενο να μη διαβάζεται ανάποδα
    let a = (Math.atan2(u[1], u[0]) * 180) / Math.PI;
    if (a > 90) a -= 180;
    if (a <= -90) a += 180;
    angle = a;
    const up: P2 = [Math.sin((a * Math.PI) / 180), -Math.cos((a * Math.PI) / 180)];
    at = add(mid, mul(up, off));
  }
  return { x: at[0], y: at[1], anchor: 'middle', baseline: 'middle', angle, text, u, n };
}

const fontSize = (s: DimStyle) => s.paper?.fontSize ?? 13;

/** Ορθογώνιο που πιάνει μια ετικέτα (κατά προσέγγιση: πλάτος ανάλογο του αριθμού χαρακτήρων). */
function labelBox(l: LabelSpec, s: DimStyle) {
  const size = fontSize(s);
  let w = l.text.length * size * 0.62 + size * 0.3;
  let h = size * 1.15;
  if (Math.abs(Math.abs(l.angle) - 90) < 1) [w, h] = [h, w];
  const x0 = l.anchor === 'start' ? l.x : l.anchor === 'end' ? l.x - w : l.x - w / 2;
  const y0 = l.baseline === 'hanging' ? l.y : l.baseline === 'auto' ? l.y - h : l.y - h / 2;
  return { x0, y0, x1: x0 + w, y1: y0 + h };
}

/**
 * Αποφυγή επικαλύψεων: κάθε ετικέτα που πέφτει πάνω σε προηγούμενη μετακινείται κατά μήκος της
 * γραμμής της (±) ή λίγο προς τα έξω, στην πρώτη θέση που είναι ελεύθερη.
 */
function resolveLabels(labels: LabelSpec[], s: DimStyle): LabelSpec[] {
  const size = fontSize(s);
  const pad = size * 0.15;
  const placed: ReturnType<typeof labelBox>[] = [];
  const hits = (b: ReturnType<typeof labelBox>) =>
    placed.some((p) => b.x0 < p.x1 + pad && b.x1 > p.x0 - pad && b.y0 < p.y1 + pad && b.y1 > p.y0 - pad);
  return labels.map((l) => {
    const w = l.text.length * size * 0.62 + size * 0.3;
    const h = size * 1.15;
    const shifts: P2[] = [
      [0, 0],
      mul(l.u, 0.75 * w),
      mul(l.u, -0.75 * w),
      mul(l.u, 1.5 * w),
      mul(l.u, -1.5 * w),
      mul(l.n, h),
      mul(l.n, 2 * h),
      add(mul(l.n, h), mul(l.u, 0.75 * w)),
      add(mul(l.n, h), mul(l.u, -0.75 * w)),
    ];
    for (const d of shifts) {
      const cand = { ...l, x: l.x + d[0], y: l.y + d[1] };
      const box = labelBox(cand, s);
      if (!hits(box)) {
        placed.push(box);
        return cand;
      }
    }
    placed.push(labelBox(l, s));
    return l;
  });
}

function emitLabel(l: LabelSpec, s: DimStyle): string {
  const t = l.angle ? ` transform="rotate(${r(l.angle)} ${r(l.x)} ${r(l.y)})"` : '';
  return `<text ${attrs(s).text} x="${r(l.x)}" y="${r(l.y)}" text-anchor="${l.anchor}" dominant-baseline="${l.baseline}"${t}>${l.text}</text>`;
}

interface Placed {
  dim: Extract<DimSpec, { kind: 'linear' }>;
  A: P2;
  B: P2;
  len: number;
  n: P2; // κάθετο στη γραμμή στην οθόνη, προς την πλευρά της μετατόπισης
  group: string;
}

/** SVG (εσωτερικό ενός <g>) με τις διαστάσεις για την τρέχουσα όψη. */
export function layoutDims(input: DimLayoutInput): string {
  const { project, viewDir, corners, scale, mode } = input;
  const s = input.style ?? SCREEN_STYLE;
  const at = attrs(s);
  if (mode === 'none') return '';
  const dims = input.dims.filter((d) => mode === 'all' || d.overall);
  const projCorners = corners.map(project);
  const parts: string[] = [];
  const labels: LabelSpec[] = [];
  /** Κράτηση θέσης για ετικέτα· γράφεται στο τέλος, αφού λυθούν οι επικαλύψεις. */
  const label = (mid: P2, u: P2, n: P2, labelAt: P2, text: string) => {
    labels.push(s.paper ? paperLabel(mid, u, n, text, s) : screenLabel(labelAt, u, n, text));
    return `\u0001${labels.length - 1}\u0001`;
  };
  const placed: Placed[] = [];

  for (const dim of dims) {
    if (dim.kind !== 'linear') continue;
    const A = project(dim.a);
    const B = project(dim.b);
    const ab = sub(B, A);
    const len = len2(ab);
    if (len < s.minLen) continue; // η διάσταση είναι παράλληλη με τη ματιά μας
    const u = mul(ab, 1 / len);
    const perp: P2 = [-u[1], u[0]];

    for (const o of dim.offsets) {
      // απόρριψη μετατόπισης σχεδόν παράλληλης με τη ματιά
      const along = dot3(o, viewDir);
      if (Math.sqrt(Math.max(0, 1 - along * along)) < 0.3) continue;
      const tip = project([dim.a[0] + o[0], dim.a[1] + o[1], dim.a[2] + o[2]]);
      const raw = sub(tip, A);
      const rl = len2(raw);
      if (rl < 1e-9) continue;
      const d = mul(raw, 1 / rl);
      let n = perp;
      if (dot2(n, d) < 0) n = mul(n, -1);
      if (dot2(n, d) < 0.35) continue;
      const axis = [0, 1, 2].reduce((best, a) =>
        Math.abs(dim.b[a] - dim.a[a]) > Math.abs(dim.b[best] - dim.a[best]) ? a : best, 0);
      // Η 3D κατεύθυνση διαλέγει μόνο την πλευρά· η μετατόπιση γίνεται κάθετα στη γραμμή στην οθόνη.
      placed.push({ dim, A, B, len, n, group: `${o.join(',')}|${axis}` });
      break;
    }
  }

  // Στοίβαγμα παράλληλων διαστάσεων στην ίδια πλευρά: πρώτα οι μικρές/χαρακτηριστικών.
  const levels = new Map<Placed, number>();
  const groups = new Map<string, Placed[]>();
  for (const p of placed) groups.set(p.group, [...(groups.get(p.group) ?? []), p]);
  for (const list of groups.values()) {
    list
      .sort((a, b) => Number(a.dim.overall) - Number(b.dim.overall) || a.len - b.len)
      .forEach((p, i) => levels.set(p, i));
  }

  // Σε όψεις κατά άξονα όλες οι διαστάσεις μπαίνουν έξω από το περίγραμμα (όπως στο σχέδιο).
  // Σε ισομετρική/ελεύθερη, οι διαστάσεις χαρακτηριστικών μένουν κοντά στο χαρακτηριστικό.
  const axisView = Math.max(...viewDir.map(Math.abs)) > 0.999;

  for (const p of placed) {
    const { A, B, n, len } = p;
    let m = 0;
    if (axisView || p.dim.overall) for (const c of projCorners) m = Math.max(m, dot2(sub(c, A), n));
    const dist = m + s.gap + (levels.get(p) ?? 0) * s.step;
    const off = mul(n, dist);
    const d = n;
    const A2 = add(A, off);
    const B2 = add(B, off);
    const u = mul(sub(B2, A2), 1 / len);

    const ext =
      `M${pt(add(A, mul(d, s.extGap)))}L${pt(add(A2, mul(d, s.extOver)))}` +
      `M${pt(add(B, mul(d, s.extGap)))}L${pt(add(B2, mul(d, s.extOver)))}`;
    let line: string;
    let arrows: string;
    const pad = s.arrowL * 0.75;
    if (len >= 2 * s.arrowL + pad) {
      line = `M${pt(A2)}L${pt(B2)}`;
      arrows = arrow(A2, mul(u, -1), s) + arrow(B2, u, s);
    } else {
      // μικρή διάσταση: βέλη απ' έξω
      line = `M${pt(sub(A2, mul(u, s.arrowL + pad)))}L${pt(add(B2, mul(u, s.arrowL + pad)))}`;
      arrows = arrow(A2, u, s) + arrow(B2, mul(u, -1), s);
    }
    const mid = mul(add(A2, B2), 0.5);
    parts.push(
      `<g class="dim" data-dim="${p.dim.id}"><path ${at.ext} d="${ext}"/><path ${at.line} d="${line}"/>` +
        `<path ${at.arrow} d="${arrows}"/>${label(mid, u, n, add(mid, mul(n, s.labelOff)), formatScaled(p.dim.value, scale))}</g>`,
    );
  }

  for (const dim of dims) {
    if (dim.kind !== 'diameter') continue;
    // η οπή φαίνεται "από τη μύτη": κρύβουμε το Ø όταν τη βλέπουμε σχεδόν από το πλάι
    if (Math.abs(dot3(dim.axis, viewDir)) < 0.3) continue;
    const rad = dim.value / 2;
    const candidates: Vec3[] = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ].filter((a) => Math.abs(dot3(a as Vec3, dim.axis)) < 0.5) as Vec3[];
    let best: { A: P2; B: P2; len: number } | null = null;
    for (const a of candidates) {
      const A = project([dim.center[0] - a[0] * rad, dim.center[1] - a[1] * rad, dim.center[2] - a[2] * rad]);
      const B = project([dim.center[0] + a[0] * rad, dim.center[1] + a[1] * rad, dim.center[2] + a[2] * rad]);
      const l = len2(sub(B, A));
      if (!best || l > best.len) best = { A, B, len: l };
    }
    if (!best || best.len < s.minLen) continue;
    const { A, B, len } = best;
    const u = mul(sub(B, A), 1 / len);
    let n: P2 = [-u[1], u[0]];
    if (n[1] > 0) n = mul(n, -1); // ετικέτα από πάνω
    const mid = mul(add(A, B), 0.5);
    parts.push(
      `<g class="dim" data-dim="${dim.id}"><path ${at.line} d="M${pt(A)}L${pt(B)}"/>` +
        `<path ${at.arrow} d="${arrow(A, mul(u, -1), s) + arrow(B, u, s)}"/>` +
        `${label(mid, u, n, add(mid, mul(n, s.labelOff)), `Ø${formatScaled(dim.value, scale)}`)}</g>`,
    );
  }

  for (const dim of dims) {
    if (dim.kind !== 'radius') continue;
    if (Math.abs(dot3(dim.axis, viewDir)) < 0.3) continue;
    const A = project(dim.center);
    const B = project([
      dim.center[0] + dim.dir[0] * dim.value,
      dim.center[1] + dim.dir[1] * dim.value,
      dim.center[2] + dim.dir[2] * dim.value,
    ]);
    const len = len2(sub(B, A));
    if (len < s.minLen) continue;
    const u = mul(sub(B, A), 1 / len);
    const tail = add(B, mul(u, s.arrowL * 2.5));
    parts.push(
      `<g class="dim" data-dim="${dim.id}"><path ${at.line} d="M${pt(A)}L${pt(tail)}"/>` +
        `<path ${at.arrow} d="${arrow(B, u, s)}"/>` +
        `${label(add(B, mul(u, s.arrowL * 1.6)), u, [-u[1], u[0]], add(B, mul(u, s.labelOff + 3)), `R${formatScaled(dim.value, scale)}`)}</g>`,
    );
  }

  const finalLabels = resolveLabels(labels, s);
  return parts.join('').replace(/\u0001(\d+)\u0001/g, (_, i) => emitLabel(finalLabels[Number(i)], s));
}
