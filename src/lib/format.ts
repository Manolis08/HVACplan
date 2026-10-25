/**
 * Μορφοποίηση αριθμού με ελληνικό δεκαδικό κόμμα, χωρίς περιττά μηδενικά και χωρίς
 * διαχωριστικό χιλιάδων (1500, όχι 1.500, για να μη μπερδεύεται με δεκαδικό).
 * Πολύ μικρές μη μηδενικές τιμές κρατούν 2 σημαντικά ψηφία αντί να γράφουν 0.
 */
export function formatNumber(x: number, maxDecimals = 2): string {
  if (!Number.isFinite(x)) return '—';
  const ax = Math.abs(x);
  let decimals = maxDecimals;
  if (ax > 0 && ax < 10 ** -maxDecimals) {
    decimals = Math.min(10, Math.ceil(-Math.log10(ax)) + 1);
  }
  const f = 10 ** decimals;
  // Η μικρή διόρθωση αντισταθμίζει δυαδικά σφάλματα (π.χ. 1,005 → 1,01).
  let r = Math.round(x * f + (x >= 0 ? 1e-7 : -1e-7)) / f;
  if (r === 0) r = 0; // όχι "-0"
  let s = r.toFixed(decimals);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s.replace('.', ',');
}

export type ParseResult = { ok: true; value: number } | { ok: false; message: string };

/** Δέχεται και κόμμα και τελεία ως δεκαδικό διαχωριστικό· πρόσημο μόνο με allowNegative. */
export function parseDecimal(input: string, allowNegative = false): ParseResult {
  const s = input.trim().replace(',', '.').replace('−', '-');
  if (s === '') return { ok: false, message: 'Συμπλήρωσε τιμή.' };
  const pattern = allowNegative ? /^[+-]?(\d+(\.\d*)?|\.\d+)$/ : /^\+?(\d+(\.\d*)?|\.\d+)$/;
  if (!pattern.test(s)) {
    return { ok: false, message: 'Δεν είναι έγκυρος αριθμός (π.χ. 12 ή 12,5).' };
  }
  return { ok: true, value: Number(s) };
}

export const decimalsOf = (input: string): number => {
  const s = input.trim().replace(',', '.');
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
};
