import { formatNumber, parseDecimal } from '../lib/format';
import type { Issue, Part, TemplateDef, Toggles, Values } from './types';

export const MAX_MM = 100000;

export interface Evaluation {
  /** Τιμές σε mm (μαζί με τις αυτόματες των κλειδωμένων πεδίων). */
  values: Values;
  locked: Set<string>;
  fieldErrors: Record<string, string>;
  issues: Issue[];
  part: Part | null;
}

export const defaultInputs = (t: TemplateDef): Record<string, string> =>
  Object.fromEntries(t.params.map((p) => [p.key, formatNumber(p.defaultValue)]));

export const defaultToggles = (t: TemplateDef): Toggles =>
  Object.fromEntries((t.toggles ?? []).map((tg) => [tg.key, tg.defaultValue]));

export function evaluate(t: TemplateDef, inputs: Record<string, string>, toggles: Toggles): Evaluation {
  const locked = new Set(
    Object.entries(t.lockedBy ?? {})
      .filter(([, toggle]) => toggles[toggle])
      .map(([key]) => key),
  );
  const values: Values = {};
  const fieldErrors: Record<string, string> = {};

  for (const p of t.params) {
    if (locked.has(p.key)) continue;
    const parsed = parseDecimal(inputs[p.key] ?? '', p.signed);
    if (!parsed.ok) fieldErrors[p.key] = parsed.message;
    else if (!p.signed && parsed.value <= 0) fieldErrors[p.key] = 'Πρέπει να είναι μεγαλύτερο από 0.';
    else if (Math.abs(parsed.value) > MAX_MM) fieldErrors[p.key] = `Πολύ μεγάλη τιμή (μέγιστο ${MAX_MM} mm).`;
    else values[p.key] = parsed.value === 0 ? 0 : parsed.value;
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { values, locked, fieldErrors, issues: [], part: null };
  }

  Object.assign(values, t.computed?.(values, toggles) ?? {});
  const issues = t.validate(values, toggles);
  const part = issues.length === 0 ? t.build(values, toggles) : null;
  return { values, locked, fieldErrors, issues, part };
}
