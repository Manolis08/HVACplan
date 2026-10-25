import { formatNumber } from './format';

/**
 * Κλίμακα σχεδίου. Αλλάζει ΜΟΝΟ τους αριθμούς που εμφανίζονται, ποτέ τη γεωμετρία.
 * enlarge = n:1 (εμφανιζόμενο = πραγματικό × n), reduce = 1:n (εμφανιζόμενο = πραγματικό ÷ n).
 */
export interface Scale {
  kind: 'enlarge' | 'reduce';
  n: number;
}

export const ONE_TO_ONE: Scale = { kind: 'reduce', n: 1 };

export const SCALE_PRESETS: Scale[] = [
  { kind: 'enlarge', n: 10 },
  { kind: 'enlarge', n: 5 },
  { kind: 'enlarge', n: 3 },
  { kind: 'enlarge', n: 2 },
  ONE_TO_ONE,
  { kind: 'reduce', n: 2 },
  { kind: 'reduce', n: 5 },
  { kind: 'reduce', n: 10 },
  { kind: 'reduce', n: 20 },
  { kind: 'reduce', n: 50 },
  { kind: 'reduce', n: 100 },
];

export const SCALE_N_MIN = 1;
export const SCALE_N_MAX = 1000;

export function applyScale(realMm: number, s: Scale): number {
  return s.kind === 'enlarge' ? realMm * s.n : realMm / s.n;
}

/** Μέτρο όπως εμφανίζεται στις ετικέτες, π.χ. 30 στο 1:50 → "0,6". */
export function formatScaled(realMm: number, s: Scale): string {
  return formatNumber(applyScale(realMm, s));
}

export function scaleLabel(s: Scale): string {
  if (s.n === 1) return '1:1';
  const n = formatNumber(s.n);
  return s.kind === 'enlarge' ? `${n}:1` : `1:${n}`;
}

export function scaleHint(s: Scale): string {
  if (s.n === 1) return 'πραγματικά μέτρα';
  const n = formatNumber(s.n);
  return s.kind === 'enlarge' ? `οι αριθμοί × ${n}` : `οι αριθμοί ÷ ${n}`;
}

export const scaleKey = (s: Scale): string => (s.n === 1 ? '1:1' : scaleLabel(s));

export const sameScale = (a: Scale, b: Scale): boolean => scaleKey(a) === scaleKey(b);

export const isPreset = (s: Scale): boolean => SCALE_PRESETS.some((p) => sameScale(p, s));
