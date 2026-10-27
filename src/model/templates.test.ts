import { describe, expect, it } from 'vitest';
import { formatScaled } from '../lib/scale';
import { defaultInputs, defaultToggles, evaluate } from './evaluate';
import { signedVolume } from './geometry';
import { TEMPLATES, templateById } from './templates';
import type { Part, Vec3 } from './types';

function build(id: string, overrides: Record<string, string> = {}, toggles = {}) {
  const t = templateById(id);
  return evaluate(t, { ...defaultInputs(t), ...overrides }, { ...defaultToggles(t), ...toggles });
}

function size(p: Part): Vec3 {
  return [0, 1, 2].map((a) => p.bbox.max[a] - p.bbox.min[a]) as Vec3;
}

/** Κάθε ακμή τριγώνου πρέπει να ανήκει σε ακριβώς 2 τρίγωνα (κλειστή επιφάνεια). */
function isWatertight(tris: Float32Array): boolean {
  const key = (i: number) => [0, 1, 2].map((a) => tris[i + a].toFixed(5)).join(',');
  const counts = new Map<string, number>();
  for (let t = 0; t < tris.length; t += 9) {
    const v = [key(t), key(t + 3), key(t + 6)];
    for (let e = 0; e < 3; e++) {
      const a = v[e];
      const b = v[(e + 1) % 3];
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return [...counts.values()].every((c) => c === 2);
}

type Seg = [Vec3, Vec3];
function segments(edges: Float32Array): Seg[] {
  const out: Seg[] = [];
  for (let i = 0; i < edges.length; i += 6) {
    out.push([
      [edges[i], edges[i + 1], edges[i + 2]],
      [edges[i + 3], edges[i + 4], edges[i + 5]],
    ]);
  }
  return out;
}
const same = (a: Vec3, b: Vec3) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
const hasEdge = (edges: Float32Array, p: Vec3, q: Vec3) =>
  segments(edges).some(([a, b]) => (same(a, p) && same(b, q)) || (same(a, q) && same(b, p)));

describe('Κύβος με εγκοπή — δοκιμαστικό παράδειγμα', () => {
  const ev = build('notched-cube');
  const p = ev.part!;

  it('προεπιλογές 30 × 20 × 20, εγκοπή 12 / 9 / 13', () => {
    expect(ev.issues).toEqual([]);
    expect(size(p)).toEqual([30, 20, 20]);
    expect(p.bbox.min).toEqual([0, 0, 0]);
  });

  it('όγκος = 30·20·20 − 12·9·13 και κλειστή επιφάνεια με κάθετα προς τα έξω', () => {
    expect(signedVolume(p.triangles)).toBeCloseTo(30 * 20 * 20 - 12 * 9 * 13, 6);
    expect(isWatertight(p.triangles)).toBe(true);
  });

  it('ακμές της εγκοπής στις σωστές θέσεις (πάτωμα z 0..7, τοιχάκια x 0..9 και 21..30, πίσω τοίχος y 9..20)', () => {
    // "U" στην πρόσοψη (y = 0)
    expect(hasEdge(p.edges, [9, 0, 7], [9, 0, 20])).toBe(true);
    expect(hasEdge(p.edges, [21, 0, 7], [21, 0, 20])).toBe(true);
    expect(hasEdge(p.edges, [9, 0, 7], [21, 0, 7])).toBe(true);
    // εσωτερικές γωνίες με τον πίσω τοίχο (y = 9)
    expect(hasEdge(p.edges, [9, 9, 7], [21, 9, 7])).toBe(true);
    expect(hasEdge(p.edges, [9, 9, 7], [9, 9, 20])).toBe(true);
    expect(hasEdge(p.edges, [21, 9, 7], [21, 9, 20])).toBe(true);
    expect(hasEdge(p.edges, [9, 9, 20], [21, 9, 20])).toBe(true);
    // πάνω ακμές των τοιχωμάτων προς την εγκοπή
    expect(hasEdge(p.edges, [9, 0, 20], [9, 9, 20])).toBe(true);
    expect(hasEdge(p.edges, [21, 0, 20], [21, 9, 20])).toBe(true);
    // εξωτερικό περίγραμμα ενιαίο
    expect(hasEdge(p.edges, [0, 0, 0], [30, 0, 0])).toBe(true);
    expect(hasEdge(p.edges, [0, 0, 0], [0, 0, 20])).toBe(true);
    expect(hasEdge(p.edges, [0, 20, 20], [30, 20, 20])).toBe(true);
  });

  it('χωρίς ψεύτικες ραφές από τα κουτιά (π.χ. στο z = 7 της πρόσοψης έξω από την εγκοπή)', () => {
    const onLine = segments(p.edges).filter(
      ([a, b]) => a[1] === 0 && b[1] === 0 && a[2] === 7 && b[2] === 7,
    );
    expect(onLine).toHaveLength(1);
    expect(hasEdge(p.edges, [9, 0, 7], [21, 0, 7])).toBe(true);
    // στην αριστερή έδρα (x = 0) υπάρχουν μόνο οι 4 ακμές του περιγράμματος
    const leftFace = segments(p.edges).filter(([a, b]) => a[0] === 0 && b[0] === 0);
    expect(leftFace).toHaveLength(4);
  });

  it('η κλίμακα αλλάζει μόνο τον αριθμό: μήκος 30 → 90 στο 3:1, 15 στο 1:2', () => {
    const L = p.dims.find((d) => d.id === 'L')!;
    expect(L.value).toBe(30);
    expect(formatScaled(L.value, { kind: 'enlarge', n: 3 })).toBe('90');
    expect(formatScaled(L.value, { kind: 'reduce', n: 2 })).toBe('15');
  });

  it('έλεγχοι εγκυρότητας με ελληνικά μηνύματα', () => {
    expect(build('notched-cube', { nw: '30' }).issues[0].message).toMatch(/πλάτος εγκοπής \(30\).*μήκος \(30\)/);
    expect(build('notched-cube', { nd: '25' }).issues[0].fields).toContain('nd');
    expect(build('notched-cube', { nt: '20' }).issues[0].message).toMatch(/πάτωμα/);
    expect(build('notched-cube', { L: '0' }).fieldErrors.L).toMatch(/μεγαλύτερο από 0/);
    expect(build('notched-cube', { L: 'α' }).fieldErrors.L).toMatch(/έγκυρος αριθμός/);
    expect(build('notched-cube', { L: '' }).part).toBeNull();
  });

  it('δεκαδικά με κόμμα', () => {
    const e = build('notched-cube', { L: '30,5' });
    expect(size(e.part!)[0]).toBeCloseTo(30.5);
  });
});

describe('όλα τα πρότυπα', () => {
  it.each(TEMPLATES.map((t) => t.id))('%s: προεπιλογές έγκυρες, κλειστή επιφάνεια, θετικός όγκος', (id) => {
    const ev = build(id);
    expect(ev.issues).toEqual([]);
    expect(ev.part).not.toBeNull();
    expect(isWatertight(ev.part!.triangles)).toBe(true);
    expect(signedVolume(ev.part!.triangles)).toBeGreaterThan(0);
    expect(ev.part!.edges.length % 6).toBe(0);
  });
});

describe('Έδρανο με χελιδονοουρά (άσκηση με R20, Ø20, 50, χελιδονοουρά 80/60/10)', () => {
  const p = build('bearing-block').part!;

  it('διαστάσεις 100 × 80 × 70, κλειστό στερεό, όγκος = προφίλ × βάθος − οπή λίπανσης', () => {
    expect(size(p).map((v) => +v.toFixed(4))).toEqual([100, 80, 70]);
    expect(isWatertight(p.triangles)).toBe(true);
    const halfDisk = 0.5 * 32 * 20 * 20 * Math.sin(Math.PI / 32);
    const bore = 0.5 * 64 * 10 * 10 * Math.sin((2 * Math.PI) / 64);
    const profile = 100 * 20 - ((80 + 60) / 2) * 10 + 40 * 30 + halfDisk - bore;
    // οπή Ø4 από την κορυφή R20 ως την οπή Ø20: περίπου π·2²·(20 − 10)
    const oil = Math.PI * 4 * 10;
    expect(signedVolume(p.triangles)).toBeGreaterThan(profile * 80 - oil * 1.1);
    expect(signedVolume(p.triangles)).toBeLessThan(profile * 80 - oil * 0.9);
  });

  it('χελιδονοουρά στην μπροστινή έδρα: άνοιγμα 20..80 κάτω, 10..90 σε ύψος 10', () => {
    expect(hasEdge(p.edges, [20, 0, 0], [10, 0, 10])).toBe(true);
    expect(hasEdge(p.edges, [10, 0, 10], [90, 0, 10])).toBe(true);
    expect(hasEdge(p.edges, [90, 0, 10], [80, 0, 0])).toBe(true);
    // ορθοστάτης 30..70 από το ύψος 20 ως τον άξονα στο 50
    expect(hasEdge(p.edges, [70, 0, 20], [70, 0, 50])).toBe(true);
  });

  it('χωρίς διαμήκεις γραμμές πάνω στην καμπύλη κορυφή', () => {
    const alongY = segments(p.edges).filter(([a, b]) => a[0] === b[0] && a[2] === b[2] && a[1] !== b[1]);
    expect(alongY.every(([a]) => a[2] <= 50 + 1e-6)).toBe(true);
  });

  it('οπή λίπανσης Ø4 στα 40 από μπροστά: πραγματική τρύπα από την κορυφή ως την οπή του άξονα', () => {
    expect(p.circles[1].center).toEqual([50, 40, 60]);
    // κανένα τρίγωνο της κορυφής μέσα στον κύκλο της οπής (x−50)² + (y−40)² < 2²
    let inside = 0;
    for (let i = 0; i < p.triangles.length; i += 9) {
      const cx = (p.triangles[i] + p.triangles[i + 3] + p.triangles[i + 6]) / 3;
      const cy = (p.triangles[i + 1] + p.triangles[i + 4] + p.triangles[i + 7]) / 3;
      const cz = (p.triangles[i + 2] + p.triangles[i + 5] + p.triangles[i + 8]) / 3;
      if (cz > 66 && Math.hypot(cx - 50, cy - 40) < 1.5) inside++;
    }
    expect(inside).toBe(0);
    // περίγραμμα της οπής πάνω στην κορυφή (z ≈ 69,9) ως ακμή
    const ringTop = segments(p.edges).filter(([a, b]) => a[2] > 69.8 && b[2] > 69.8 && Math.hypot(a[0] - 50, a[1] - 40) < 2.01);
    expect(ringTop.length).toBe(24);
  });

  it('έλεγχοι εγκυρότητας', () => {
    expect(build('bearing-block', { R: '50' }).issues[0].message).toMatch(/στενότερος από τη βάση/);
    expect(build('bearing-block', { Gd: '20' }).issues[0].message).toMatch(/χελιδονοουράς/);
    expect(build('bearing-block', { Db: '40' }).issues[0].message).toMatch(/τοίχωμα/);
    expect(build('bearing-block', { Hax: '25' }).issues.some((i) => /κατεβαίνει μέσα στη βάση/.test(i.message))).toBe(true);
    expect(build('bearing-block', { yo: '79' }).issues[0].message).toMatch(/οπή λίπανσης/);
  });
});

describe('Κλιμακωτό με φτερό (20, 3, 13, 10, 5, 15, 15)', () => {
  const p = build('stepped-block').part!;

  it('διαστάσεις 35 × 15 × 15, όγκος από τα τρία μέρη, κλειστή επιφάνεια', () => {
    expect(size(p)).toEqual([35, 15, 15]);
    expect(signedVolume(p.triangles)).toBeCloseTo(17 * 3 * 13 + 3 * 15 * 15 + 15 * 15 * 5, 6);
    expect(isWatertight(p.triangles)).toBe(true);
  });

  it('φτερό ύψους 13 κρεμασμένο από την κορυφή: κενό 2 από κάτω, πάνω επιφάνεια ενιαία με την κολόνα', () => {
    // κάτω ακμές του φτερού στο z = 2
    expect(hasEdge(p.edges, [0, 12, 2], [17, 12, 2])).toBe(true);
    expect(hasEdge(p.edges, [17, 12, 2], [17, 15, 2])).toBe(true);
    // πάνω: φτερό και κολόνα στο ίδιο ύψος 15, χωρίς σκαλί
    expect(hasEdge(p.edges, [0, 15, 15], [20, 15, 15])).toBe(true);
    expect(p.bbox.max[2]).toBe(15);
    expect(hasEdge(p.edges, [20, 0, 5], [20, 0, 15])).toBe(true);
  });

  it('έλεγχοι εγκυρότητας', () => {
    expect(build('stepped-block', { Wc: '20' }).issues[0].message).toMatch(/κολόνας/);
    expect(build('stepped-block', { Dw: '15' }).issues[0].message).toMatch(/φτερού/);
    expect(build('stepped-block', { Hw: '16' }).issues[0].message).toMatch(/κρέμεται/);
  });
});
