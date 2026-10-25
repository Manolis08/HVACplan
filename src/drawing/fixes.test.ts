import { describe, expect, it } from 'vitest';
import type { Scale } from '../lib/scale';
import { defaultInputs, defaultToggles, evaluate } from '../model/evaluate';
import { templateById } from '../model/templates';
import type { Vec3 } from '../model/types';
import { layoutDims } from '../viewer/dimLayout';
import { faceColorKey } from '../viewer/Viewer';
import { bboxCorners, viewBasis, viewById } from '../viewer/views';
import { computeSheetViews, sheetSvg } from './sheet';

const partOf = (id: string) => {
  const t = templateById(id);
  return evaluate(t, defaultInputs(t), defaultToggles(t)).part!;
};

describe('Bug 1: ετικέτες στο 3D χωρίς επικαλύψεις (ισομετρική)', () => {
  for (const [id, scale] of [
    ['notched-cube', { kind: 'enlarge', n: 3 }],
    ['bearing-block', { kind: 'enlarge', n: 3 }],
    ['stepped-block', { kind: 'reduce', n: 1 }],
  ] as [string, Scale][]) {
    it(id, () => {
      const p = partOf(id);
      const b = viewBasis(viewById('iso').dir);
      const pxPerMm = 300 / Math.hypot(...[0, 1, 2].map((a) => p.bbox.max[a] - p.bbox.min[a]));
      const project = (q: Vec3): [number, number] => [
        400 + pxPerMm * (q[0] * b.right.x + q[1] * b.right.y + q[2] * b.right.z),
        300 - pxPerMm * (q[0] * b.up.x + q[1] * b.up.y + q[2] * b.up.z),
      ];
      const svg = layoutDims({ dims: p.dims, project, viewDir: [b.dir.x, b.dir.y, b.dir.z], corners: bboxCorners(p.bbox), scale, mode: 'all' });
      const boxes = [...svg.matchAll(/<text[^>]* x="([\d.-]+)" y="([\d.-]+)" text-anchor="(\w+)" dominant-baseline="(\w+)"[^>]*>([^<]+)</g)].map((m) => {
        const [x, y] = [Number(m[1]), Number(m[2])];
        const w = m[5].length * 13 * 0.62 + 13 * 0.3;
        const h = 13 * 1.15;
        const x0 = m[3] === 'start' ? x : m[3] === 'end' ? x - w : x - w / 2;
        const y0 = m[4] === 'hanging' ? y : m[4] === 'auto' ? y - h : y - h / 2;
        return { x0, y0, x1: x0 + w, y1: y0 + h, t: m[5] };
      });
      expect(boxes.length).toBeGreaterThan(3);
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const [a, c] = [boxes[i], boxes[j]];
          const overlap = a.x0 < c.x1 && a.x1 > c.x0 && a.y0 < c.y1 && a.y1 > c.y0;
          expect(overlap, `${a.t} / ${c.t}`).toBe(false);
        }
    });
  }
});

describe('Bug 2 + 6: το φύλλο (A3 οριζόντιο) χωρά πάντα, έξω από το υπόμνημα, και στις δύο διατάξεις', () => {
  const fields = { title: 'Δοκιμή', author: '', section: '', classroom: '', drawingNo: '', school: '', date: '' };
  for (const layout of ['quadrants', 'standard'] as const)
    for (const id of ['notched-cube', 'bearing-block', 'stepped-block'])
      for (const scale of [
        { kind: 'enlarge', n: 3 },
        { kind: 'reduce', n: 1 },
        { kind: 'reduce', n: 50 },
      ] as Scale[])
        it(`${layout}: ${id} σε ${scale.kind === 'enlarge' ? `${scale.n}:1` : `1:${scale.n}`}`, () => {
          const p = partOf(id);
          const { svg, usedScale, warnings } = sheetSvg(computeSheetViews(p, 'first'), p, {
            projection: 'first',
            projectionLines: false,
            layout,
            scale,
            fields,
          });
          const body = svg.slice(svg.indexOf('stroke-dasharray="8'), svg.indexOf('</g>\n', svg.indexOf('class="sheet-dims"')));
          const pts = [...body.matchAll(/(?:[ML]|d=")(-?[\d.]+)[ ,](-?[\d.]+)|x="(-?[\d.]+)" y="(-?[\d.]+)"/g)].map((m) =>
            m[1] !== undefined ? [Number(m[1]), Number(m[2])] : [Number(m[3]), Number(m[4])],
          );
          expect(pts.length).toBeGreaterThan(10);
          for (const [x, y] of pts) {
            expect(x).toBeGreaterThan(10);
            expect(x).toBeLessThan(410);
            expect(y).toBeGreaterThan(10);
            expect(y).toBeLessThan(287);
            // υπόμνημα: κάτω δεξιά γωνία (250, 237), 160 × 50
            expect(x > 250 && y > 237, `σημείο ${x},${y} μέσα στο υπόμνημα`).toBe(false);
            // 2×2: κάθε όψη μένει στο τεταρτημόριό της (τίποτα πάνω στις γραμμές διαχωρισμού)
            if (layout === 'quadrants') expect(Math.abs(x - 210) < 1 || Math.abs(y - 148.5) < 1, `σημείο ${x},${y} στις γραμμές`).toBe(false);
          }
          if (usedScale !== scale) expect(warnings[0]).toMatch(/σμικρύνθηκε/);
        });

  it('γραμμές διαχωρισμού (όχι σταυρός) στο x = 210 και y = 148,5, και υπόμνημα 160 × 50 κολλητά κάτω δεξιά', () => {
    const p = partOf('notched-cube');
    const opts = { projection: 'first' as const, projectionLines: false, scale: { kind: 'reduce', n: 1 } as Scale, fields };
    const svg = sheetSvg(computeSheetViews(p, 'first'), p, opts).svg;
    expect(svg).toContain('viewBox="0 0 420 297"');
    expect(svg).toContain('x1="210.00" y1="0" x2="210.00" y2="297"');
    expect(svg).toContain('x1="0" y1="148.50" x2="420" y2="148.50"');
    // η κάτω δεξιά γωνία του υπομνήματος = η γωνία του πλαισίου (410, 287)
    expect(svg).toContain('<rect x="250.00" y="237.00" width="160" height="50"/>');
    // γραμμές κελιών όπως στο πρότυπο: 50 | 60 | 50 πάνω, 50 | 75 | 35 κάτω
    for (const l of [
      'x1="300.00" y1="237.00" x2="300.00" y2="287.00"',
      'x1="360.00" y1="237.00" x2="360.00" y2="267.00"',
      'x1="375.00" y1="267.00" x2="375.00" y2="287.00"',
      'x1="250.00" y1="267.00" x2="410.00" y2="267.00"',
      'x1="250.00" y1="277.00" x2="300.00" y2="277.00"',
    ])
      expect(svg).toContain(l);
    // το σύμβολο γωνίας προβολής μέσα στο υπόμνημα (στήλη ΑΡ. ΣΧΕΔΙΟΥ)
    const sym = svg.match(/<path d="M([\d.]+) ([\d.]+)L[^"]*Z"\/><circle/)!;
    expect(Number(sym[1])).toBeGreaterThan(330);
    expect(Number(sym[2])).toBeGreaterThan(237);
    for (const t of ['ΟΝΟΜΑ', 'ΤΜΗΜΑ', 'ΤΑΞΗ', 'ΗΜ/ΝΙΑ', 'ΚΛΙΜΑΚΑ', 'ΘΕΜΑ', 'ΑΡ. ΣΧΕΔΙΟΥ', 'ΣΧΟΛΗ']) expect(svg).toContain(`>${t}<`);
    expect(sheetSvg(computeSheetViews(p, 'first'), p, { ...opts, layout: 'standard' }).svg).not.toContain('#cccccc');
  });

  it('το υπόμνημα μένει ίδιο (160 × 50) σε κάθε κλίμακα· μόνο η τιμή της κλίμακας αλλάζει', () => {
    const p = partOf('notched-cube');
    const tb = (scale: Scale) => {
      const svg = sheetSvg(computeSheetViews(p, 'first'), p, { projection: 'first', projectionLines: false, scale, fields }).svg;
      return svg.slice(svg.indexOf('<rect x="250.00"')).replace(/>[\d:]+<\/text>/g, '');
    };
    expect(tb({ kind: 'reduce', n: 1 })).toBe(tb({ kind: 'reduce', n: 2 }));
  });
});

describe('Χρώματα όψεων', () => {
  it('κάτοψη πράσινο, πρόσοψη κόκκινο, πλάγια (αριστερά) μπλε, υπόλοιπα κίτρινο', () => {
    expect(faceColorKey(0, 0, 1)).toBe('top');
    expect(faceColorKey(0, -1, 0)).toBe('front');
    expect(faceColorKey(-1, 0, 0)).toBe('side');
    expect(faceColorKey(1, 0, 0)).toBe('other');
    expect(faceColorKey(0, 1, 0)).toBe('other');
    expect(faceColorKey(0, 0, -1)).toBe('other');
  });
});
