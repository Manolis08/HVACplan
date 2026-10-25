import { useEffect, useMemo, useState } from 'react';
import { edgeTopology } from '../drawing/hlr';
import { computeSheetViews, sheetSvg, type TitleFields } from '../drawing/sheet';
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

interface Props {
  part: Part | null;
  /** Γιατί δεν υπάρχει φύλλο (π.χ. ανεπιβεβαίωτο αρχείο). */
  blockedReason?: string;
  projection: ProjectionAngle;
  openMesh: boolean;
  fileName: string;
  /** Κλίμακα σχεδίου: μέγεθος των όψεων στο χαρτί· οι αριθμοί μένουν πραγματικοί. */
  scale: Scale;
  title: string;
}

export function SheetView({ part, blockedReason, projection, openMesh, fileName, scale, title }: Props) {
  const [projectionLines, setProjectionLines] = useState(true);
  const [showDims, setShowDims] = useState(true);
  const [layout, setLayout] = useState<'quadrants' | 'standard'>('quadrants');
  const [saved, setSaved] = useState<SavedFields>(loadFields);
  const [titleOverride, setTitleOverride] = useState('');
  const today = useMemo(() => new Date().toLocaleDateString('el-GR'), []);
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  useEffect(() => {
    try {
      localStorage.setItem(FIELDS_KEY, JSON.stringify(saved));
    } catch {
      // χωρίς αποθήκευση
    }
  }, [saved]);
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
        <label className="toggle compact">
          <input type="checkbox" checked={projectionLines} onChange={(e) => setProjectionLines(e.target.checked)} />
          <span>Γραμμές προβολής</span>
        </label>
        <label className="toggle compact">
          <input type="checkbox" checked={showDims} onChange={(e) => setShowDims(e.target.checked)} />
          <span>Διαστάσεις</span>
        </label>
        <button
          type="button"
          className="secondary-button"
          aria-pressed={layout === 'quadrants'}
          onClick={() => setLayout((l) => (l === 'standard' ? 'quadrants' : 'standard'))}
        >
          Layout: {layout === 'standard' ? 'Standard' : '2×2'}
        </button>
        {openMesh && !message && <span className="warning inline">Κρυφές γραμμές ίσως μη ακριβείς για ανοιχτά πλέγματα.</span>}
        {!message &&
          sheet?.warnings.map((w) => (
            <span key={w} className="warning inline">
              {w}
            </span>
          ))}
        {exportError && <span className="warning inline">{exportError}</span>}
        <div className="export-buttons">
          {(['pdf', 'png', 'svg'] as const).map((k) => (
            <button
              key={k}
              type="button"
              className={k === 'pdf' ? 'primary-button' : 'secondary-button'}
              disabled={!svg || !!message || !!busy}
              onClick={() => void exportAs(k)}
            >
              {busy === k ? 'Ετοιμασία…' : `Λήψη ${k.toUpperCase()}`}
            </button>
          ))}
        </div>
      </div>
      {!message && (
        <details className="title-block-form">
          <summary>Υπόμνημα</summary>
          <div className="tb-grid">
            {field('Θέμα', titleOverride, setTitleOverride, title)}
            {field('Όνομα', saved.author, (v) => setSaved((s) => ({ ...s, author: v })))}
            {field('Τμήμα', saved.section, (v) => setSaved((s) => ({ ...s, section: v })))}
            {field('Τάξη', saved.classroom, (v) => setSaved((s) => ({ ...s, classroom: v })))}
            {field('Αρ. σχεδίου', saved.drawingNo, (v) => setSaved((s) => ({ ...s, drawingNo: v })))}
            {field('Σχολή', saved.school, (v) => setSaved((s) => ({ ...s, school: v })))}
            {field('Ημερομηνία', date, setDate)}
          </div>
          <p className="hint">Η κλίμακα και η γωνία προβολής μπαίνουν αυτόματα από τις ρυθμίσεις.</p>
        </details>
      )}
    </div>
  );
}
