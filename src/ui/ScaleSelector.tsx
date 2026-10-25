import { useRef, useState } from 'react';
import { decimalsOf, formatNumber, parseDecimal } from '../lib/format';
import {
  isPreset,
  SCALE_N_MAX,
  SCALE_N_MIN,
  SCALE_PRESETS,
  scaleHint,
  scaleKey,
  scaleLabel,
  type Scale,
} from '../lib/scale';

interface Props {
  value: Scale;
  onChange: (s: Scale) => void;
}

const CUSTOM = 'custom';

export function ScaleSelector({ value, onChange }: Props) {
  const [custom, setCustom] = useState(!isPreset(value));
  const [kind, setKindState] = useState<Scale['kind']>(value.kind);
  const [nText, setNTextState] = useState(formatNumber(value.n));
  // Τρέχουσες τιμές και σε διαδοχικά γεγονότα πριν την επόμενη απόδοση.
  const latest = useRef({ kind: value.kind, nText: formatNumber(value.n) });
  const setKind = (k: Scale['kind']) => {
    latest.current.kind = k;
    setKindState(k);
  };
  const setNText = (t: string) => {
    latest.current.nText = t;
    setNTextState(t);
  };
  const [error, setError] = useState<string | null>(null);

  const applyCustom = (k: Scale['kind'], text: string) => {
    const parsed = parseDecimal(text);
    if (!parsed.ok) return setError(parsed.message);
    if (parsed.value < SCALE_N_MIN || parsed.value > SCALE_N_MAX)
      return setError(`Δώσε αριθμό από ${SCALE_N_MIN} έως ${SCALE_N_MAX}.`);
    if (decimalsOf(text) > 2) return setError('Έως 2 δεκαδικά ψηφία.');
    setError(null);
    onChange({ kind: k, n: parsed.value });
  };

  return (
    <div className="scale-selector">
      <label htmlFor="scale-select" className="sr-only">
        Κλίμακα
      </label>
      <select
        id="scale-select"
        value={custom ? CUSTOM : scaleKey(value)}
        onChange={(e) => {
          if (e.target.value === CUSTOM) {
            setCustom(true);
            setKind(value.kind);
            setNText(formatNumber(value.n));
            return;
          }
          setCustom(false);
          setError(null);
          onChange(SCALE_PRESETS.find((s) => scaleKey(s) === e.target.value)!);
        }}
      >
        {SCALE_PRESETS.map((s) => (
          <option key={scaleKey(s)} value={scaleKey(s)}>
            {scaleLabel(s)}
            {s.n === 1 ? ' (φυσικό μέγεθος)' : s.kind === 'enlarge' ? ' (μεγέθυνση)' : ' (σμίκρυνση)'}
          </option>
        ))}
        <option value={CUSTOM}>Ελεύθερη τιμή…</option>
      </select>

      {custom && (
        <div className="custom-scale">
          <div className="segmented" role="radiogroup" aria-label="Είδος κλίμακας">
            {(['enlarge', 'reduce'] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => {
                  setKind(k);
                  applyCustom(k, latest.current.nText);
                }}
              >
                {k === 'enlarge' ? 'n:1 μεγέθυνση' : '1:n σμίκρυνση'}
              </button>
            ))}
          </div>
          <div className="custom-n">
            {kind === 'reduce' && <span>1 :</span>}
            <input
              aria-label="Τιμή n"
              type="text"
              inputMode="decimal"
              value={nText}
              aria-invalid={!!error}
              onChange={(e) => {
                setNText(e.target.value);
                applyCustom(latest.current.kind, e.target.value);
              }}
            />
            {kind === 'enlarge' && <span>: 1</span>}
          </div>
          {error && <p className="field-error">{error}</p>}
        </div>
      )}

      <p className="hint">
        Τώρα: <strong>{scaleLabel(value)}</strong> — {scaleHint(value)}. Η κλίμακα αλλάζει μόνο τους αριθμούς
        των διαστάσεων, ποτέ το σχήμα ή το μέγεθος στην οθόνη.
      </p>
    </div>
  );
}
