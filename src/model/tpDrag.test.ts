import { describe, expect, it } from 'vitest';
import { TP, tpFootprints } from './tp';
import { atHome, createDrag, deepestOverlap, homeDistance, MAGNET_RADIUS, nearHome, stepDrag, type DragBody } from './tpDrag';
import type { Vec3 } from './types';

const { W, T, LA, LB, TL } = TP;
const DT = 1 / 60;

/** Συναρμολογημένα (p = 1): σέρνεται το id, το άλλο μένει ακίνητο. */
function setup(id: 'T' | 'P') {
  const f = tpFootprints(1);
  const pivot: Vec3 = id === 'T' ? [LA / 2 - 3, W / 2, T] : [LA + (TL + LB) / 2, W / 2, T];
  return createDrag(pivot, f[id], f[id === 'T' ? 'P' : 'T']);
}

/** Τρέχει τη φυσική με τον στόχο να κινείται προς to, και ελέγχει σε κάθε καρέ ότι δεν υπάρχει διείσδυση. */
function run(b: DragBody, to: [number, number], frames = 180) {
  const from: [number, number] = [b.pivot[0], b.pivot[1]];
  let maxJump = 0;
  for (let i = 0; i < frames; i++) {
    const k = Math.min(1, i / 40);
    const target: Vec3 = [from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k, b.pivot[2] + 3];
    const before = [b.pos[0], b.pos[1]];
    stepDrag(b, target, DT);
    maxJump = Math.max(maxJump, Math.hypot(b.pos[0] - before[0], b.pos[1] - before[1]));
    const o = deepestOverlap(b);
    expect(o?.depth ?? 0, `διείσδυση στο καρέ ${i}`).toBeLessThan(0.05);
  }
  return { maxJump };
}

describe('σύρσιμο Τ+Π', () => {
  it('το Τ βγαίνει από την εγκοπή τραβώντας το προς τα πίσω (−X)', () => {
    const b = setup('T');
    run(b, [b.pivot[0] - 60, b.pivot[1]]);
    expect(b.pos[0]).toBeLessThan(b.pivot[0] - 55);
  });

  it('το Π βγαίνει τραβώντας το προς τα εμπρός (+X)', () => {
    const b = setup('P');
    run(b, [b.pivot[0] + 60, b.pivot[1]]);
    expect(b.pos[0]).toBeGreaterThan(b.pivot[0] + 55);
  });

  it('η γλώσσα μέσα στην εγκοπή δεν αφήνει το Τ να φύγει στο πλάι', () => {
    const b = setup('T');
    run(b, [b.pivot[0], b.pivot[1] + 40]);
    expect(Math.abs(b.pos[1] - b.pivot[1])).toBeLessThan(0.1);
  });

  it('λοξό τράβηγμα: γλιστρά έξω χωρίς να μπει μέσα στο άλλο και χωρίς πηδήματα', () => {
    const b = setup('P');
    const { maxJump } = run(b, [b.pivot[0] + 70, b.pivot[1] + 50], 240);
    expect(b.pos[0]).toBeGreaterThan(b.pivot[0] + 30);
    expect(maxJump).toBeLessThan(12); // mm ανά καρέ (60 fps)
  });

  it('γρήγορο τράβηγμα του Π πάνω στο Τ: σταματά στην επαφή, δεν το διαπερνά', () => {
    const b = setup('P');
    // πρώτα έξω, μετά απότομα προς το Τ
    run(b, [b.pivot[0] + 60, b.pivot[1]], 90);
    for (let i = 0; i < 120; i++) {
      stepDrag(b, [b.pivot[0] - 120, b.pivot[1] + 5, b.pivot[2] + 3], DT);
      expect(deepestOverlap(b)?.depth ?? 0).toBeLessThan(0.05);
    }
    expect(b.pos[0]).toBeGreaterThan(b.pivot[0] - 1);
  });

  it('ελεύθερο στον αέρα στρίβει και γέρνει (ragdoll), και ηρεμεί όταν σταματήσει', () => {
    const b = setup('P');
    run(b, [b.pivot[0] + 60, b.pivot[1]], 60);
    let maxYaw = 0;
    for (let i = 0; i < 40; i++) {
      stepDrag(b, [b.pivot[0] + 60, b.pivot[1] + (i < 20 ? 40 : 0), b.pivot[2] + 3], DT);
      maxYaw = Math.max(maxYaw, Math.abs(b.yaw));
    }
    expect(maxYaw).toBeGreaterThan(0.05);
    for (let i = 0; i < 600; i++) stepDrag(b, [b.pivot[0] + 60, b.pivot[1], b.pivot[2] + 3], DT);
    expect(Math.abs(b.yaw)).toBeLessThan(0.01);
    expect(Math.abs(b.rx) + Math.abs(b.ry)).toBeLessThan(0.01);
  });

  it('μαγνήτης: κοντά στη θέση του το τραβά προς τα μέσα, μακριά δεν επηρεάζει', () => {
    const b = setup('P');
    run(b, [b.pivot[0] + 15, b.pivot[1]], 240);
    // ο κέρσορας μένει στα 15 mm, το κομμάτι έλκεται πιο κοντά
    expect(homeDistance(b)).toBeLessThan(12);
    const far = setup('P');
    run(far, [far.pivot[0] + MAGNET_RADIUS + 20, far.pivot[1]], 240);
    expect(homeDistance(far)).toBeGreaterThan(MAGNET_RADIUS + 19);
  });

  it('ακύρωση: αν το ξαναφέρεις κοντά και το αφήσεις, κάθεται ακριβώς στη θέση του', () => {
    for (const id of ['T', 'P'] as const) {
      const b = setup(id);
      const out = id === 'T' ? -50 : 50;
      run(b, [b.pivot[0] + out, b.pivot[1] + 20], 150); // έξω και λοξά
      run(b, [b.pivot[0] + out * 0.18, b.pivot[1] + 3], 150); // πίσω, όχι ακριβώς στη θέση
      expect(nearHome(b)).toBe(true);
      // αφέθηκε: ο στόχος γίνεται η θέση συναρμογής
      let i = 0;
      for (; i < 120 && !atHome(b); i++) {
        stepDrag(b, [...b.pivot], DT);
        expect(deepestOverlap(b)?.depth ?? 0).toBeLessThan(0.05);
      }
      expect(atHome(b), id).toBe(true);
    }
  });
});
