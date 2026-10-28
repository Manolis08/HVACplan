import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { signedVolume } from './geometry';
import { buildTP, JOIN_START } from './tp';
import { FILE_HALF, HOLE_R, KERF, PHASES, pieceGeometry, scheduleFor, shapeCut, toolPoses, TP, workOf, type Op, type PieceId } from './tpProcess';

const { W, T, LA, LB, TL, TW, TY } = TP;
const LT = LA + TL;
const vol = (id: PieceId, tau: number, which: 'both' | PieceId = id) => signedVolume(pieceGeometry(id, scheduleFor(which), tau).triangles);
const FULL: Record<PieceId, number> = { T: LT * W * T, P: LB * W * T };
const FINAL: Record<PieceId, number> = { T: LA * W * T + TL * TW * T, P: LB * W * T - TL * TW * T };
const opById = (which: 'both' | PieceId, id: string) => scheduleFor(which).find((o) => o.id === id)!;
/** τ στη μέση της δουλειάς μιας εργασίας */
const midWork = (op: Op) => {
  let lo = op.t0, hi = op.t1;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (workOf(op, m) < 0.5) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
};

describe('Τ+Π: κατεργασία', () => {
  it('χρονοπρόγραμμα: τρυπάνι → πριόνι → λίμα, χωρίς επικαλύψεις, οι τρύπες γύρω στο 20 % της μπάρας', () => {
    for (const which of ['both', 'T', 'P'] as const) {
      const s = scheduleFor(which);
      for (let i = 1; i < s.length; i++) expect(s[i].t0).toBeGreaterThanOrEqual(s[i - 1].t1 - 1e-9);
      expect(s[0].kind).toBe('drill');
      expect(s[s.length - 1].kind).toBe('file');
      expect(s[s.length - 1].t1).toBeLessThan(1);
    }
    // 7 τρύπες (2 στο Τ, 5 στο Π), 6 κοπές, 7 πλευρές για λίμα
    const both = scheduleFor('both');
    expect(both.filter((o) => o.kind === 'drill')).toHaveLength(7);
    expect(both.filter((o) => o.kind === 'saw')).toHaveLength(6);
    expect(both.filter((o) => o.kind === 'file')).toHaveLength(7);
    const at20 = 0.2 / JOIN_START;
    expect(at20).toBeGreaterThan(PHASES.drill[0]);
    expect(at20).toBeLessThan(PHASES.drill[1]);
  });

  it('όγκος: από την ορθογώνια λάμα στο τελικό σχήμα, χωρίς άλματα πέρα από τα γρέζια', () => {
    for (const id of ['T', 'P'] as const) {
      expect(vol(id, 0)).toBeCloseTo(FULL[id], 3);
      expect(vol(id, 1)).toBeCloseTo(FINAL[id], 3);
      let prev = vol(id, 0);
      for (let i = 1; i <= 500; i++) {
        const v = vol(id, i / 500);
        expect(Number.isFinite(v)).toBe(true);
        // ο όγκος μόνο μικραίνει· εξαίρεση: τα γρέζια (λίγα mm³) εμφανίζονται όταν ελευθερώνεται κομμάτι υλικού
        expect(v - prev, `${id} στο τ=${i / 500}`).toBeLessThan(150);
        expect(v).toBeGreaterThan(FINAL[id] - 1);
        expect(v).toBeLessThan(FULL[id] + 1);
        prev = v;
      }
    }
  });

  it('τρύπα: στη μέση της διάτρησης έχει βάθος μισό πάχος, μετά περνά πέρα για πέρα', () => {
    const op = opById('T', 'T-h0');
    const area = (n: number) => 0.5 * n * HOLE_R * HOLE_R * Math.sin((2 * Math.PI) / n); // πολύγωνο 20 πλευρών
    const hole = area(20);
    expect(FULL.T - vol('T', midWork(op))).toBeCloseTo(hole * T * 0.5, 1);
    expect(FULL.T - vol('T', op.t1)).toBeCloseTo(hole * T, 1);
  });

  it('κοπή: η εγκοπή του πριονιού μεγαλώνει με το μήκος της κοπής', () => {
    const op = opById('P', 'P-c0u');
    const before = vol('P', op.t0);
    const mid = vol('P', midWork(op));
    expect(op.kind === 'saw' && before - mid).toBeCloseTo(op.kind === 'saw' ? op.len * 0.5 * KERF * T : 0, 1);
  });

  it('το υλικό ελευθερώνεται μόνο αφού τελειώσουν οι κοπές της περιοχής του', () => {
    const last = opById('P', 'P-c0l');
    expect(shapeCut('P', scheduleFor('P'), last.t0)).toBe(false);
    expect(shapeCut('P', scheduleFor('P'), last.t1)).toBe(true);
    const first = opById('T', 'T-c0h');
    // στο Τ φεύγει πρώτα η πάνω περιοχή, αλλά το σχήμα ολοκληρώνεται με την κάτω
    expect(shapeCut('T', scheduleFor('T'), first.t1)).toBe(false);
    expect(shapeCut('T', scheduleFor('T'), opById('T', 'T-c1h').t1)).toBe(true);
  });

  it('η πλευρά που λιμάρεται ισιώνει: λιγότερος όγκος από τα γρέζια', () => {
    const op = opById('T', 'T-f0h');
    expect(vol('T', op.t0)).toBeGreaterThan(vol('T', op.t1) + 10);
  });

  it('εργαλεία: το τρυπάνι πάνω στο κέντρο της τρύπας, το πριόνι στο μέτωπο της κοπής, η λίμα στην πλευρά', () => {
    const offsets = { T: [0, 0] as [number, number] };
    const drill = opById('T', 'T-h1');
    const d = toolPoses(scheduleFor('T'), midWork(drill), offsets).find((p) => p.kind === 'drill')!;
    expect(drill.kind === 'drill' && d.pos[0]).toBeCloseTo(LA + HOLE_R, 6);
    expect(drill.kind === 'drill' && d.pos[1]).toBeCloseTo(TY - HOLE_R, 6);
    expect(d.pos[2]).toBeLessThan(T); // μέσα στο υλικό
    expect(d.spin).toBe(true);
    // η μύτη δείχνει προς τα κάτω: ο άξονας −Z του τρυπανιού μένει −Z
    const down = new Vector3(0, 0, -1).applyQuaternion(new Quaternion(...d.quat));
    expect(down.z).toBeCloseTo(-1, 6);

    const cut = opById('T', 'T-c0h');
    const s = toolPoses(scheduleFor('T'), midWork(cut), offsets).find((p) => p.kind === 'saw')!;
    if (cut.kind !== 'saw') throw new Error();
    expect(s.pos[0]).toBeCloseTo(cut.p0[0] + cut.u[0] * cut.len * 0.5, 4);
    expect(s.pos[1]).toBeCloseTo(cut.p0[1], 6);
    expect(s.strokeAmp).toBeGreaterThan(0);
    // η λάμα πάει κυρίως πάνω-κάτω
    expect(Math.abs(s.strokeAxis[2])).toBeGreaterThan(0.75);

    const face = opById('T', 'T-f1v');
    const f = toolPoses(scheduleFor('T'), midWork(face), offsets).find((p) => p.kind === 'file')!;
    expect(f.pos[0]).toBeGreaterThan(LA); // ακουμπά απέξω, στα γρέζια
    expect(f.pos[0]).toBeLessThan(LA + 0.6);
    expect(f.strokeAxis[2]).toBeCloseTo(1, 6); // όρθια, πάνω-κάτω
    // η μύτη (−X της λίμας) δείχνει κάτω
    const tip = new Vector3(-1, 0, 0).applyQuaternion(new Quaternion(...f.quat));
    expect(tip.z).toBeCloseTo(-1, 6);
  });

  it('η λίμα δεν περνά μέσα από το κομμάτι: μένει απέξω και μέσα στα άκρα της πλευράς', () => {
    for (const which of ['T', 'P'] as const) {
      const offsets = { [which]: [0, 0] as [number, number] };
      for (const op of scheduleFor(which).filter((o) => o.kind === 'file')) {
        if (op.kind !== 'file') continue;
        const L = Math.hypot(op.b[0] - op.a[0], op.b[1] - op.a[1]);
        const e = [(op.b[0] - op.a[0]) / L, (op.b[1] - op.a[1]) / L];
        for (let i = 0; i <= 20; i++) {
          const tau = op.t0 + ((op.t1 - op.t0) * (0.12 + 0.78 * i / 20));
          const f = toolPoses(scheduleFor(which), tau, offsets).find((p) => p.kind === 'file')!;
          const rel = [f.pos[0] - op.a[0], f.pos[1] - op.a[1]];
          const along = rel[0] * e[0] + rel[1] * e[1];
          const outward = rel[0] * op.out[0] + rel[1] * op.out[1];
          expect(outward, op.id).toBeGreaterThan(0);
          expect(along - FILE_HALF, op.id).toBeGreaterThanOrEqual(-1e-6);
          expect(along + FILE_HALF, op.id).toBeLessThanOrEqual(L + 1e-6);
        }
      }
    }
  });

  it('εργαλεία: κανένα στην αρχή και στο τέλος, ένα κάθε φορά ενδιάμεσα', () => {
    const s = scheduleFor('both');
    const off = { T: [0, 0] as [number, number], P: [60, 0] as [number, number] };
    expect(toolPoses(s, 0, off)).toHaveLength(0);
    expect(toolPoses(s, 1, off)).toHaveLength(0);
    for (let i = 0; i <= 200; i++) expect(toolPoses(s, i / 200, off).length).toBeLessThanOrEqual(1);
  });

  it('η τελική συναρμογή δεν αλλάζει: τα κομμάτια μπαίνουν το ένα στο άλλο χωρίς κενά', () => {
    expect(signedVolume(buildTP(1).triangles)).toBeCloseTo((LA + LB) * W * T, 3);
  });
});
