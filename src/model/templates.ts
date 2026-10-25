import { formatNumber as f } from '../lib/format';
import { bearingSolid, boxUnion } from './geometry';
import type { DimSpec, Issue, Part, PartGeometry, TemplateDef, Vec3 } from './types';

const PX: Vec3 = [1, 0, 0];
const NX: Vec3 = [-1, 0, 0];
const PY: Vec3 = [0, 1, 0];
const NY: Vec3 = [0, -1, 0];
const PZ: Vec3 = [0, 0, 1];
const NZ: Vec3 = [0, 0, -1];

const issue = (fields: string[], message: string): Issue => ({ fields, message });

const linear = (
  id: string,
  value: number,
  a: Vec3,
  b: Vec3,
  offsets: Vec3[],
  overall = false,
): DimSpec => ({ kind: 'linear', id, value, a, b, offsets, overall });

/** Συνολικές διαστάσεις μήκος × βάθος × ύψος για κομμάτι με γωνία στο (0,0,0). */
function overallDims(L: number, W: number, H: number, heightSide: 'left' | 'right'): DimSpec[] {
  return [
    linear('L', L, [0, 0, 0], [L, 0, 0], [NZ, NY], true),
    linear('W', W, [L, 0, 0], [L, W, 0], [NZ, PX], true),
    heightSide === 'right'
      ? linear('H', H, [L, 0, 0], [L, 0, H], [PX, NY], true)
      : linear('H', H, [0, 0, 0], [0, 0, H], [NX, NY], true),
  ];
}

const part = (g: PartGeometry, extra: Omit<Part, keyof PartGeometry>): Part => ({ ...g, ...extra });

// ---------------------------------------------------------------------------
// 1. Κύβος με εγκοπή (εγκοπή στο κέντρο του μήκους, ανοιχτή πάνω και μπροστά)
// ---------------------------------------------------------------------------
const notchedCube: TemplateDef = {
  id: 'notched-cube',
  name: 'ΚΥΒΟΣ',
  description: 'Εγκοπή στο κέντρο του μήκους, ανοιχτή πάνω και μπροστά.',
  params: [
    { key: 'L', label: 'Μήκος', axis: 'X', defaultValue: 30 },
    { key: 'W', label: 'Βάθος', axis: 'Y', defaultValue: 20 },
    { key: 'H', label: 'Ύψος', axis: 'Z', defaultValue: 20 },
    { key: 'nw', label: 'Πλάτος εγκοπής', axis: 'X', defaultValue: 12 },
    { key: 'nd', label: 'Βάθος εγκοπής προς τα μέσα', axis: 'Y', defaultValue: 9 },
    { key: 'nt', label: 'Βάθος εγκοπής από την κορυφή', axis: 'Z', defaultValue: 13 },
  ],
  validate: ({ L, W, H, nw, nd, nt }) => {
    const out: Issue[] = [];
    if (nw >= L)
      out.push(
        issue(['nw', 'L'], `Το πλάτος εγκοπής (${f(nw)}) πρέπει να είναι μικρότερο από το μήκος (${f(L)}), ώστε να μένει υλικό αριστερά και δεξιά.`),
      );
    if (nd >= W)
      out.push(
        issue(['nd', 'W'], `Το βάθος εγκοπής προς τα μέσα (${f(nd)}) πρέπει να είναι μικρότερο από το βάθος του κομματιού (${f(W)}), ώστε να μένει πίσω τοίχος.`),
      );
    if (nt >= H)
      out.push(
        issue(['nt', 'H'], `Το βάθος εγκοπής από την κορυφή (${f(nt)}) πρέπει να είναι μικρότερο από το ύψος (${f(H)}), ώστε να μένει πάτωμα.`),
      );
    return out;
  },
  build: ({ L, W, H, nw, nd, nt }) => {
    const x0 = (L - nw) / 2;
    const x1 = x0 + nw;
    const zf = H - nt;
    const g = boxUnion([
      { min: [0, 0, 0], max: [L, W, zf] }, // πάτωμα
      { min: [0, 0, zf], max: [x0, W, H] }, // αριστερό τοιχάκι
      { min: [x1, 0, zf], max: [L, W, H] }, // δεξί τοιχάκι
      { min: [x0, nd, zf], max: [x1, W, H] }, // πίσω τοίχος
    ]);
    return part(g, {
      dims: [
        ...overallDims(L, W, H, 'right'),
        linear('nw', nw, [x0, 0, H], [x1, 0, H], [PZ, NY]),
        linear('nd', nd, [x1, 0, H], [x1, nd, H], [PZ, PX]),
        linear('nt', nt, [x1, 0, zf], [x1, 0, H], [PX, NY]),
      ],
      circles: [],
      info: [
        { label: 'Υλικό αριστερά και δεξιά της εγκοπής', value: x0, unit: 'mm' },
        { label: 'Πάχος πατώματος', value: zf, unit: 'mm' },
        { label: 'Πάχος πίσω τοίχου', value: W - nd, unit: 'mm' },
      ],
    });
  },
};

// ---------------------------------------------------------------------------
// 2. Έδρανο με χελιδονοουρά (βάση με χελιδονοουρά, ορθοστάτης με R, οπή άξονα, οπή λίπανσης)
// ---------------------------------------------------------------------------
const bearingBlock: TemplateDef = {
  id: 'bearing-block',
  name: 'ΕΞΑΡΤΙΜΑ',
  description: 'Βάση με χελιδονοουρά από κάτω, ορθοστάτης με καμπύλη κορυφή, οπή άξονα και οπή λίπανσης.',
  params: [
    { key: 'L', label: 'Μήκος βάσης', axis: 'X', defaultValue: 100 },
    { key: 'W', label: 'Βάθος', axis: 'Y', defaultValue: 80 },
    { key: 'H', label: 'Ύψος βάσης', axis: 'Z', defaultValue: 20 },
    { key: 'Hax', label: 'Ύψος άξονα οπής από κάτω', axis: 'Z', defaultValue: 50 },
    { key: 'R', label: 'Ακτίνα κορυφής R', defaultValue: 20 },
    { key: 'Db', label: 'Διάμετρος οπής άξονα Ø', defaultValue: 20 },
    { key: 'Gt', label: 'Χελιδονοουρά: πλάτος μέσα (πάνω)', axis: 'X', defaultValue: 80 },
    { key: 'Gb', label: 'Χελιδονοουρά: άνοιγμα (κάτω)', axis: 'X', defaultValue: 60 },
    { key: 'Gd', label: 'Χελιδονοουρά: βάθος', axis: 'Z', defaultValue: 10 },
    { key: 'Do', label: 'Διάμετρος οπής λίπανσης Ø', defaultValue: 4 },
    { key: 'yo', label: 'Οπή λίπανσης από μπροστά', axis: 'Y', defaultValue: 35 },
  ],
  validate: ({ L, W, H, Hax, R, Db, Gt, Gb, Gd, Do, yo }) => {
    const out: Issue[] = [];
    if (2 * R >= L)
      out.push(issue(['R', 'L'], `Ο ορθοστάτης (πλάτος 2 × R = ${f(2 * R)}) πρέπει να είναι στενότερος από τη βάση (${f(L)}).`));
    if (Gt >= L || Gb >= L)
      out.push(issue(['Gt', 'Gb', 'L'], `Η χελιδονοουρά πρέπει να είναι στενότερη από το μήκος της βάσης (${f(L)}).`));
    if (Gd >= H)
      out.push(issue(['Gd', 'H'], `Το βάθος της χελιδονοουράς (${f(Gd)}) πρέπει να είναι μικρότερο από το ύψος της βάσης (${f(H)}).`));
    if (Db / 2 >= R)
      out.push(issue(['Db', 'R'], `Η οπή του άξονα (Ø${f(Db)}) πρέπει να είναι μικρότερη από την κορυφή (Ø${f(2 * R)}), ώστε να μένει τοίχωμα.`));
    if (Hax - Db / 2 <= H)
      out.push(issue(['Hax', 'Db', 'H'], `Η οπή του άξονα κατεβαίνει μέσα στη βάση: το ύψος άξονα (${f(Hax)}) μείον τη μισή διάμετρο (${f(Db / 2)}) πρέπει να ξεπερνά το ύψος βάσης (${f(H)}).`));
    if (Do >= Db)
      out.push(issue(['Do', 'Db'], `Η οπή λίπανσης (Ø${f(Do)}) πρέπει να είναι μικρότερη από την οπή του άξονα (Ø${f(Db)}).`));
    if (Do > R / 2)
      out.push(issue(['Do', 'R'], `Η οπή λίπανσης (Ø${f(Do)}) είναι πολύ μεγάλη για κορυφή R${f(R)}· μέγιστο Ø${f(R / 2)}.`));
    if (yo - Do / 2 <= 0 || yo + Do / 2 >= W)
      out.push(issue(['yo', 'Do', 'W'], `Η οπή λίπανσης πρέπει να είναι μέσα στο βάθος: θέση από ${f(Do / 2)} έως ${f(W - Do / 2)}.`));
    return out;
  },
  build: ({ L, W, H, Hax, R, Db, Gt, Gb, Gd, Do, yo }) => {
    const xc = L / 2;
    const a = Do / 2;
    const g = bearingSolid({ L, W, H, Hax, R, r: Db / 2, Gt, Gb, Gd, a, yo });
    const Ht = Hax + R;
    return part(
      g,
      {
        dims: [
          linear('L', L, [0, 0, 0], [L, 0, 0], [NZ, NY], true),
          linear('W', W, [L, 0, 0], [L, W, 0], [NZ, PX], true),
          linear('Ht', Ht, [L, 0, 0], [L, 0, Ht], [PX, NY], true),
          linear('H', H, [0, 0, 0], [0, 0, H], [NX, NY]),
          linear('Hax', Hax, [0, 0, 0], [0, 0, Hax], [NX, NY]),
          linear('Gb', Gb, [xc - Gb / 2, 0, 0], [xc + Gb / 2, 0, 0], [NZ, NY]),
          linear('Gt', Gt, [xc - Gt / 2, 0, Gd], [xc + Gt / 2, 0, Gd], [NZ, NY]),
          linear('Gd', Gd, [xc + Gt / 2, 0, 0], [xc + Gt / 2, 0, Gd], [PX, NY]),
          { kind: 'radius', id: 'R', value: R, center: [xc, 0, Hax], axis: PY, dir: [-Math.SQRT1_2, 0, Math.SQRT1_2], overall: false },
          { kind: 'diameter', id: 'Db', value: Db, center: [xc, 0, Hax], axis: PY, overall: false },
          { kind: 'diameter', id: 'Do', value: Do, center: [xc, yo, Ht], axis: PZ, overall: false },
          linear('yo', yo, [xc, 0, Ht], [xc, yo, Ht], [PZ, NX]),
        ],
        circles: [
          { center: [xc, 0, Hax], axis: PY, radius: Db / 2, length: W },
          { center: [xc, yo, Hax + Db / 2], axis: PZ, radius: a, length: R - Db / 2 },
        ],
        info: [
          { label: 'Πλάτος ορθοστάτη (2 × R)', value: 2 * R, unit: 'mm' },
          { label: 'Συνολικό ύψος', value: Ht, unit: 'mm' },
          { label: 'Τοίχωμα γύρω από την οπή άξονα', value: R - Db / 2, unit: 'mm' },
          { label: 'Υλικό πάνω από τη χελιδονοουρά', value: H - Gd, unit: 'mm' },
        ],
      },
    );
  },
};

// ---------------------------------------------------------------------------
// 3. Κλιμακωτό κομμάτι: πίσω φτερό, κολόνα και χαμηλό σκαλοπάτι
// ---------------------------------------------------------------------------
const steppedBlock: TemplateDef = {
  id: 'stepped-block',
  name: 'ΤΕΤΡΙΣ',
  description: 'Πίσω φτερό αριστερά (κρεμασμένο από την κορυφή, με κενό από κάτω), ψηλή κολόνα και χαμηλό σκαλοπάτι δεξιά.',
  params: [
    { key: 'P', label: 'Πίσω μήκος (φτερό + κολόνα)', axis: 'X', defaultValue: 20 },
    { key: 'Wc', label: 'Πλάτος κολόνας', axis: 'X', defaultValue: 5 },
    { key: 'Ls', label: 'Μήκος σκαλοπατιού', axis: 'X', defaultValue: 15 },
    { key: 'D', label: 'Βάθος', axis: 'Y', defaultValue: 15 },
    { key: 'Dw', label: 'Βάθος φτερού', axis: 'Y', defaultValue: 3 },
    { key: 'Hs', label: 'Ύψος σκαλοπατιού', axis: 'Z', defaultValue: 5 },
    { key: 'Hu', label: 'Κολόνα πάνω από το σκαλοπάτι', axis: 'Z', defaultValue: 10 },
    { key: 'Hw', label: 'Ύψος φτερού', axis: 'Z', defaultValue: 13 },
  ],
  validate: ({ P, Wc, D, Dw, Hs, Hu, Hw }) => {
    const out: Issue[] = [];
    if (Hw > Hs + Hu)
      out.push(issue(['Hw', 'Hs', 'Hu'], `Το φτερό (${f(Hw)}) κρέμεται από την κορυφή της κολόνας και δεν μπορεί να είναι ψηλότερο από αυτήν (${f(Hs + Hu)}).`));
    if (Wc >= P)
      out.push(issue(['Wc', 'P'], `Το πλάτος της κολόνας (${f(Wc)}) πρέπει να είναι μικρότερο από το πίσω μήκος (${f(P)}), ώστε να μένει φτερό.`));
    if (Dw >= D)
      out.push(issue(['Dw', 'D'], `Το βάθος του φτερού (${f(Dw)}) πρέπει να είναι μικρότερο από το βάθος (${f(D)}).`));
    return out;
  },
  build: ({ P, Wc, Ls, D, Dw, Hs, Hu, Hw }) => {
    const x1 = P - Wc; // φτερό 0..x1, κολόνα x1..P, σκαλοπάτι P..P+Ls
    const Hc = Hs + Hu;
    const L = P + Ls;
    const Ht = Hc;
    const zw = Hc - Hw; // το φτερό ξεκινά από την κορυφή και αφήνει κενό zw από κάτω
    const g = boxUnion([
      { min: [0, D - Dw, zw], max: [x1, D, Hc] },
      { min: [x1, 0, 0], max: [P, D, Hc] },
      { min: [P, 0, 0], max: [L, D, Hs] },
    ]);
    return part(g, {
      dims: [
        linear('L', L, [0, D, 0], [L, D, 0], [NZ, PY], true),
        linear('W', D, [L, 0, 0], [L, D, 0], [NZ, PX], true),
        linear('Ht', Ht, [x1, 0, 0], [x1, 0, Ht], [NX, NY], true),
        linear('P', P, [0, D, Ht], [P, D, Ht], [PZ, PY]),
        linear('Wc', Wc, [x1, 0, Hc], [P, 0, Hc], [PZ, NY]),
        linear('Ls', Ls, [P, 0, 0], [L, 0, 0], [NZ, NY]),
        linear('Hs', Hs, [L, 0, 0], [L, 0, Hs], [PX, NY]),
        linear('Hu', Hu, [P, D, Hs], [P, D, Hc], [PX, PY]),
        linear('Hw', Hw, [0, D - Dw, zw], [0, D - Dw, Hc], [NX, NY]),
        linear('Dw', Dw, [0, D - Dw, Hc], [0, D, Hc], [PZ, NX]),
      ],
      circles: [],
      info: [
        { label: 'Μήκος φτερού', value: x1, unit: 'mm' },
        { label: 'Ύψος κολόνας', value: Hc, unit: 'mm' },
        { label: 'Κενό κάτω από το φτερό', value: zw, unit: 'mm' },
        { label: 'Συνολικό μήκος', value: L, unit: 'mm' },
      ],
    });
  },
};

// Προεπιλεγμένη σειρά (ο χρήστης μπορεί να την αλλάξει με σύρσιμο).
export const TEMPLATES: TemplateDef[] = [notchedCube, steppedBlock, bearingBlock];

export const templateById = (id: string): TemplateDef =>
  TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
