import { describe, expect, it } from 'vitest';
import { formatNumber, parseDecimal } from './format';
import { applyScale, formatScaled, scaleHint, scaleLabel, type Scale } from './scale';

const s = (kind: Scale['kind'], n: number): Scale => ({ kind, n });

describe('κλίμακα', () => {
  it('το παράδειγμα της προδιαγραφής: 30 → 90 / 15 / 0,6', () => {
    expect(formatScaled(30, s('enlarge', 3))).toBe('90');
    expect(formatScaled(30, s('reduce', 2))).toBe('15');
    expect(formatScaled(30, s('reduce', 50))).toBe('0,6');
    expect(formatScaled(30, s('reduce', 1))).toBe('30');
  });

  it('μεγέθυνση πολλαπλασιάζει, σμίκρυνση διαιρεί', () => {
    expect(applyScale(12, s('enlarge', 10))).toBe(120);
    expect(applyScale(12, s('reduce', 100))).toBeCloseTo(0.12);
  });

  it('ετικέτες και υπόδειξη', () => {
    expect(scaleLabel(s('enlarge', 3))).toBe('3:1');
    expect(scaleLabel(s('reduce', 50))).toBe('1:50');
    expect(scaleLabel(s('reduce', 2.5))).toBe('1:2,5');
    expect(scaleLabel(s('enlarge', 1))).toBe('1:1');
    expect(scaleHint(s('enlarge', 3))).toBe('οι αριθμοί × 3');
    expect(scaleHint(s('reduce', 2))).toBe('οι αριθμοί ÷ 2');
  });
});

describe('μορφοποίηση αριθμών', () => {
  it('ελληνικό κόμμα, χωρίς περιττά μηδενικά, χωρίς διαχωριστικό χιλιάδων', () => {
    expect(formatNumber(0.6)).toBe('0,6');
    expect(formatNumber(12.5)).toBe('12,5');
    expect(formatNumber(30)).toBe('30');
    expect(formatNumber(1500)).toBe('1500');
    expect(formatNumber(30 / 7)).toBe('4,29');
    expect(formatNumber(1.005)).toBe('1,01');
    expect(formatNumber(2.999999999)).toBe('3');
  });

  it('πολύ μικρές τιμές δεν γράφουν 0', () => {
    expect(formatNumber(0.004)).toBe('0,004');
    expect(formatNumber(0.0012345)).toBe('0,0012');
    expect(formatNumber(0)).toBe('0');
  });

  it('ανάγνωση με κόμμα ή τελεία', () => {
    expect(parseDecimal('12,5')).toEqual({ ok: true, value: 12.5 });
    expect(parseDecimal(' 7.25 ')).toEqual({ ok: true, value: 7.25 });
    expect(parseDecimal('').ok).toBe(false);
    expect(parseDecimal('abc').ok).toBe(false);
    expect(parseDecimal('1,2,3').ok).toBe(false);
    expect(parseDecimal('-3').ok).toBe(false);
  });
});
