import { useEffect, useMemo, useRef, useState } from 'react';
import { edgeTopology } from '../drawing/hlr';
import { computeSheetViews, sheetSvg, suggestedScale, type TitleFields } from '../drawing/sheet';
import type { Scale } from '../lib/scale';
import type { Part } from '../model/types';
import type { ProjectionAngle } from './ProjectionSymbol';

/** Πάνω από αυτό ο υπολογισμός κρυφών γραμμών γίνεται πολύ αργός σε κινητό: δεν σχεδιάζουμε. */
export const MAX_SHEET_TRIANGLES = 200_000;

// Τα σταθερά πεδία του πινακιδίου μένουν στη συσκευή για το επόμενο σχέδιο.
const FIELDS_KEY = 'opseis3d:titleblock';
type SavedFields = Pick<TitleFields, 'author' | 'section' | 'classroom' | 'drawingNo' | 'school'>;
function loadFields(): SavedFields {
  const empty = { author: '', section: '', classroom: '', drawingNo: '', school: '' };
  try {
    const v = JSON.parse(localStorage.getItem(FIELDS_KEY) ?? 'null');
    return v && typeof v === 'object' ? { ...empty, ...Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'string')) } : empty;
  } catch {
    return empty;
  }
}

function saveFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** PNG σε 300 dpi, με τις διαστάσεις χαρτιού του SVG (A3: 3508 × 4961). */
async function svgToPng(svg: string): Promise<Blob> {
  const [, , wMm, hMm] = svg.match(/viewBox="([^"]+)"/)![1].split(/\s+/).map(Number);
  const W = Math.round((wMm / 25.4) * 300);
  const H = Math.round((hMm / 25.4) * 300);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(img, 0, 0, W, H);
    return await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('PNG'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

const DOWNLOADS = [
  { kind: 'pdf', note: 'Για εκτύπωση σε A3' },
  { kind: 'png', note: 'Εικόνα 300 dpi' },
  { kind: 'svg', note: 'Διανυσματικό, για επεξεργασία' },
] as const;

interface Props {
  part: Part | null;
  /** Γιατί δεν υπάρχει φύλλο (π.χ. ανεπιβεβαίωτο αρχείο). */
  blockedReason?: string;
  projection: ProjectionAngle;
  openMesh: boolean;
  fileName: string;
  /** Κλίμακα σχεδίου: μέγεθος των όψεων στο χαρτί· οι αριθμοί μένουν πραγματικοί. */
  scale: Scale;
  /** Καλείται με την προτεινόμενη κλίμακα (μεγαλύτερη που χωρά στο A3) όταν ανοίγει το φύλλο. */
  onSuggestedScale?: (s: Scale) => void;
  title: string;
}

export function SheetView({ part, blockedReason, projection, openMesh, fileName, scale, onSuggestedScale, title }: Props) {
  const [projectionLines, setProjectionLines] = useState(true);
  const [showDims, setShowDims] = useState(true);
  const [layout, setLayout] = useState<'quadrants' | 'standard'>('quadrants');
  const [saved, setSaved] = useState<SavedFields>(loadFields);
  const [titleOverride, setTitleOverride] = useState('');
  const today = useMemo(() => new Date().toLocaleDateString('el-GR'), []);
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [tbOpen, setTbOpen] = useState(false);
  // Μενού «Λήψη»: κλείνει με κλικ έξω ή Esc.
  const [dlOpen, setDlOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!dlOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setDlOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDlOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [dlOpen]);
  useEffect(() => {
    try {
      localStorage.setItem(FIELDS_KEY, JSON.stringify(saved));
    } catch {
      // χωρίς αποθήκευση
    }
  }, [saved]);
  useEffect(() => {
    if (part && onSuggestedScale) onSuggestedScale(suggestedScale(part, projection, layout));
  }, [part, projection, layout, onSuggestedScale]);
  const fields: TitleFields = { title: titleOverride || title, date, ...saved };
  const triangles = part ? part.triangles.length / 9 : 0;
  const tooBig = triangles > MAX_SHEET_TRIANGLES;

  const topo = useMemo(() => (part && !tooBig ? edgeTopology(part.triangles) : null), [part, tooBig]);
  const views = useMemo(
    () => (part && topo ? computeSheetViews(part, projection, topo) : null),
    [part, topo, projection],
  );
  const fieldsKey = JSON.stringify(fields);
  const sheet = useMemo(
    () => (views && part ? sheetSvg(views, part, { projection, projectionLines, showDims, layout, scale, fields: JSON.parse(fieldsKey) }) : null),
    [views, part, projection, projectionLines, showDims, layout, scale, fieldsKey],
  );
  const svg = sheet?.svg ?? null;

  const exportAs = async (kind: 'svg' | 'pdf' | 'png') => {
    if (!svg) return;
    setExportError(null);
    setBusy(kind);
    try {
      if (kind === 'svg') {
        saveFile(new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${svg}`], { type: 'image/svg+xml' }), `hvacplan-${fileName}.svg`);
      } else if (kind === 'pdf') {
        const [{ svgToPdf }, { loadPdfFonts }] = await Promise.all([import('../drawing/pdf'), import('../drawing/fonts')]);
        const bytes = svgToPdf(svg, await loadPdfFonts(), fields.title);
        saveFile(new Blob([bytes as BlobPart], { type: 'application/pdf' }), `hvacplan-${fileName}.pdf`);
      } else {
        saveFile(await svgToPng(svg), `hvacplan-${fileName}.png`);
      }
    } catch (e) {
      setExportError(`Η εξαγωγή ${kind.toUpperCase()} απέτυχε: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };
  const field = (label: string, value: string, set: (v: string) => void, placeholder = '') => (
    <label className="tb-field">
      <span>{label}</span>
      <input type="text" value={value} placeholder={placeholder} onChange={(e) => set(e.target.value)} />
    </label>
  );

  let message: string | null = null;
  if (blockedReason) message = blockedReason;
  else if (tooBig)
    message = `Το μοντέλο έχει ${triangles.toLocaleString('el-GR')} τρίγωνα. Για φύλλο όψεων με κρυφές γραμμές το όριο είναι ${MAX_SHEET_TRIANGLES.toLocaleString('el-GR')}· δεν σχεδιάζεται, για να μη βγει λάθος ή να «κολλήσει» η συσκευή.`;

  return (
    <div className="sheet-pane">
      <div className="sheet-scroll">
        {message ? (
          <p className="sheet-message">{message}</p>
        ) : (
          // Το SVG παράγεται από τον δικό μας κώδικα· τα κείμενα του χρήστη μπαίνουν με διαφυγή (esc).
          <div className="sheet-page" dangerouslySetInnerHTML={{ __html: svg ?? '' }} />
        )}
      </div>
      <div className="sheet-toolbar">
        <div className="sheet-options" role="group" aria-label="Επιλογές φύλλου">
          <button type="button" className="pill" aria-pressed={projectionLines} onClick={() => setProjectionLines((v) => !v)}>
            Γραμμές προβολής
          </button>
          <button type="button" className="pill" aria-pressed={showDims} onClick={() => setShowDims((v) => !v)}>
            Διαστάσεις
          </button>
          <div className="segmented layout-switch" role="radiogroup" aria-label="Διάταξη όψεων">
            {(
              [
                ['quadrants', '2×2'],
                ['standard', 'Standard'],
              ] as const
            ).map(([id, label]) => (
              <button key={id} type="button" role="radio" aria-checked={layout === id} onClick={() => setLayout(id)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="sheet-actions">
          {!message && (
            <button
              type="button"
              className={`secondary-button with-chevron${tbOpen ? ' open' : ''}`}
              aria-expanded={tbOpen}
              aria-controls="title-block-form"
              onClick={() => setTbOpen((o) => !o)}
            >
              Υπόμνημα <span className="chevron" aria-hidden="true">▾</span>
            </button>
          )}
          <div className="menu-wrap" ref={menuRef}>
            <button
              type="button"
              className={`primary-button with-chevron${dlOpen ? ' open' : ''}`}
              aria-haspopup="menu"
              aria-expanded={dlOpen}
              disabled={!svg || !!message || !!busy}
              onClick={() => setDlOpen((o) => !o)}
            >
              {busy ? `Ετοιμασία ${busy.toUpperCase()}…` : 'Λήψη'} <span className="chevron" aria-hidden="true">▾</span>
            </button>
            {dlOpen && (
              <div className="menu" role="menu" aria-label="Λήψη φύλλου">
                {DOWNLOADS.map((d) => (
                  <button
                    key={d.kind}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setDlOpen(false);
                      void exportAs(d.kind);
                    }}
                  >
                    <strong>{d.kind.toUpperCase()}</strong>
                    <small>{d.note}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {(exportError || (!message && (openMesh || (sheet?.warnings.length ?? 0) > 0))) && (
        <div className="sheet-warnings">
          {openMesh && !message && <p className="warning">Κρυφές γραμμές ίσως μη ακριβείς για ανοιχτά πλέγματα.</p>}
          {!message &&
            sheet?.warnings.map((w) => (
              <p key={w} className="warning">
                {w}
              </p>
            ))}
          {exportError && <p className="warning">{exportError}</p>}
        </div>
      )}

      {!message && (
        <div id="title-block-form" className={`collapsible title-block-form${tbOpen ? ' open' : ''}`} inert={!tbOpen}>
          <div className="collapsible-inner">
            <div className="tb-grid">
              {field('Θέμα', titleOverride, setTitleOverride, title)}
              {field('Όνομα', saved.author, (v) => setSaved((s) => ({ ...s, author: v })))}
              {field('Τμήμα', saved.section, (v) => setSaved((s) => ({ ...s, section: v })))}
              {field('Τάξη', saved.classroom, (v) => setSaved((s) => ({ ...s, classroom: v })))}
              {field('Αρ. σχεδίου', saved.drawingNo, (v) => setSaved((s) => ({ ...s, drawingNo: v })))}
              {field('Σχολή', saved.school, (v) => setSaved((s) => ({ ...s, school: v })))}
              {field('Ημερομηνία', date, setDate)}
            </div>
            <p className="hint">Η κλίμακα μπαίνει αυτόματα από τις ρυθμίσεις.</p>
          </div>
        </div>
      )}
    </div>
  );
}
