import { describe, expect, it } from 'vitest';
import { defaultInputs, defaultToggles, evaluate } from '../model/evaluate';
import { templateById } from '../model/templates';
import type { Part, Vec3 } from '../model/types';
import { viewBasis, viewById, type ViewId } from '../viewer/views';
import { edgeTopology, projectView, silhouettes, type Segment2 } from './hlr';

const partOf = (id: string) => {
  const t = templateById(id);
  return evaluate(t, defaultInputs(t), defaultToggles(t)).part!;
};

function view(part: Part, id: ViewId): Segment2[] {
  const b = viewBasis(viewById(id).dir);
  const v = (x: { x: number; y: number; z: number }): Vec3 => [x.x, x.y, x.z];
  const frame = { dir: v(b.dir), right: v(b.right), up: v(b.up) };
  const sil = silhouettes(edgeTopology(part.triangles), frame.dir);
  const lines = new Float32Array([...part.edges, ...sil]);
  const { min, max } = part.bbox;
  return projectView(part.triangles, lines, frame, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]));
}

const r2 = (s: Segment2) => {
  const pts = [s.a, s.b].map((p) => p.map((x) => +x.toFixed(2) + 0) as [number, number]);
  pts.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  return `${pts[0].join(',')}→${pts[1].join(',')}`;
};
const hidden = (segs: Segment2[]) => segs.filter((s) => s.hidden).map(r2).sort();
const visible = (segs: Segment2[]) => segs.filter((s) => !s.hidden).map(r2).sort();

describe('κρυφές γραμμές: κύβος με εγκοπή (30 × 20 × 20, εγκοπή 12)', () => {
  const cube = partOf('notched-cube');

  it('δεξιά όψη: ορθογώνιο 20 × 20, η εγκοπή διακεκομμένη (z = 7 για y 0..9 και y = 9 για z 7..20)', () => {
    const segs = view(cube, 'right'); // u = y, v = z
    expect(hidden(segs)).toEqual(['0,7→9,7', '9,7→9,20']);
    expect(visible(segs)).toEqual(['0,0→0,20', '0,0→20,0', '0,20→20,20', '20,0→20,20']);
  });

  it('αριστερή όψη: ίδιες κρυφές, κατοπτρικά (u = −y)', () => {
    expect(hidden(view(cube, 'left'))).toEqual(['-9,20→-9,7', '-9,7→0,7'].map((s) => {
      const [p, q] = s.split('→').map((x) => x.split(',').map(Number) as [number, number]);
      return r2({ a: p, b: q, hidden: true });
    }).sort());
  });

  it('πρόσοψη: το «U» μέσα στο ορθογώνιο, όλα συνεχή', () => {
    const segs = view(cube, 'front'); // u = x, v = z
    expect(hidden(segs)).toEqual([]);
    expect(visible(segs)).toEqual(
      expect.arrayContaining(['9,7→9,20', '21,7→21,20', '9,7→21,7', '0,0→30,0', '0,20→30,20']),
    );
  });

  it('πίσω όψη: κλειστή πλευρά, η εγκοπή κρυφή πίσω της', () => {
    const segs = view(cube, 'back'); // u = −x, v = z
    expect(hidden(segs).length).toBeGreaterThan(0);
    expect(visible(segs)).toEqual(['-30,0→-30,20', '-30,0→0,0', '-30,20→0,20', '0,0→0,20']);
  });
});

describe('κρυφές γραμμές: έδρανο με χελιδονοουρά', () => {
  const block = partOf('bearing-block');

  it('κάτοψη: οπή Ø20 (x = 40, 60) και χελιδονοουρά (x = 10, 20, 80, 90) διακεκομμένες σε όλο το βάθος', () => {
    const h = hidden(view(block, 'top')); // u = x, v = y
    for (const x of [10, 20, 40, 60, 80, 90]) expect(h).toContain(`${x},0→${x},80`);
  });

  it('πρόσοψη: ορατά χελιδονοουρά, ορθοστάτης, οπή άξονα· κρυφά μόνο τα δύο τοιχώματα της οπής λίπανσης', () => {
    const segs = view(block, 'front');
    const h = hidden(segs);
    expect(h).toHaveLength(2);
    // από την οπή Ø20 (z = 50 + √(10² − 2²) ≈ 59,8) ως την κορυφή (z = 50 + √(20² − 2²) ≈ 69,9)
    expect(h).toEqual(['48,59.8→48,69.9', '52,59.8→52,69.9']);
    expect(visible(segs)).toEqual(expect.arrayContaining(['10,10→90,10', '10,10→20,0', '80,0→90,10']));
  });

  it('πρόσοψη: η οπή λίπανσης φαίνεται διακεκομμένη (x = 48 και 52, από την οπή Ø20 ως την κορυφή)', () => {
    const h = hidden(view(block, 'front')).filter((s) => /^4[78]|^5[12]/.test(s));
    expect(h.some((s) => s.startsWith('48,') && s.includes('→48,'))).toBe(true);
    expect(h.some((s) => s.startsWith('52,') && s.includes('→52,'))).toBe(true);
  });

  it('δεξιά όψη: οπή άξονα (z = 40, 60) και χελιδονοουρά (z = 10) διακεκομμένες', () => {
    const h = hidden(view(block, 'right')); // u = y, v = z
    expect(h).toEqual(expect.arrayContaining(['0,40→80,40', '0,10→80,10']));
    // το πάνω περίγραμμα της οπής Ø20 (z = 60) διακόπτεται εκεί που μπαίνει η οπή λίπανσης (y 33..37)
    const z60 = h.filter((s) => /^[\d.]+,60→[\d.]+,60$/.test(s));
    expect(z60.length).toBe(2);
    expect(z60[0].startsWith('0,60→')).toBe(true);
  });
});
