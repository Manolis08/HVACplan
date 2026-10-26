// Φύλλο όψεων A3 (οριζόντιο) σε SVG: πρόσοψη, κάτοψη και πλάγια όψη, στοιχισμένες
// σύμφωνα με τη γωνία προβολής. Μονάδες SVG = mm χαρτιού.
import { applyScale, ONE_TO_ONE, SCALE_PRESETS, scaleLabel, type Scale } from '../lib/scale';
import type { DimSpec, Part, Vec3 } from '../model/types';
import type { ProjectionAngle } from '../ui/ProjectionSymbol';
import { essentialDims, layoutDims, PAPER_STYLE } from '../viewer/dimLayout';
import { bboxCorners, viewBasis, viewById, type ViewId } from '../viewer/views';
import type { ViewFrame } from './hlr';
import { edgeTopology, projectView, silhouettes, type EdgeTopology, type Segment2 } from './hlr';

export interface SheetView {
  role: 'front' | 'top' | 'side';
  viewId: ViewId;
  frame: ViewFrame;
  segments: Segment2[];
  minU: number;
  maxU: number;
  minV: number;
  maxV: number;
}

/** Στην 1η γωνία δεξιά από την πρόσοψη μπαίνει η όψη από αριστερά· στην 3η η όψη από δεξιά. */
export const sideViewFor = (p: ProjectionAngle): ViewId => (p === 'first' ? 'left' : 'right');

export function computeSheetViews(part: Part, projection: ProjectionAngle, topo: EdgeTopology = edgeTopology(part.triangles)): SheetView[] {
  const { min, max } = part.bbox;
  const diag = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  const roles: [SheetView['role'], ViewId][] = [
    ['front', 'front'],
    ['top', 'top'],
    ['side', sideViewFor(projection)],
  ];
  return roles.map(([role, viewId]) => {
    const b = viewBasis(viewById(viewId).dir);
    const v = (x: { x: number; y: number; z: number }): Vec3 => [x.x, x.y, x.z];
    const frame = { dir: v(b.dir), right: v(b.right), up: v(b.up) };
    const lines = new Float32Array([...part.edges, ...silhouettes(topo, frame.dir)]);
    const segments = projectView(part.triangles, lines, frame, diag);
    const us = bboxCorners(part.bbox).map((c) => c[0] * frame.right[0] + c[1] * frame.right[1] + c[2] * frame.right[2]);
    const vs = bboxCorners(part.bbox).map((c) => c[0] * frame.up[0] + c[1] * frame.up[1] + c[2] * frame.up[2]);
    return { role, viewId, frame, segments, minU: Math.min(...us), maxU: Math.max(...us), minV: Math.min(...vs), maxV: Math.max(...vs) };
  });
}

/** Χαρτί A3 οριζόντιο (mm). */
export const PAGE_W = 420;
export const PAGE_H = 297;
const FRAME = 10;
/** Κενό ανάμεσα στις όψεις και περιθώριο γύρω τους (mm χαρτιού), για τις διαστάσεις. */
const VIEW_GAP = 34;
const MARGIN = 26;
/** Υπόμνημα: 160 × 50 mm (σειρές 5 × 10), πάντα σε φυσικό μέγεθος. */
export const TB_W = 160;
export const TB_H = 50;
/** Θέση υπομνήματος: κολλητά στην κάτω δεξιά γωνία του πλαισίου. */
export const TB_X = PAGE_W - FRAME - TB_W;
export const TB_Y = PAGE_H - FRAME - TB_H;
/** Διάταξη 2×2: τεταρτημόρια 200 × 128,5 mm και γραμμές διαχωρισμού στο x = 210 και y = 148,5. */
const QUAD_W = 200;
const QUAD_H = 128.5;
const QUAD_MARGIN = 22; // χώρος για διαστάσεις γύρω από κάθε όψη μέσα στο τεταρτημόριό της
/** Πάχος πλαισίου και σταυρού 2×2 (mm). */
const FRAME_WIDTH = 0.7;

const f2 = (x: number) => x.toFixed(2);

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Υπόμνημα 160 × 50 (σειρές 10 mm):
 *   x 0–50 | 50–110 | 110–160      σειρές 1–3: ΟΝΟΜΑ / ΤΜΗΜΑ / ΤΑΞΗ (λεζάντα | τιμή) και ΣΧΟΛΗ (ενιαίο κελί)
 *   x 0–50 | 50–125 | 125–160      σειρές 4–5: ΗΜ/ΝΙΑ, ΚΛΙΜΑΚΑ (λεζάντα και τιμή) | ΘΕΜΑ | ΑΡ. ΣΧΕΔΙΟΥ
 */
function titleBlock(o: SheetOptions, x: number, y: number): string {
  const line = (x1: number, y1: number, x2: number, y2: number) =>
    `<line x1="${f2(x + x1)}" y1="${f2(y + y1)}" x2="${f2(x + x2)}" y2="${f2(y + y2)}"/>`;
  const text = (tx: number, ty: number, t: string, size: number, weight = 'normal', anchor = 'start') =>
    `<text x="${f2(x + tx)}" y="${f2(y + ty)}" font-size="${size}" font-weight="${weight}" font-family="sans-serif" text-anchor="${anchor}" dominant-baseline="middle" fill="#000">${esc(t)}</text>`;
  const f = o.fields;
  const LABEL = 3;
  const VALUE = 3.2;
  return [
    `<g stroke="#000" stroke-width="0.5" fill="none"><rect x="${f2(x)}" y="${f2(y)}" width="${TB_W}" height="${TB_H}"/>`,
    line(50, 0, 50, 50),
    line(110, 0, 110, 30),
    line(125, 30, 125, 50),
    line(0, 10, 110, 10),
    line(0, 20, 110, 20),
    line(0, 30, 160, 30),
    line(0, 40, 50, 40),
    '</g>',
    // σειρές 1–3: λεζάντα αριστερά, τιμή στο κελί των 60 mm
    ...([
      ['ΟΝΟΜΑ', f.author],
      ['ΤΜΗΜΑ', f.section],
      ['ΤΑΞΗ', f.classroom],
    ] as [string, string][]).map(([cap, val], i) => text(2, i * 10 + 5, cap, LABEL) + text(52, i * 10 + 5, val, VALUE)),
    // σειρές 4–5: λεζάντα και τιμή μέσα στο ίδιο κελί των 50 mm
    text(2, 35, 'ΗΜ/ΝΙΑ', LABEL) + text(48, 35, f.date, VALUE, 'normal', 'end'),
    text(2, 45, 'ΚΛΙΜΑΚΑ', LABEL) + text(48, 45, scaleLabel(o.scale), 3.6, 'bold', 'end'),
    // ΣΧΟΛΗ (110–160 × 0–30)
    text(112, 4, 'ΣΧΟΛΗ', 2.2),
    text(135, 16, f.school, VALUE, 'normal', 'middle'),
    // ΘΕΜΑ (50–125 × 30–50)
    text(52, 33.5, 'ΘΕΜΑ', 2.2),
    text(87.5, 42, f.title, 4.2, 'bold', 'middle'),
    // ΑΡ. ΣΧΕΔΙΟΥ (125–160 × 30–50)
    text(127, 33.5, 'ΑΡ. ΣΧΕΔΙΟΥ', 2.2),
    text(142.5, 42, f.drawingNo, 4.6, 'bold', 'middle'),
  ].join('');
}

export interface TitleFields {
  /** ΘΕΜΑ */
  title: string;
  /** ΟΝΟΜΑ */
  author: string;
  /** ΤΜΗΜΑ */
  section: string;
  /** ΤΑΞΗ */
  classroom: string;
  /** ΗΜ/ΝΙΑ */
  date: string;
  /** ΑΡ. ΣΧΕΔΙΟΥ */
  drawingNo: string;
  /** ΣΧΟΛΗ */
  school: string;
}

/** Άξονες (τελεία-παύλα) των οπών: σταυρός όπου η οπή φαίνεται κύκλος, γραμμή άξονα όπου φαίνεται από το πλάι. */
const CENTER_EXT = 3; // προέκταση πέρα από το περίγραμμα, mm χαρτιού
export const CENTERLINE_DASH = '8 1.5 1 1.5';

function centerLines(part: Part, v: SheetView, toPaper: (p: Vec3) => [number, number], k: number): string {
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  let d = '';
  for (const c of part.circles) {
    const along = Math.abs(dot(c.axis, v.frame.dir));
    const C = toPaper(c.center);
    if (along > 0.99) {
      const e = c.radius * k + CENTER_EXT;
      d += `M${f2(C[0] - e)} ${f2(C[1])}H${f2(C[0] + e)}M${f2(C[0])} ${f2(C[1] - e)}V${f2(C[1] + e)}`;
    } else if (along < 0.01) {
      const E = toPaper([c.center[0] + c.axis[0] * c.length, c.center[1] + c.axis[1] * c.length, c.center[2] + c.axis[2] * c.length]);
      const len = Math.hypot(E[0] - C[0], E[1] - C[1]);
      if (len < 1e-6) continue;
      const u = [(E[0] - C[0]) / len, (E[1] - C[1]) / len];
      d += `M${f2(C[0] - u[0] * CENTER_EXT)} ${f2(C[1] - u[1] * CENTER_EXT)}L${f2(E[0] + u[0] * CENTER_EXT)} ${f2(E[1] + u[1] * CENTER_EXT)}`;
    }
  }
  return d;
}

export interface SheetOptions {
  projection: ProjectionAngle;
  projectionLines: boolean;
  /** Διαστάσεις στο φύλλο (προεπιλογή: ναι). */
  showDims?: boolean;
  /**
   * quadrants (προεπιλογή): 2×2 με γραμμές διαχωρισμού, μία όψη ανά τεταρτημόριο, υπόμνημα κάτω δεξιά.
   * standard: οι όψεις μαζί στο κέντρο της περιοχής πάνω από το υπόμνημα.
   */
  layout?: 'quadrants' | 'standard';
  /** Κλίμακα σχεδίου: αλλάζει το μέγεθος των όψεων στο χαρτί, ΠΟΤΕ τους αριθμούς (ISO 129). */
  scale: Scale;
  fields: TitleFields;
}

export interface SheetResult {
  svg: string;
  warnings: string[];
  /** Κλίμακα με την οποία σχεδιάστηκε τελικά το φύλλο (μικρότερη από την επιλεγμένη αν δεν χωρούσε). */
  usedScale: Scale;
}

/**
 * Κάθε διάσταση μπαίνει ΜΙΑ φορά, στην πρώτη όψη όπου φαίνεται σε αληθινό μήκος: γραμμικές
 * παράλληλες με το επίπεδο της όψης, Ø/R όπου ο κύκλος φαίνεται κύκλος. Σειρά: πρόσοψη → κάτοψη →
 * πλάγια· οι συνολικές διαστάσεις ύψους (Z) και βάθους (Y) πάνε πρώτα στην πλάγια όψη, ώστε να
 * μοιράζονται τα μέτρα και η πλάγια να μη μένει άδεια.
 */
export function assignDims(dims: DimSpec[], views: SheetView[]): Map<SheetView, DimSpec[]> {
  const out = new Map<SheetView, DimSpec[]>(views.map((v) => [v, []]));
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const sideFirst = (d: DimSpec) =>
    d.kind === 'linear' && d.overall && Math.abs(d.b[0] - d.a[0]) < 1e-9; // συνολική Y ή Z
  for (const d of dims) {
    const order = sideFirst(d) ? [...views].sort((a, b) => Number(b.role === 'side') - Number(a.role === 'side')) : views;
    const view = order.find((v) => {
      const dir = v.frame.dir;
      if (d.kind === 'linear') {
        const ax: Vec3 = [d.b[0] - d.a[0], d.b[1] - d.a[1], d.b[2] - d.a[2]];
        const l = Math.hypot(...ax);
        if (l < 1e-9 || Math.abs(dot(ax, dir) / l) > 0.01) return false;
        return d.offsets.some((o) => Math.abs(dot(o, dir)) < 0.9);
      }
      return Math.abs(dot(d.axis, dir)) > 0.99;
    });
    if (view) out.get(view)!.push(d);
  }
  return out;
}

/** Ολόκληρο το SVG του φύλλου (A3 κάθετο), σε πραγματική κλίμακα. Κρυφές γραμμές: stroke-dasharray. */
type Box = { x: number; y: number };
interface Layout {
  fits: (k: number) => boolean;
  place: (k: number) => { frontBox: Box; topBox: Box; sideBox: Box; tb: Box };
}

/** Πλάτος/ύψος των όψεων σε mm αντικειμένου: πρόσοψη (wf × hf), ύψος κάτοψης ht, πλάτος πλάγιας ws. */
interface Extents {
  wf: number;
  hf: number;
  ht: number;
  ws: number;
}

/** Όλες οι κλίμακες που δοκιμάζονται, από τη μεγαλύτερη στη μικρότερη. */
const ALL_SCALES: Scale[] = [...SCALE_PRESETS, ...[200, 250, 500, 1000, 2000, 5000].map((n): Scale => ({ kind: 'reduce', n }))];

function makeLayout({ wf, hf, ht, ws }: Extents, projection: ProjectionAngle, mode: SheetOptions['layout']): Layout {
  const first = projection === 'first';

  // Standard: όλες οι όψεις μαζί, κεντραρισμένες στην περιοχή πάνω από το υπόμνημα.
  const standard: Layout = (() => {
    const ax0 = FRAME + MARGIN;
    const ay0 = FRAME + MARGIN;
    const aw = PAGE_W - 2 * (FRAME + MARGIN);
    const ah = TB_Y - MARGIN * 0.6 - ay0;
    return {
      fits: (k) => k * (wf + ws) + VIEW_GAP <= aw + 1e-6 && k * (hf + ht) + VIEW_GAP <= ah + 1e-6,
      place: (k) => {
        const X0 = ax0 + (aw - (k * (wf + ws) + VIEW_GAP)) / 2;
        const Y0 = ay0 + (ah - (k * (hf + ht) + VIEW_GAP)) / 2;
        const frontBox = { x: X0, y: first ? Y0 : Y0 + k * ht + VIEW_GAP };
        return {
          frontBox,
          topBox: { x: X0, y: first ? Y0 + k * hf + VIEW_GAP : Y0 },
          sideBox: { x: X0 + k * wf + VIEW_GAP, y: frontBox.y },
          tb: { x: TB_X, y: TB_Y },
        };
      },
    };
  })();

  // 2×2: τεταρτημόρια 200 × 128,5 στα (10,10), (220,10), (10,158,5), (220,158,5).
  // 1η γωνία: πρόσοψη πάνω αριστερά, πλάγια πάνω δεξιά, κάτοψη κάτω αριστερά, υπόμνημα κάτω δεξιά.
  // 3η γωνία (κάτοψη πάνω από την πρόσοψη): κάτοψη πάνω αριστερά, πρόσοψη κάτω αριστερά, πλάγια κάτω
  // δεξιά, υπόμνημα πάνω δεξιά. Η στοίχιση διατηρείται: πρόσοψη–κάτοψη στήλη, πρόσοψη–πλάγια σειρά.
  const quadrants: Layout = (() => {
    const colL = FRAME + QUAD_W / 2;
    const colR = PAGE_W / 2 + FRAME + QUAD_W / 2;
    const rowT = FRAME + QUAD_H / 2;
    const rowB = PAGE_H / 2 + FRAME + QUAD_H / 2;
    const room = (n: number, q: number) => n <= q - 2 * QUAD_MARGIN + 1e-6;
    return {
      fits: (k) => room(k * wf, QUAD_W) && room(k * ws, QUAD_W) && room(k * hf, QUAD_H) && room(k * ht, QUAD_H),
      place: (k) => {
        const frontRow = first ? rowT : rowB;
        const topRow = first ? rowB : rowT;
        return {
          frontBox: { x: colL - (k * wf) / 2, y: frontRow - (k * hf) / 2 },
          topBox: { x: colL - (k * wf) / 2, y: topRow - (k * ht) / 2 },
          sideBox: { x: colR - (k * ws) / 2, y: frontRow - (k * hf) / 2 },
          tb: { x: TB_X, y: first ? TB_Y : FRAME }, // κολλητά στην κάτω (3η γωνία: πάνω) δεξιά γωνία
        };
      },
    };
  })();
  return mode === 'standard' ? standard : quadrants;
}

/**
 * Προτεινόμενη κλίμακα: η μεγαλύτερη τυποποιημένη με την οποία οι τρεις όψεις χωράνε στο A3
 * (με τη διάταξη που έχει επιλεγεί). Χρειάζεται μόνο το κουτί του κομματιού, όχι τις γραμμές.
 */
export function suggestedScale(part: Part, projection: ProjectionAngle, mode: SheetOptions['layout']): Scale {
  const corners = bboxCorners(part.bbox);
  const span = (viewId: ViewId, axis: 'right' | 'up') => {
    const a = viewBasis(viewById(viewId).dir)[axis];
    const vals = corners.map((c) => c[0] * a.x + c[1] * a.y + c[2] * a.z);
    return Math.max(...vals) - Math.min(...vals);
  };
  const side = sideViewFor(projection);
  const layout = makeLayout({ wf: span('front', 'right'), hf: span('front', 'up'), ht: span('top', 'up'), ws: span(side, 'right') }, projection, mode);
  return ALL_SCALES.find((sc) => layout.fits(applyScale(1, sc))) ?? ALL_SCALES[ALL_SCALES.length - 1];
}

export function sheetSvg(views: SheetView[], part: Part, o: SheetOptions): SheetResult {
  const [front, top, side] = ['front', 'top', 'side'].map((r) => views.find((v) => v.role === r)!);
  const wf = front.maxU - front.minU;
  const hf = front.maxV - front.minV;
  const ht = top.maxV - top.minV;
  const first = o.projection === 'first';
  const quad = o.layout !== 'standard';
  const layout = makeLayout({ wf, hf, ht, ws: side.maxU - side.minU }, o.projection, o.layout);

  // Αν η επιλεγμένη κλίμακα δεν χωρά στο A3, σμικρύνουμε αυτόματα στη μεγαλύτερη τυποποιημένη που χωρά.
  const fits = (sc: Scale) => layout.fits(applyScale(1, sc));
  const warnings: string[] = [];
  let used = o.scale;
  if (!fits(o.scale)) {
    const kRequested = applyScale(1, o.scale);
    const smaller = ALL_SCALES.filter((p) => applyScale(1, p) < kRequested);
    used = smaller.find(fits) ?? smaller[smaller.length - 1] ?? o.scale;
    warnings.push(
      `Σε κλίμακα ${scaleLabel(o.scale)} οι όψεις δεν χωράνε στο A3· σμικρύνθηκε σε ${scaleLabel(used)} για να χωρά.`,
    );
  }
  const k = applyScale(1, used); // mm χαρτιού ανά mm αντικειμένου
  const { frontBox, topBox, sideBox, tb } = layout.place(k);
  const boxes = new Map([
    [front, frontBox],
    [top, topBox],
    [side, sideBox],
  ]);

  let visible = '';
  let hidden = '';
  let centers = '';
  let dims = '';
  // Στο φύλλο μόνο οι απαραίτητες διαστάσεις: όσες βγαίνουν με πρόσθεση/αφαίρεση άλλων παραλείπονται.
  const assigned = assignDims(essentialDims(part.dims), views);
  const corners = bboxCorners(part.bbox);
  const paperSegs = new Map<SheetView, number[][]>();
  for (const [v, box] of boxes) {
    const toPaper = (p: [number, number]): [number, number] => [box.x + k * (p[0] - v.minU), box.y + k * (v.maxV - p[1])];
    paperSegs.set(
      v,
      v.segments.filter((sg) => !sg.hidden).map((sg) => [...toPaper(sg.a), ...toPaper(sg.b)]),
    );
    const P = (p: [number, number]) => {
      const q = toPaper(p);
      return `${f2(q[0])} ${f2(q[1])}`;
    };
    for (const s of v.segments) {
      const d = `M${P(s.a)}L${P(s.b)}`;
      if (s.hidden) hidden += d;
      else visible += d;
    }
    const f = v.frame;
    const project = (p: Vec3) =>
      toPaper([p[0] * f.right[0] + p[1] * f.right[1] + p[2] * f.right[2], p[0] * f.up[0] + p[1] * f.up[1] + p[2] * f.up[2]]);
    centers += centerLines(part, v, project, k);
    if (o.showDims === false) continue;
    dims += layoutDims({
      dims: assigned.get(v)!,
      project,
      viewDir: f.dir,
      corners,
      scale: ONE_TO_ONE, // ISO 129: στο φύλλο τα μέτρα είναι ΠΑΝΤΑ τα πραγματικά
      mode: 'all',
      style: PAPER_STYLE,
    });
  }

  let projLines = '';
  if (o.projectionLines) {
    const fx0 = frontBox.x;
    const fx1 = frontBox.x + k * wf;
    const fy0 = frontBox.y;
    const fy1 = frontBox.y + k * hf;
    const [ty0, ty1] = [topBox.y, topBox.y + k * ht];
    const [vy0, vy1] = first ? [fy1, ty0] : [ty1, fy0];
    const sx0 = sideBox.x;
    // Κάθε γραμμή προβολής ξεκινά από το πραγματικό σημείο του σχεδίου στη μία όψη και φτάνει ως το
    // σχέδιο της άλλης (όχι από το νοητό κουτί γύρω του): π.χ. η πάνω γραμμή του εξαρτήματος
    // ακουμπά την κορυφή του στρογγυλού μέρους. Αν δεν βρεθεί σημείο, μένει η θέση του κουτιού.
    // ανοχή 0,3 mm χαρτιού: τα τόξα είναι πολύγωνα και η κορυφή τους πέφτει λίγο μέσα από το κουτί
    const eps = 0.3;
    /** Τα x όπου οι ορατές γραμμές μιας όψης συναντούν την οριζόντια y (και τα y για κάθετη x). */
    const hits = (v: SheetView, at: number, horizontal: boolean): number[] => {
      const out: number[] = [];
      for (const [ax, ay, bx, by] of paperSegs.get(v) ?? []) {
        const [a1, a2, b1, b2] = horizontal ? [ay, ax, by, bx] : [ax, ay, bx, by];
        if (at < Math.min(a1, b1) - eps || at > Math.max(a1, b1) + eps) continue;
        if (Math.abs(b1 - a1) < eps) out.push(a2, b2);
        else out.push(a2 + ((at - a1) / (b1 - a1)) * (b2 - a2));
      }
      return out;
    };
    const ext = (vals: number[], pick: 'min' | 'max', fallback: number) =>
      vals.length ? (pick === 'min' ? Math.min(...vals) : Math.max(...vals)) : fallback;
    const upper = first ? front : top;
    const lower = first ? top : front;
    const vLine = (x: number) =>
      `M${f2(x)} ${f2(ext(hits(upper, x, false), 'max', vy0))}V${f2(ext(hits(lower, x, false), 'min', vy1))}`;
    const hLine = (y: number) =>
      `M${f2(ext(hits(front, y, true), 'max', fx1))} ${f2(y)}H${f2(ext(hits(side, y, true), 'min', sx0))}`;
    projLines =
      `<path d="${vLine(fx0)}${vLine(fx1)}${hLine(fy0)}${hLine(fy1)}" stroke="#9aa5b1" stroke-width="0.13" fill="none"/>`;
  }

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_W}mm" height="${PAGE_H}mm" viewBox="0 0 ${PAGE_W} ${PAGE_H}">`,
    `<rect width="${PAGE_W}" height="${PAGE_H}" fill="#fff"/>`,
    `<rect x="${FRAME}" y="${FRAME}" width="${PAGE_W - 2 * FRAME}" height="${PAGE_H - 2 * FRAME}" fill="none" stroke="#000" stroke-width="${FRAME_WIDTH}"/>`,
    // Σταυρός 2×2: ίδιο μαύρο και πάχος με το πλαίσιο, από πλευρά σε πλευρά του πλαισίου.
    quad
      ? `<g class="sheet-divider" stroke="#000" stroke-width="${FRAME_WIDTH}">` +
        `<line x1="${f2(PAGE_W / 2)}" y1="${FRAME}" x2="${f2(PAGE_W / 2)}" y2="${PAGE_H - FRAME}"/>` +
        `<line x1="${FRAME}" y1="${f2(PAGE_H / 2)}" x2="${PAGE_W - FRAME}" y2="${f2(PAGE_H / 2)}"/></g>`
      : '',
    projLines,
    `<path d="${centers}" fill="none" stroke="#000" stroke-width="0.25" stroke-dasharray="${CENTERLINE_DASH}"/>`,
    `<path d="${hidden}" fill="none" stroke="#000" stroke-width="0.3" stroke-dasharray="2.5 1.25" stroke-linecap="butt"/>`,
    `<path d="${visible}" fill="none" stroke="#000" stroke-width="0.5" stroke-linecap="round"/>`,
    `<g class="sheet-dims">${dims}</g>`,
    titleBlock({ ...o, scale: used }, tb.x, tb.y),
    '</svg>',
  ].join('\n');
  return { svg, warnings, usedScale: used };
}
