// Τ+Π: η άσκηση συναρμογής. Δύο λάμες μαλακού χάλυβα, πλάτος 55 και πάχος 8: η Α γίνεται Τ (μένει
// γλώσσα 30 × 20 στη μέση του πλάτους, ανάμεσα σε δύο κομμένες γωνίες), η Β γίνεται Π (κόβεται εγκοπή
// 30 × 20) και η γλώσσα κουμπώνει στην εγκοπή. Τ: 26 + 30 = 56, Π: 52, συνολικό μήκος 26 + 52 = 78.
// Άξονες όπως σε όλη την εφαρμογή: X μήκος, Y βάθος (μπροστά y = 0), Z πάχος (επάνω).
// Η κατεργασία (τρύπες, κοπή, λίμα) είναι στο tpProcess· εδώ τα κομμάτια μαζί, οι θέσεις και οι διαστάσεις.
import type { Box } from './geometry';
import { machined, pieceGeometry, scheduleFor, shapeCut, TP, TP_APART, type PieceId } from './tpProcess';
import type { BBox, DimSpec, Part, PartGeometry, Vec3 } from './types';

export { TP, TP_APART } from './tpProcess';

const { W, T, LA, LB, TL, TW, TY } = TP;
const LT = LA + TL;
const PX: Vec3 = [1, 0, 0], NX: Vec3 = [-1, 0, 0], NY: Vec3 = [0, -1, 0], PZ: Vec3 = [0, 0, 1], NZ: Vec3 = [0, 0, -1];

const linear = (id: string, value: number, a: Vec3, b: Vec3, offsets: Vec3[], overall = false): DimSpec => ({
  kind: 'linear', id, value, a, b, offsets, overall,
});

/**
 * Η μπάρα του «μαζί»: ως εδώ γίνεται η κατεργασία (τρύπες, κοπή, λίμα, με τα κομμάτια χωριστά) και από
 * εδώ ως το 100 % τα κομμάτια πλησιάζουν και η γλώσσα μπαίνει στην εγκοπή.
 */
export const JOIN_START = 0.9;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** Πρόοδος της κατεργασίας (0…1) για πρόοδο p της μπάρας του «μαζί». */
export const machiningOf = (p: number) => clamp01(p / JOIN_START);
const joinOf = (p: number) => clamp01((p - JOIN_START) / (1 - JOIN_START));
/** Απόσταση των δύο κομματιών στην πρόοδο p (TP_APART χωριστά, 0 συναρμολογημένα). */
const gapOf = (p: number) => TP_APART * (1 - joinOf(p));

/** Πλαίσιο όλης της σκηνής του «μαζί»· ίδιο σε κάθε p, ώστε η κάμερα να μη μετακινείται. */
const SCENE_BBOX: BBox = { min: [-TP_APART / 2, 0, 0], max: [LA + LB + TP_APART / 2, W, T] };

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Box => ({ min: [x0, y0, z0], max: [x1, y1, z1] });
const shift = (b: Box, dx: number): Box => ({ min: [b.min[0] + dx, b.min[1], b.min[2]], max: [b.max[0] + dx, b.max[1], b.max[2]] });

/** Τ ως ορθογώνια (κάτοψη): ολόκληρη λάμα ή το τελικό σχήμα. Για τις συγκρούσεις όταν σέρνεται. */
function tBoxes(final: boolean, dx = 0): Box[] {
  const boxes = final ? [box(0, 0, 0, LA, W, T), box(LA, TY, 0, LT, TY + TW, T)] : [box(0, 0, 0, LT, W, T)];
  return boxes.map((b) => shift(b, dx));
}

/** Π ως ορθογώνια (κάτοψη): ολόκληρη λάμα ή με την εγκοπή 0…30 στη μέση του πλάτους. */
function pBoxes(final: boolean, dx = 0): Box[] {
  const boxes = final
    ? [box(0, 0, 0, TL, TY, T), box(0, TY + TW, 0, TL, W, T), box(TL, 0, 0, LB, W, T)]
    : [box(0, 0, 0, LB, W, T)];
  return boxes.map((b) => shift(b, dx));
}

/** Ένωση γεωμετριών που ακουμπούν: κάθε κομμάτι κρατά τις δικές του ακμές, ώστε να φαίνεται η ραφή. */
function merge(parts: PartGeometry[], bbox: BBox): PartGeometry {
  const triangles = new Float32Array(parts.reduce((n, g) => n + g.triangles.length, 0));
  const edges = new Float32Array(parts.reduce((n, g) => n + g.edges.length, 0));
  let ti = 0, ei = 0;
  for (const g of parts) {
    triangles.set(g.triangles, ti);
    edges.set(g.edges, ei);
    ti += g.triangles.length;
    ei += g.edges.length;
  }
  return { triangles, edges, bbox };
}

const asPart = (g: PartGeometry, dims: DimSpec[]): Part => ({ ...g, dims, circles: [], info: [] });

/** Διαστάσεις της γλώσσας του Τ (όταν έχει κοπεί), με το Τ μετατοπισμένο κατά dx. */
const tongueDims = (dx: number): DimSpec[] => [
  linear('tl', TL, [dx + LA, TY, T], [dx + LT, TY, T], [PZ, NY]),
  linear('tw', TW, [dx + LT, TY, T], [dx + LT, TY + TW, T], [PZ, PX]),
];

/** Διαστάσεις της εγκοπής του Π (όταν έχει κοπεί), με το Π μετατοπισμένο κατά dx. */
const slotDims = (dx: number): DimSpec[] => [
  linear('sl', TL, [dx, TY, T], [dx + TL, TY, T], [PZ, NY]),
  linear('sw', TW, [dx + TL, TY, T], [dx + TL, TY + TW, T], [PZ, PX]),
];

/** Μόνο το Τ, στην πρόοδο κατεργασίας q (0 = ορθογώνια λάμα, 1 = έτοιμο Τ). */
export function buildT(q: number): Part {
  const schedule = scheduleFor('T');
  const dims = [
    linear('L', LT, [0, TY, 0], [LT, TY, 0], [NZ, NY], true),
    linear('W', W, [0, 0, 0], [0, W, 0], [NZ, NX], true),
    linear('H', T, [0, 0, 0], [0, 0, T], [NX, NY], true),
  ];
  if (shapeCut('T', schedule, q)) dims.push(...tongueDims(0), linear('ty', TY, [LA, 0, T], [LA, TY, T], [PZ, PX]));
  return asPart(pieceGeometry('T', schedule, q), dims);
}

/** Μόνο το Π, στην πρόοδο κατεργασίας q (0 = ορθογώνια λάμα, 1 = έτοιμο Π). */
export function buildP(q: number): Part {
  const schedule = scheduleFor('P');
  const dims = [
    linear('L', LB, [0, 0, 0], [LB, 0, 0], [NZ, NY], true),
    linear('W', W, [LB, 0, 0], [LB, W, 0], [NZ, PX], true),
    linear('H', T, [LB, 0, 0], [LB, 0, T], [PX, NY], true),
  ];
  if (shapeCut('P', schedule, q)) dims.push(...slotDims(0), linear('sy', TY, [0, 0, T], [0, TY, T], [PZ, NX]));
  return asPart(pieceGeometry('P', schedule, q), dims);
}

/** Μετατόπιση του μεμονωμένου Τ ή Π ώστε να βρίσκεται εκεί που είναι μέσα στο σύνολο (στην πρόοδο p του «μαζί»). */
export function pieceOffset(id: PieceId, pBoth: number) {
  const gap = gapOf(pBoth);
  return id === 'T' ? -gap / 2 : LA + gap / 2;
}

/**
 * Τα δύο κομμάτια χωριστά (χωρίς διαστάσεις) στην πρόοδο p της μπάρας του «μαζί», με το σταθερό πλαίσιο της
 * σκηνής. Χρησιμεύουν όταν ο χρήστης τραβά το ένα κομμάτι έξω και στις μεταβάσεις.
 */
export function tpPieces(p: number) {
  const tau = machiningOf(p);
  const schedule = scheduleFor('both');
  const piece = (id: PieceId) => asPart({ ...pieceGeometry(id, schedule, tau, pieceOffset(id, p)), bbox: SCENE_BBOX }, []);
  return { gap: gapOf(p), T: piece('T'), P: piece('P') };
}

/**
 * Τ και Π μαζί, στην πρόοδο p: ως το JOIN_START η κατεργασία με τα κομμάτια χωριστά, μετά πλησιάζουν και η
 * γλώσσα μπαίνει στην εγκοπή (1 = συναρμολογημένα, 78 × 55 × 8). Το πλαίσιο (bbox) μένει ίδιο σε κάθε p,
 * ώστε η κάμερα να μη μετακινείται όσο προχωρά η μπάρα.
 */
export function buildTP(p = 1): Part {
  const q = clamp01(p);
  const { T: tPart, P: pPart } = tpPieces(q);
  const g = merge([tPart, pPart], SCENE_BBOX);
  const L = LA + LB;
  if (q < 1) {
    // Χωρισμένα: κάθε κομμάτι έχει τις δικές του διαστάσεις (Τ 56, Π 52, πλάτος 55, πάχος 8)
    const xT = pieceOffset('T', q), xT1 = xT + LT;
    const xP = pieceOffset('P', q), xP1 = xP + LB;
    const dims = [
      linear('LT', LT, [xT, 0, 0], [xT1, 0, 0], [NZ, NY], true),
      linear('WT', W, [xT, 0, 0], [xT, W, 0], [NZ, NX], true),
      linear('HT', T, [xT, 0, 0], [xT, 0, T], [NX, NY], true),
      linear('LP', LB, [xP, 0, 0], [xP1, 0, 0], [NZ, NY], true),
      linear('WP', W, [xP1, 0, 0], [xP1, W, 0], [NZ, PX], true),
      linear('HP', T, [xP1, 0, 0], [xP1, 0, T], [PX, NY], true),
    ];
    const schedule = scheduleFor('both');
    const tau = machiningOf(q);
    if (shapeCut('T', schedule, tau)) dims.push(...tongueDims(xT));
    if (shapeCut('P', schedule, tau)) dims.push(...slotDims(xP));
    return asPart(g, dims);
  }
  return asPart(g, [
    linear('L', L, [0, 0, 0], [L, 0, 0], [NZ, NY], true),
    linear('W', W, [L, 0, 0], [L, W, 0], [NZ, PX], true),
    linear('H', T, [L, 0, 0], [L, 0, T], [PX, NY], true),
    // το Τ ολόκληρο (σώμα + γλώσσα), η γλώσσα και το πλάτος της
    linear('TA', LT, [0, TY, T], [LT, TY, T], [PZ, NY]),
    linear('tl', TL, [LA, TY, T], [LT, TY, T], [PZ, NY]),
    // το πλάτος της γλώσσας από την άλλη πλευρά, για να μη στριμώχνεται με το 55
    linear('tw', TW, [LT, TY, T], [LT, TY + TW, T], [PZ, NX]),
  ]);
}

/** Τα ορθογώνια (κάτοψη XY) που απαρτίζουν κάθε κομμάτι: για τις συγκρούσεις όταν σέρνονται. */
export function tpFootprints(p: number) {
  const final = machined(machiningOf(p));
  const rects = (boxes: Box[]) => boxes.map((b) => [b.min[0], b.min[1], b.max[0], b.max[1]] as [number, number, number, number]);
  return { T: rects(tBoxes(final, pieceOffset('T', p))), P: rects(pBoxes(final, pieceOffset('P', p))) };
}

/** Το ίδιο κομμάτι μετατοπισμένο κατά dx (X) και dy (Y), μαζί με τις διαστάσεις του. */
export function shiftPart(part: Part, dx: number, dy = 0): Part {
  if (dx === 0 && dy === 0) return part;
  const move = (a: Float32Array) => {
    const out = new Float32Array(a);
    for (let i = 0; i < out.length; i += 3) {
      out[i] += dx;
      out[i + 1] += dy;
    }
    return out;
  };
  const mv = (v: Vec3): Vec3 => [v[0] + dx, v[1] + dy, v[2]];
  return {
    ...part,
    triangles: move(part.triangles),
    edges: move(part.edges),
    bbox: { min: mv(part.bbox.min), max: mv(part.bbox.max) },
    dims: part.dims.map((d) => (d.kind === 'linear' ? { ...d, a: mv(d.a), b: mv(d.b) } : { ...d, center: mv(d.center) })),
    circles: part.circles.map((c) => ({ ...c, center: mv(c.center) })),
  };
}
