import { useRef } from 'react';
import { formatNumber } from '../lib/format';
import type { RawModel } from '../io/loadModel';
import { formatMb } from '../io/loadModel';
import { IDENTITY, mulMat3, orientedSize, rot90, type Mat3, type PreparedModel } from '../io/meshTools';
import { UNITS, type UpAxis, type Unit } from '../io/units';

export interface LoadedFile {
  raw: RawModel;
  prepared: PreparedModel;
}

export interface FileOptions {
  unit: Unit | null;
  up: UpAxis | null;
  rotation: Mat3;
  confirmed: boolean;
}

interface Props {
  file: LoadedFile | null;
  options: FileOptions;
  loadingName: string | null;
  error: { message: string; detail?: string } | null;
  onFiles: (files: File[]) => void;
  /** Αλλαγή επιλογών με βάση την πιο πρόσφατη κατάσταση (ασφαλές και σε γρήγορα διαδοχικά πατήματα). */
  onChange: (patch: (o: FileOptions) => Partial<FileOptions>) => void;
  onClose: () => void;
}

const FORMAT_LABEL = { glb: 'GLB', gltf: 'glTF', stl: 'STL', obj: 'OBJ' } as const;

const dims = (v: number[]) => v.map((x) => formatNumber(x)).join(' × ');

export function FilePicker({ onFiles, compact = false }: { onFiles: (files: File[]) => void; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className={`drop-zone${compact ? ' compact' : ''}`}>
      {!compact && <p className="drop-title">Σύρε εδώ ένα αρχείο 3D ή</p>}
      <button type="button" className="primary-button" onClick={() => input.current?.click()}>
        {compact ? 'Άνοιγμα άλλου αρχείου' : 'Επιλογή αρχείου'}
      </button>
      {/* Χωρίς φίλτρο τύπων: στο iPhone το φίλτρο συχνά «γκριζάρει» τα .stl/.obj. Ελέγχουμε μετά. */}
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) onFiles(files);
        }}
      />
      {!compact && (
        <p className="hint">
          GLB, glTF, STL, OBJ · έως 100 MB. Για .gltf επίλεξε μαζί και τα .bin του. Το αρχείο ανοίγει μόνο στη
          συσκευή σου, δεν ανεβαίνει πουθενά.
        </p>
      )}
    </div>
  );
}

export function FilePanel({ file, options, loadingName, error, onFiles, onChange, onClose }: Props) {
  const set = (patch: Partial<FileOptions>) => onChange(() => patch);
  const isGltf = file && (file.raw.format === 'glb' || file.raw.format === 'gltf');
  const ready = options.unit !== null && options.up !== null;

  return (
    <div className="file-panel">
      {!file && !loadingName && <FilePicker onFiles={onFiles} />}

      {loadingName && (
        <p className="loading" role="status">
          <span className="spinner" aria-hidden="true" /> Φόρτωση «{loadingName}»…
        </p>
      )}

      {error && (
        <div className="issues" role="alert">
          <p>{error.message}</p>
          {error.detail && (
            <details>
              <summary>Τεχνικές λεπτομέρειες</summary>
              <code>{error.detail}</code>
            </details>
          )}
        </div>
      )}

      {file && (
        <>
          <div className="file-summary">
            <strong title={file.raw.name}>{file.raw.name}</strong>
            <span>
              {FORMAT_LABEL[file.raw.format]} · {formatMb(file.raw.sizeBytes)} ·{' '}
              {file.prepared.stats.triangles.toLocaleString('el-GR')} τρίγωνα
            </span>
            {(file.prepared.stats.boundaryEdges > 0 || file.prepared.stats.nonManifoldEdges > 0) && (
              <p className="warning">
                Το πλέγμα δεν είναι κλειστό ({file.prepared.stats.boundaryEdges.toLocaleString('el-GR')} ανοιχτές
                ακμές). Οι διαστάσεις ισχύουν, αλλά μπορεί να φαίνονται επιπλέον γραμμές.
              </p>
            )}
          </div>

          <fieldset className="file-step">
            <legend>1. Μονάδα του αρχείου</legend>
            <div className="segmented" role="radiogroup" aria-label="Μονάδα του αρχείου">
              {UNITS.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  role="radio"
                  aria-checked={options.unit === u.id}
                  onClick={() => set({ unit: u.id })}
                >
                  {u.label}
                </button>
              ))}
            </div>
            <p className="hint">
              {isGltf
                ? 'Το πρότυπο glTF ορίζει μέτρα, γι’ αυτό προεπιλέχθηκε «m». Άλλαξέ το αν το αρχείο φτιάχτηκε αλλιώς.'
                : 'Τα STL και OBJ δεν γράφουν μονάδα. Διάλεξε αυτή με την οποία σχεδιάστηκε το κομμάτι.'}{' '}
              Οι διαστάσεις που θα προκύψουν σε κάθε περίπτωση:
            </p>
            <table className="unit-table">
              <tbody>
                {UNITS.map((u) => (
                  <tr key={u.id} className={options.unit === u.id ? 'selected' : undefined}>
                    <th>αν {u.label}</th>
                    <td>
                      {dims(
                        orientedSize(file.prepared.rawBox, { unit: u.id, up: options.up ?? 'Z', rotation: options.rotation }),
                      )}{' '}
                      mm
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </fieldset>

          <fieldset className="file-step">
            <legend>2. Ποιος άξονας είναι «πάνω»</legend>
            <div className="segmented" role="radiogroup" aria-label="Πάνω άξονας">
              {(['Y', 'Z'] as const).map((a) => (
                <button key={a} type="button" role="radio" aria-checked={options.up === a} onClick={() => set({ up: a })}>
                  {a} πάνω
                </button>
              ))}
            </div>
            <p className="hint">
              {isGltf
                ? 'Το glTF ορίζει τον Y προς τα πάνω, γι’ αυτό προεπιλέχθηκε.'
                : 'Διαφέρει ανάμεσα σε προγράμματα σχεδίασης. Δες στο 3D ποια επιλογή στέκει σωστά το κομμάτι.'}
            </p>
          </fieldset>

          <fieldset className="file-step">
            <legend>3. Περιστροφή 90° (αν χρειάζεται)</legend>
            <div className="rotate-buttons">
              {(['X', 'Y', 'Z'] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  className="secondary-button"
                  onClick={() => onChange((o) => ({ rotation: mulMat3(rot90(a), o.rotation) }))}
                >
                  ↻ γύρω από {a}
                </button>
              ))}
              <button type="button" className="link-button" onClick={() => set({ rotation: IDENTITY })}>
                Επαναφορά
              </button>
            </div>
            <p className="hint">Με τον Z διαλέγεις ποια πλευρά του κομματιού είναι η πρόσοψη.</p>
          </fieldset>

          {!options.confirmed ? (
            <div className="confirm-row">
              <button type="button" className="primary-button" disabled={!ready} onClick={() => set({ confirmed: true })}>
                Επιβεβαίωση
              </button>
              {!ready && <span className="hint">Διάλεξε μονάδα και πάνω άξονα.</span>}
            </div>
          ) : (
            <div className="confirmed">
              <p>
                ✓ Επιβεβαιώθηκε: <strong>{options.unit}</strong>, <strong>{options.up} πάνω</strong>. Οι αλλαγές
                εφαρμόζονται αμέσως.
              </p>
              <dl className="info">
                {(['Μήκος (X)', 'Βάθος (Y)', 'Ύψος (Z)'] as const).map((label, i) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>
                      {formatNumber(
                        orientedSize(file.prepared.rawBox, { unit: options.unit!, up: options.up!, rotation: options.rotation })[i],
                      )}{' '}
                      mm
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          <p className="hint">
            Οι διαστάσεις μετρώνται από το κουτί που περικλείει το κομμάτι, ευθυγραμμισμένο με τους άξονες. Αν το
            κομμάτι είναι στραβά μέσα στο αρχείο, βγαίνουν μεγαλύτερες από τις πραγματικές.
          </p>

          <div className="file-actions">
            <FilePicker onFiles={onFiles} compact />
            <button type="button" className="link-button" onClick={onClose}>
              Κλείσιμο αρχείου
            </button>
          </div>
        </>
      )}
    </div>
  );
}
