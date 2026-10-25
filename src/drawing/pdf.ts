// Μετατροπή του φύλλου όψεων (το δικό μας SVG) σε διανυσματικό PDF (μέγεθος σελίδας από το SVG).
//
// Υποστηρίζεται μόνο το υποσύνολο SVG που παράγει το sheet.ts: rect, line, circle, path (M/L/H/V/Z),
// text, g με κληρονομούμενες ιδιότητες. Το κείμενο γίνεται καμπύλες από τη γραμματοσειρά Noto Sans,
// ώστε τα ελληνικά να βγαίνουν σωστά σε κάθε πρόγραμμα ανάγνωσης χωρίς ενσωμάτωση γραμματοσειράς.
// Οι διακεκομμένες και οι τελεία-παύλα γραμμές γράφονται ως PDF dash pattern (μένουν διακεκομμένες).

/** Ό,τι χρειαζόμαστε από μια γραμματοσειρά opentype.js. */
export interface GlyphFont {
  unitsPerEm: number;
  charToGlyph(ch: string): {
    index: number;
    advanceWidth?: number;
    getPath(x: number, y: number, size: number): { commands: PathCommand[] };
  };
}

type PathCommand =
  | { type: 'M' | 'L'; x: number; y: number }
  | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: 'Q'; x1: number; y1: number; x: number; y: number }
  | { type: 'Z' };

type Attrs = Record<string, string>;

const PT_PER_MM = 72 / 25.4;

const num = (v: number) => {
  const s = (Math.round(v * 1000) / 1000).toFixed(3).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
};

function parseAttrs(src: string): Attrs {
  const out: Attrs = {};
  for (const m of src.matchAll(/([\w:-]+)="([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

const unescape = (t: string) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

function color(c: string | undefined): [number, number, number] | null {
  if (!c || c === 'none') return null;
  let h = c.replace('#', '');
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return [0, 0, 0];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}

/** Εντολές path του SVG (M L H V Z, απόλυτες) → τελεστές PDF. */
function pathOps(d: string): string {
  const tokens = d.match(/[MLHVZmlhvz]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  let ops = '';
  let cmd = '';
  let x = 0;
  let y = 0;
  let i = 0;
  const next = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const t = tokens[i];
    if (/[A-Za-z]/.test(t)) {
      cmd = t.toUpperCase();
      i++;
      if (cmd === 'Z') {
        ops += 'h\n';
        continue;
      }
    }
    if (cmd === 'M' || cmd === 'L') {
      x = next();
      y = next();
      ops += `${num(x)} ${num(y)} ${cmd === 'M' ? 'm' : 'l'}\n`;
      if (cmd === 'M') cmd = 'L'; // συνεχόμενα ζεύγη μετά το M είναι L
    } else if (cmd === 'H') {
      x = next();
      ops += `${num(x)} ${num(y)} l\n`;
    } else if (cmd === 'V') {
      y = next();
      ops += `${num(x)} ${num(y)} l\n`;
    } else {
      i++; // άγνωστο: προσπέρασμα
    }
  }
  return ops;
}

function circleOps(cx: number, cy: number, r: number): string {
  const k = 0.5522847498 * r;
  return (
    `${num(cx + r)} ${num(cy)} m\n` +
    `${num(cx + r)} ${num(cy + k)} ${num(cx + k)} ${num(cy + r)} ${num(cx)} ${num(cy + r)} c\n` +
    `${num(cx - k)} ${num(cy + r)} ${num(cx - r)} ${num(cy + k)} ${num(cx - r)} ${num(cy)} c\n` +
    `${num(cx - r)} ${num(cy - k)} ${num(cx - k)} ${num(cy - r)} ${num(cx)} ${num(cy - r)} c\n` +
    `${num(cx + k)} ${num(cy - r)} ${num(cx + r)} ${num(cy - k)} ${num(cx + r)} ${num(cy)} c\nh\n`
  );
}

/** Κείμενο → καμπύλες (με εναλλαγή γραμματοσειράς ανά χαρακτήρα: πρώτη που έχει τον χαρακτήρα). */
function textOps(text: string, a: Attrs, fonts: GlyphFont[]): string {
  const size = Number(a['font-size'] ?? 3.5);
  const pick = (ch: string) => {
    for (const f of fonts) {
      const g = f.charToGlyph(ch);
      if (g.index > 0) return { f, g };
    }
    return { f: fonts[0], g: fonts[0].charToGlyph(ch) };
  };
  const glyphs = [...text].map(pick);
  const width = glyphs.reduce((s, { f, g }) => s + ((g.advanceWidth ?? 0) * size) / f.unitsPerEm, 0);
  let x = Number(a.x ?? 0);
  let y = Number(a.y ?? 0);
  const anchor = a['text-anchor'];
  if (anchor === 'middle') x -= width / 2;
  else if (anchor === 'end') x -= width;
  // «middle»: περίπου στο μέσο του ύψους των κεφαλαίων, όπως στον browser
  if (a['dominant-baseline'] === 'middle' || a['dominant-baseline'] === 'central') y += size * 0.35;

  // περιστροφή rotate(γωνία cx cy) γύρω από το σημείο αγκύρωσης
  const rot = a.transform?.match(/rotate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)/);
  const [ang, rcx, rcy] = rot ? rot.slice(1).map(Number) : [0, 0, 0];
  const cos = Math.cos((ang * Math.PI) / 180);
  const sin = Math.sin((ang * Math.PI) / 180);
  const T = (px: number, py: number) =>
    ang ? `${num(rcx + (px - rcx) * cos - (py - rcy) * sin)} ${num(rcy + (px - rcx) * sin + (py - rcy) * cos)}` : `${num(px)} ${num(py)}`;

  let ops = '';
  let cx = 0;
  let cy = 0;
  for (const { f, g } of glyphs) {
    for (const c of g.getPath(x, y, size).commands) {
      if (c.type === 'M') ops += `${T(c.x, c.y)} m\n`;
      else if (c.type === 'L') ops += `${T(c.x, c.y)} l\n`;
      else if (c.type === 'C') ops += `${T(c.x1, c.y1)} ${T(c.x2, c.y2)} ${T(c.x, c.y)} c\n`;
      else if (c.type === 'Q') {
        // τετραγωνική → κυβική Bézier
        const c1x = cx + (2 / 3) * (c.x1 - cx);
        const c1y = cy + (2 / 3) * (c.y1 - cy);
        const c2x = c.x + (2 / 3) * (c.x1 - c.x);
        const c2y = c.y + (2 / 3) * (c.y1 - c.y);
        ops += `${T(c1x, c1y)} ${T(c2x, c2y)} ${T(c.x, c.y)} c\n`;
      } else ops += 'h\n';
      if (c.type !== 'Z') {
        cx = c.x;
        cy = c.y;
      }
    }
    x += ((g.advanceWidth ?? 0) * size) / f.unitsPerEm;
  }
  if (!ops) return '';
  const fill = color(a.fill ?? '#000') ?? [0, 0, 0];
  const bold = a['font-weight'] === 'bold';
  return `q ${fill.map(num).join(' ')} rg ${fill.map(num).join(' ')} RG ${bold ? `${num(size * 0.045)} w 1 j\n${ops}B` : `\n${ops}f`}\nQ\n`;
}

/** Χρώμα/πάχος/διακοπή γραμμής και γέμισμα → γύρω από τη γεωμετρία. */
function paint(geom: string, a: Attrs): string {
  const stroke = color(a.stroke);
  const fill = color(a.fill);
  if (!stroke && !fill) return '';
  let gs = 'q ';
  if (stroke) {
    gs += `${stroke.map(num).join(' ')} RG ${num(Number(a['stroke-width'] ?? 1))} w `;
    const dash = a['stroke-dasharray'];
    gs += dash && dash !== 'none' ? `[${dash.trim().split(/[\s,]+/).map(Number).map(num).join(' ')}] 0 d ` : '[] 0 d ';
    gs += a['stroke-linecap'] === 'round' ? '1 J ' : '0 J ';
    gs += a['stroke-linejoin'] === 'round' ? '1 j ' : '0 j ';
  }
  if (fill) gs += `${fill.map(num).join(' ')} rg `;
  const op = stroke && fill ? 'B' : fill ? 'f' : 'S';
  return `${gs}\n${geom}${op}\nQ\n`;
}

const INHERITED = ['stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'fill', 'font-size', 'font-weight'];

/** Περιεχόμενο σελίδας (τελεστές PDF) από το SVG του φύλλου. */
export function svgContent(svg: string, fonts: GlyphFont[]): { ops: string; width: number; height: number } {
  const vb = svg.match(/viewBox="([^"]+)"/)![1].split(/\s+/).map(Number);
  const [, , width, height] = vb;
  const stack: Attrs[] = [{}];
  let ops = '';
  let pendingText: Attrs | null = null;
  for (const m of svg.matchAll(/<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>|([^<]+)/g)) {
    const [, close, tag, rawAttrs, selfClose, textNode] = m;
    if (textNode !== undefined) {
      if (pendingText && textNode.trim()) ops += textOps(unescape(textNode), pendingText, fonts);
      continue;
    }
    if (close) {
      if (tag === 'g') stack.pop();
      if (tag === 'text') pendingText = null;
      continue;
    }
    const own = parseAttrs(rawAttrs);
    const inherited = stack[stack.length - 1];
    const a: Attrs = { ...Object.fromEntries(INHERITED.filter((k) => inherited[k]).map((k) => [k, inherited[k]])), ...own };
    switch (tag) {
      case 'g':
        if (!selfClose) stack.push(a);
        break;
      case 'rect': {
        const x = Number(a.x ?? 0);
        const y = Number(a.y ?? 0);
        ops += paint(`${num(x)} ${num(y)} ${num(Number(a.width))} ${num(Number(a.height))} re\n`, a);
        break;
      }
      case 'line':
        ops += paint(`${num(Number(a.x1))} ${num(Number(a.y1))} m\n${num(Number(a.x2))} ${num(Number(a.y2))} l\n`, a);
        break;
      case 'circle':
        ops += paint(circleOps(Number(a.cx), Number(a.cy), Number(a.r)), a);
        break;
      case 'path':
        if (a.d) ops += paint(pathOps(a.d), a);
        break;
      case 'text':
        pendingText = a;
        break;
    }
  }
  return { ops, width, height };
}

/** Πλήρες αρχείο PDF μίας σελίδας (διαστάσεις σελίδας από το viewBox, σε mm). */
export function svgToPdf(svg: string, fonts: GlyphFont[], title = 'Φύλλο όψεων'): Uint8Array {
  const { ops, width, height } = svgContent(svg, fonts);
  const W = width * PT_PER_MM;
  const H = height * PT_PER_MM;
  // Συντεταγμένες σε mm με τον άξονα y προς τα κάτω, όπως στο SVG.
  const content = `${num(PT_PER_MM)} 0 0 ${num(-PT_PER_MM)} 0 ${num(H)} cm\n${ops}`;
  const utf16 = (s: string) =>
    '<FEFF' + [...s].map((ch) => ch.codePointAt(0)!.toString(16).padStart(4, '0').toUpperCase()).join('') + '>';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(W)} ${num(H)}] /Resources << >> /Contents 4 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    `<< /Title ${utf16(title)} /Producer (Opseis 3D) >>`,
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // Όλο το περιεχόμενο είναι ASCII (αριθμοί, τελεστές, δεκαεξαδικά), άρα 1 χαρακτήρας = 1 byte.
  return new TextEncoder().encode(out);
}
