import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

// Κλείδωμα του φύλλου όψεων με κωδικό (για τον καθηγητή). Κρατάμε μόνο το SHA-256 του κωδικού,
// όχι τον ίδιο. Το ξεκλείδωμα ζει μόνο στη μνήμη της σελίδας: με ανανέωση ζητείται ξανά.
// Προσοχή: σε στατική σελίδα αυτό είναι εμπόδιο για τον απλό χρήστη, όχι πραγματική ασφάλεια.
const CODE_SHA256 = 'db7eb52714449e148c378b901c5717bf0959ae28e1eae3c0d5133e8421cd944d';

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

interface Props {
  onUnlock: () => void;
  onCancel: () => void;
}

export function SheetLock({ onUnlock, onCancel }: Props) {
  const [code, setCode] = useState('');
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const submit = async () => {
    setChecking(true);
    const ok = (await sha256(code.trim())) === CODE_SHA256;
    setChecking(false);
    if (ok) onUnlock();
    else {
      setError(true);
      setCode('');
      inputRef.current?.focus();
    }
  };

  return (
    <div className="lock-backdrop" role="presentation" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form
        className="lock-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lock-title"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="lock-icon">
          <Icon name="lock" size={26} />
        </div>
        <h2 id="lock-title">Φύλλο όψεων</h2>
        <p className="hint">Το φύλλο όψεων ανοίγει μόνο με τον κωδικό του καθηγητή.</p>
        <input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          placeholder="Κωδικός"
          aria-label="Κωδικός"
          aria-invalid={error}
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setError(false);
          }}
        />
        {error && <p className="field-error">Λάθος κωδικός.</p>}
        <div className="lock-actions">
          <button type="button" className="secondary-button" onClick={onCancel}>
            Άκυρο
          </button>
          <button type="submit" className="primary-button" disabled={!code || checking}>
            Άνοιγμα
          </button>
        </div>
      </form>
    </div>
  );
}
