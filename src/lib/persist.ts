import { TEMPLATES } from '../model/templates';
import type { Toggles } from '../model/types';
import type { ProjectionAngle } from '../ui/ProjectionSymbol';
import type { DimsMode } from '../viewer/dimLayout';
import { ONE_TO_ONE, SCALE_N_MAX, SCALE_N_MIN, type Scale } from './scale';

// Τοπική αποθήκευση στη συσκευή (μόνο για ευκολία· η εφαρμογή δουλεύει και χωρίς αυτήν).
const KEY = 'opseis3d:v1';

export interface SavedState {
  templateId: string;
  inputs: Record<string, Record<string, string>>;
  toggles: Record<string, Toggles>;
  /** Κλίμακα του 3D ανά σχήμα (id προτύπου ή «file:όνομα»)· όσα λείπουν είναι 1:1. */
  viewerScales: Record<string, Scale>;
  /** Κλίμακα του φύλλου όψεων ανά σχήμα. manual: την άλλαξε ο χρήστης, άρα μένει. */
  sheetScales: Record<string, ShapeScale>;
  projection: ProjectionAngle;
  dimsMode: DimsMode;
  /** Σειρά των έτοιμων σχημάτων (ids) όπως την όρισε ο χρήστης με σύρσιμο. */
  templateOrder: string[];
  /** Ονόματα που έδωσε ο χρήστης στα έτοιμα σχήματα (id → όνομα). */
  templateNames: Record<string, string>;
}

export interface ShapeScale {
  scale: Scale;
  manual: boolean;
}

const isScale = (s: unknown): s is Scale =>
  isRecord(s) && (s.kind === 'enlarge' || s.kind === 'reduce') && typeof s.n === 'number' && s.n >= SCALE_N_MIN && s.n <= SCALE_N_MAX;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function loadState(): Partial<SavedState> {
  let raw: unknown;
  try {
    raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
  } catch {
    return {};
  }
  if (!isRecord(raw)) return {};
  const out: Partial<SavedState> = {};
  if (typeof raw.templateId === 'string' && TEMPLATES.some((t) => t.id === raw.templateId)) out.templateId = raw.templateId;
  if (isRecord(raw.inputs)) {
    out.inputs = {};
    for (const [tid, vals] of Object.entries(raw.inputs)) {
      if (!isRecord(vals)) continue;
      out.inputs[tid] = Object.fromEntries(Object.entries(vals).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
    }
  }
  if (isRecord(raw.toggles)) {
    out.toggles = {};
    for (const [tid, vals] of Object.entries(raw.toggles)) {
      if (!isRecord(vals)) continue;
      out.toggles[tid] = Object.fromEntries(Object.entries(vals).filter(([, v]) => typeof v === 'boolean')) as Toggles;
    }
  }
  if (isRecord(raw.viewerScales)) {
    out.viewerScales = {};
    for (const [key, v] of Object.entries(raw.viewerScales)) if (isScale(v)) out.viewerScales[key] = { kind: v.kind, n: v.n };
  }
  if (isRecord(raw.sheetScales)) {
    out.sheetScales = {};
    for (const [key, v] of Object.entries(raw.sheetScales)) {
      if (isRecord(v) && isScale(v.scale) && typeof v.manual === 'boolean')
        out.sheetScales[key] = { scale: { kind: v.scale.kind, n: v.scale.n }, manual: v.manual };
    }
  }
  if (raw.projection === 'first' || raw.projection === 'third') out.projection = raw.projection;
  if (raw.dimsMode === 'all' || raw.dimsMode === 'overall' || raw.dimsMode === 'none') out.dimsMode = raw.dimsMode;
  if (Array.isArray(raw.templateOrder)) out.templateOrder = raw.templateOrder.filter((x): x is string => typeof x === 'string');
  if (isRecord(raw.templateNames))
    out.templateNames = Object.fromEntries(
      Object.entries(raw.templateNames).filter(([, v]) => typeof v === 'string' && v.trim() !== ''),
    ) as Record<string, string>;
  return out;
}

export function saveState(state: SavedState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // ιδιωτική περιήγηση ή γεμάτος χώρος: απλώς δεν θυμόμαστε
  }
}

export const DEFAULT_SCALE = ONE_TO_ONE;
