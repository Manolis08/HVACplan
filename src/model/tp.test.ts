import { describe, expect, it } from 'vitest';
import { signedVolume } from './geometry';
import { buildP, buildT, buildTP, JOIN_START, machiningOf, pieceOffset, shiftPart, TP, TP_APART, tpPieces } from './tp';

const { W, T, LA, LB, TL, TW } = TP;

describe('Τ+Π', () => {
  it('Τ: από ορθογώνιο 56 × 55 × 8 σε Τ (σώμα 26 + γλώσσα 30 × 20)', () => {
    expect(signedVolume(buildT(0).triangles)).toBeCloseTo((LA + TL) * W * T, 3);
    expect(signedVolume(buildT(1).triangles)).toBeCloseTo(LA * W * T + TL * TW * T, 3);
  });

  it('Π: από ορθογώνιο 52 × 55 × 8 σε Π (εγκοπή 30 × 20)', () => {
    expect(signedVolume(buildP(0).triangles)).toBeCloseTo(LB * W * T, 3);
    expect(signedVolume(buildP(1).triangles)).toBeCloseTo(LB * W * T - TL * TW * T, 3);
  });

  it('μαζί: η γλώσσα γεμίζει την εγκοπή, 78 × 55 × 8, Τ 56, γλώσσα 30 × 20 στη μέση', () => {
    const p = buildTP();
    // το πλαίσιο κρατά χώρο για τα κομμάτια όταν είναι χωριστά, ώστε να μη κινείται η κάμερα
    expect(p.bbox).toEqual({ min: [-TP_APART / 2, 0, 0], max: [LA + LB + TP_APART / 2, W, T] });
    expect(signedVolume(p.triangles)).toBeCloseTo((LA + LB) * W * T, 3);
    expect(p.dims.find((d) => d.id === 'L')?.value).toBe(78);
    expect(p.dims.find((d) => d.id === 'TA')?.value).toBe(56);
    expect(p.dims.find((d) => d.id === 'tl')?.value).toBe(30);
    expect(p.dims.find((d) => d.id === 'W')?.value).toBe(55);
    expect(TP.TY * 2 + TW).toBe(W); // στη μέση
  });

  it('μαζί, με πρόοδο: ορθογώνια στο 0, κομμένα και χωριστά πριν τη συναρμογή, ίδιο πλαίσιο παντού', () => {
    expect(signedVolume(buildTP(0).triangles)).toBeCloseTo((LA + TL + LB) * W * T, 3);
    expect(signedVolume(buildTP(JOIN_START).triangles)).toBeCloseTo((LA + LB) * W * T, 3);
    expect(buildTP(0).bbox).toEqual(buildTP(1).bbox);
    expect(buildTP(0.5).bbox).toEqual(buildTP(1).bbox);
    expect(buildTP(0.95).dims.some((d) => d.id === 'L')).toBe(false);
  });

  it('μεμονωμένο κομμάτι στη θέση του μέσα στο σύνολο: ίδια γεωμετρία με το κομμάτι του «μαζί»', () => {
    // στα άκρα της κατεργασίας (ορθογώνια ή έτοιμα), όπου μπορεί κανείς να επιλέξει κομμάτι
    for (const pB of [1, 0.95, JOIN_START, 0]) {
      const pieces = tpPieces(pB);
      const q = machiningOf(pB);
      const t = shiftPart(buildT(q), pieceOffset('T', pB));
      const p = shiftPart(buildP(q), pieceOffset('P', pB));
      expect(Array.from(t.triangles)).toEqual(Array.from(pieces.T.triangles));
      expect(Array.from(p.triangles)).toEqual(Array.from(pieces.P.triangles));
      // οι διαστάσεις μετακινούνται μαζί
      const L = p.dims.find((d) => d.id === 'L');
      expect(L?.kind === 'linear' && L.a[0]).toBeCloseTo(pieceOffset('P', pB));
    }
  });

  it('χωρισμένα (0%): κάθε κομμάτι έχει τις δικές του διαστάσεις', () => {
    const v = (p: ReturnType<typeof buildTP>, id: string) => p.dims.find((d) => d.id === id)?.value;
    const p0 = buildTP(0);
    expect(v(p0, 'LT')).toBe(56);
    expect(v(p0, 'LP')).toBe(52);
    expect(v(p0, 'WT')).toBe(55);
    expect(v(p0, 'HT')).toBe(8);
    expect(v(p0, 'WP')).toBe(55);
    expect(v(p0, 'HP')).toBe(8);
    // ορθογώνια: δεν υπάρχουν ακόμη γλώσσα και εγκοπή
    expect(v(p0, 'tl')).toBeUndefined();
    expect(v(p0, 'sl')).toBeUndefined();
    // κομμένα (πριν τη συναρμογή): προστίθενται
    const pc = buildTP(JOIN_START);
    expect(v(pc, 'tl')).toBe(30);
    expect(v(pc, 'tw')).toBe(20);
    expect(v(pc, 'sl')).toBe(30);
    expect(v(pc, 'sw')).toBe(20);
  });
});
