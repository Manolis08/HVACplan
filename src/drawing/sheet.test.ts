import { describe, expect, it } from 'vitest';
import type { Scale } from '../lib/scale';
import { defaultInputs, defaultToggles, evaluate } from '../model/evaluate';
import { templateById } from '../model/templates';
import { assignDims, computeSheetViews, sheetSvg, suggestedScale } from './sheet';

const cube = (() => {
  const t = templateById('notched-cube');
  return evaluate(t, defaultInputs(t), defaultToggles(t)).part!;
})();
const views = computeSheetViews(cube, 'first');

const sheet = (scale: Scale) =>
  sheetSvg(views, cube, { projection: 'first', projectionLines: true, scale, fields: { title: 'Κύβος με εγκοπή', author: '', section: '', classroom: '', drawingNo: '', school: '', date: '24/10/2026' } });

/** Ανά διάσταση: κείμενο, γωνία περιστροφής, και τα άκρα της γραμμής διάστασης. */
function dims(svg: string) {
  const out: Record<string, { text: string; angle: number; line: number[] }> = {};
  for (const m of svg.matchAll(/<g class="dim" data-dim="(\w+)">(.*?)<\/g>/g)) {
    const body = m[2];
    const text = body.match(/>([^<]+)<\/text>/)![1];
    const angle = Number(body.match(/rotate\((-?[\d.]+)/)?.[1] ?? 0);
    const paths = [...body.matchAll(/ d="([^"]+)"/g)].map((p) => p[1]);
    const line = (paths.length > 2 ? paths[1] : paths[0]).match(/-?[\d.]+/g)!.map(Number);
    out[m[1]] = { text, angle, line };
  }
  return out;
}

describe('φύλλο όψεων (ISO 129): κύβος με εγκοπή 30 × 20 × 20', () => {
  it('τα μέτρα είναι ΠΑΝΤΑ πραγματικά, σε κάθε κλίμακα', () => {
    for (const scale of [
      { kind: 'reduce', n: 1 },
      { kind: 'reduce', n: 2 },
      { kind: 'enlarge', n: 3 },
    ] as Scale[]) {
      const d = dims(sheet(scale).svg);
      expect(d.L.text).toBe('30');
      expect(d.H.text).toBe('20');
      expect(d.W.text).toBe('20');
      expect(d.nw.text).toBe('12');
    }
  });

  it('η κλίμακα αλλάζει το μέγεθος στο χαρτί: μήκος 30 → 15 mm στο 1:2, 30 mm στο 1:1', () => {
    const len = (scale: Scale) => {
      const l = dims(sheet(scale).svg).L.line;
      return Math.hypot(l[2] - l[0], l[3] - l[1]);
    };
    expect(len({ kind: 'reduce', n: 2 })).toBeCloseTo(15, 2);
    expect(len({ kind: 'reduce', n: 1 })).toBeCloseTo(30, 2);
  });

  it('κάθε μέτρο μία φορά, στη σωστή όψη', () => {
    const svg = sheet({ kind: 'reduce', n: 1 }).svg;
    for (const id of ['L', 'W', 'H', 'nw', 'nd', 'nt']) {
      expect(svg.match(new RegExp(`data-dim="${id}"`, 'g'))?.length).toBe(1);
    }
  });

  it('περιστροφή κειμένου: οριζόντιες 0°, κάθετη δεξιά +90°', () => {
    const d = dims(sheet({ kind: 'reduce', n: 1 }).svg);
    expect(d.L.angle).toBe(0);
    expect(d.nw.angle).toBe(0);
    expect(d.H.angle).toBe(90); // ύψος στα δεξιά της πρόσοψης
    expect(d.nt.angle).toBe(90);
  });

  it('πινακίδιο με την κλίμακα· προειδοποίηση όταν δεν χωράει στο A3', () => {
    const s12 = sheet({ kind: 'reduce', n: 2 });
    expect(s12.svg).toContain('>1:2<');
    expect(s12.warnings).toEqual([]);
    // 10:1 δεν χωρά στο A3: σμικρύνεται αυτόματα στη μεγαλύτερη που χωρά, με προειδοποίηση και στο πινακίδιο
    const big = sheet({ kind: 'enlarge', n: 10 });
    expect(big.warnings[0]).toMatch(/A3· σμικρύνθηκε σε 3:1 για να χωρά/);
    expect(big.usedScale).toEqual({ kind: 'enlarge', n: 3 });
    expect(big.svg).toContain('>3:1<');
    expect(dims(big.svg).L.text).toBe('30');
  });
});

describe('αριστερή κάθετη διάσταση: −90°', () => {
  it('έδρανο: ύψος άξονα 50 και βάση 20 στα αριστερά της πρόσοψης', () => {
    const t = templateById('bearing-block');
    const p = evaluate(t, defaultInputs(t), defaultToggles(t)).part!;
    const s = sheetSvg(computeSheetViews(p, 'first'), p, {
      projection: 'first',
      projectionLines: false,
      scale: { kind: 'reduce', n: 2 },
      fields: { title: 'Έδρανο', author: 'Γ. Π.', section: 'Β1', classroom: 'Β', drawingNo: 'ΣΧ-01', school: 'ΕΠΑΛ', date: '' },
    });
    const d = dims(s.svg);
    expect(d.Hax.text).toBe('50');
    expect(d.Hax.angle).toBe(-90);
    expect(d.H.angle).toBe(-90);
    expect(d.Ht.angle).toBe(90);
    expect(d.Db.text).toBe('Ø20');
    expect(d.R.text).toBe('R20');
  });
});

describe('άξονες τελεία-παύλα και πινακίδιο', () => {
  const t = templateById('bearing-block');
  const p = evaluate(t, defaultInputs(t), defaultToggles(t)).part!;
  const svg = sheetSvg(computeSheetViews(p, 'first'), p, {
    projection: 'first',
    projectionLines: false,
    scale: { kind: 'reduce', n: 2 },
    fields: { title: 'Έδρανο', author: 'Γ. Π.', section: 'Β1', classroom: 'Β', drawingNo: 'ΣΧ-01', school: 'ΕΠΑΛ', date: '24/10/2026' },
  }).svg;

  it('οπή Ø20: σταυρός στην πρόσοψη, γραμμή άξονα στην κάτοψη και στην πλάγια· οπή Ø4: σταυρός στην κάτοψη, άξονας στην πρόσοψη', () => {
    const d = svg.match(/<path d="([^"]*)"[^>]*stroke-dasharray="8 1.5 1 1.5"/)![1];
    // 2 σταυροί (2 γραμμές ο καθένας) + 2 άξονες Ø20 (κάτοψη, πλάγια) + 2 άξονες Ø4 (πρόσοψη, πλάγια)
    expect(d.match(/M/g)!.length).toBe(2 * 2 + 2 + 2);
  });

  it('πινακίδιο με τα πεδία του χρήστη και την κλίμακα', () => {
    for (const t of ['Έδρανο', 'Γ. Π.', 'Β1', 'ΕΠΑΛ', 'ΣΧ-01', '24/10/2026', '1:2']) expect(svg).toContain(`>${t}<`);
  });
});

describe('διακόπτης διαστάσεων', () => {
  it('χωρίς διαστάσεις: καμία ομάδα διάστασης, οι γραμμές και το πινακίδιο μένουν', () => {
    const fields = { title: 'Κύβος', author: '', section: '', classroom: '', drawingNo: '', school: '', date: '' };
    const on = sheetSvg(views, cube, { projection: 'first', projectionLines: true, scale: { kind: 'reduce', n: 1 }, fields }).svg;
    const off = sheetSvg(views, cube, { projection: 'first', projectionLines: true, showDims: false, scale: { kind: 'reduce', n: 1 }, fields }).svg;
    expect(on).toContain('class="dim"');
    expect(off).not.toContain('class="dim"');
    expect(off).toContain('stroke-dasharray="2.5 1.25"');
    expect(off).toContain('>Κύβος<');
  });
});

describe('πλάγια όψη με διαστάσεις (Bug 5)', () => {
  it('κύβος: ύψος και βάθος στην πλάγια όψη, όχι επαναλήψεις', () => {
    const v = computeSheetViews(cube, 'first');
    const side = v.find((x) => x.role === 'side')!;
    const top = v.find((x) => x.role === 'top')!;
    const front = v.find((x) => x.role === 'front')!;
    const ids = (view: typeof side) => assignDims(cube.dims, v).get(view)!.map((d) => d.id).sort();
    expect(ids(side)).toEqual(['H', 'W']);
    expect(ids(front)).toEqual(['L', 'nt', 'nw']);
    expect(ids(top)).toEqual(['nd']);
  });
});

describe('προτεινόμενη κλίμακα', () => {
  it('κύβος 30×20×20 σε 2×2: η μεγαλύτερη που χωρά είναι 3:1', () => {
    expect(suggestedScale(cube, 'first', 'quadrants')).toEqual({ kind: 'enlarge', n: 3 });
  });

  it('η προτεινόμενη χωρά χωρίς σμίκρυνση, η αμέσως μεγαλύτερη όχι', () => {
    const s = suggestedScale(cube, 'first', 'quadrants');
    expect(sheet(s).warnings).toEqual([]);
    expect(sheet({ kind: 'enlarge', n: 5 }).warnings.length).toBe(1);
  });

  it('εξάρτημα 100×80: όχι μεγέθυνση', () => {
    const t = templateById('bearing-block');
    const part = evaluate(t, defaultInputs(t), defaultToggles(t)).part!;
    const s = suggestedScale(part, 'first', 'quadrants');
    expect(s.kind === 'reduce' || s.n === 1).toBe(true);
  });
});

describe('φύλλο: μόνο οι απαραίτητες διαστάσεις', () => {
  it('ΤΕΤΡΙΣ: χωρίς Ls (= L − P) και Hu (= Ht − Hs), με τις υπόλοιπες', () => {
    const t = templateById('stepped-block');
    const p = evaluate(t, defaultInputs(t), defaultToggles(t)).part!;
    const svg = sheetSvg(computeSheetViews(p, 'first'), p, {
      projection: 'first',
      projectionLines: true,
      scale: { kind: 'reduce', n: 1 },
      fields: { title: '', author: '', section: '', classroom: '', drawingNo: '', school: '', date: '' },
    }).svg;
    expect(svg).not.toContain('data-dim="Ls"');
    expect(svg).not.toContain('data-dim="Hu"');
    for (const id of ['L', 'W', 'P', 'Hs']) expect(svg).toContain(`data-dim="${id}"`);
  });
});

describe('γραμμές προβολής: από το αντικείμενο ως το αντικείμενο', () => {
  it('ΕΞΑΡΤΗΜΑ: η πάνω γραμμή ξεκινά από την κορυφή του στρογγυλού μέρους, όχι από την άκρη του κουτιού', () => {
    const t = templateById('bearing-block');
    const p = evaluate(t, defaultInputs(t), defaultToggles(t)).part!;
    const svg = sheetSvg(computeSheetViews(p, 'first'), p, {
      projection: 'first',
      projectionLines: true,
      scale: { kind: 'reduce', n: 1 },
      fields: { title: '', author: '', section: '', classroom: '', drawingNo: '', school: '', date: '' },
    }).svg;
    const d = svg.match(/<path d="([^"]*)" stroke="#9aa5b1"/)![1];
    // τρίτη γραμμή = οριζόντια στο ύψος της κορυφής: ξεκινά κοντά στο κέντρο (x ≈ 110), όχι στο 160
    const [, x] = d.match(/M[\d.]+ [\d.]+V[\d.]+M[\d.]+ [\d.]+V[\d.]+M([\d.]+) /)!.map(Number);
    expect(x).toBeGreaterThan(100);
    expect(x).toBeLessThan(125);
  });
});
