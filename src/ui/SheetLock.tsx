import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

// Κλείδωμα του φύλλου όψεων με κωδικό (για τον καθηγητή). Ο κωδικός δεν υπάρχει στον κώδικα: κρατάμε
// μόνο ένα «αργό» αποτύπωμά του (PBKDF2-SHA256 με τυχαίο αλάτι και 310,000 επαναλήψεις), ώστε να μη
// βρίσκεται δοκιμάζοντας όλους τους συνδυασμούς. Μετά από λάθος προσπάθειες ο έλεγχος περιμένει όλο και
// περισσότερο. Το ξεκλείδωμα ζει μόνο στη μνήμη της σελίδας: με ανανέωση ζητείται ξανά.
// Προσοχή: σε στατική σελίδα αυτό είναι εμπόδιο για τον απλό χρήστη, όχι πραγματική ασφάλεια.
const CODE_SALT = '8539d46b8c97c51294f3749b15e135f2';
const CODE_ITERATIONS = 310000;
const CODE_HASH = '4128a020aa9019077b82568745af38f08f56a85a7841c6d9c23286d60ec31603';
/** Μέχρι πόσες λάθος προσπάθειες χωρίς αναμονή· μετά, αναμονή που διπλασιάζεται (έως 5 λεπτά). */
const FREE_TRIES = 3;
const MAX_WAIT_MS = 5 * 60_000;
const TRIES_KEY = 'opseis3d:lock-tries';

const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (h: string) => new Uint8Array(h.match(/../g)!.map((x) => parseInt(x, 16)));

async function deriveHash(code: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(CODE_SALT), iterations: CODE_ITERATIONS },
    key,
    256,
  );
  return hex(bits);
}

/** Σύγκριση σταθερού χρόνου (να μη φανερώνει πόσοι χαρακτήρες ταιριάζουν). */
function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** Λάθος προσπάθειες: κρατιούνται στη συσκευή, ώστε η ανανέωση της σελίδας να μη μηδενίζει την αναμονή. */
function loadTries(): { count: number; until: number } {
  try {
    const v = JSON.parse(localStorage.getItem(TRIES_KEY) ?? 'null');
    if (v && typeof v.count === 'number' && typeof v.until === 'number') return v;
  } catch {
    // τίποτα αποθηκευμένο
  }
  return { count: 0, until: 0 };
}
function saveTries(t: { count: number; until: number } | null) {
  try {
    if (t) localStorage.setItem(TRIES_KEY, JSON.stringify(t));
    else localStorage.removeItem(TRIES_KEY);
  } catch {
    // χωρίς αποθήκευση
  }
}

interface Props {
  onUnlock: () => void;
  onCancel: () => void;
}

export function SheetLock({ onUnlock, onCancel }: Props) {
  const [code, setCode] = useState('');
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);
  const [waitUntil, setWaitUntil] = useState(() => loadTries().until);
  const [now, setNow] = useState(() => Date.now());
  const waitSec = Math.max(0, Math.ceil((waitUntil - now) / 1000));
  useEffect(() => {
    if (waitUntil <= Date.now()) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [waitUntil]);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const submit = async () => {
    if (Date.now() < loadTries().until) return;
    const entered = code.trim().slice(0, 64);
    setChecking(true);
    const ok = sameHash(await deriveHash(entered), CODE_HASH);
    setChecking(false);
    if (ok) {
      saveTries(null);
      onUnlock();
      return;
    }
    const t = loadTries();
    const count = t.count + 1;
    const wait = count > FREE_TRIES ? Math.min(MAX_WAIT_MS, 15_000 * 2 ** (count - FREE_TRIES - 1)) : 0;
    const next = { count, until: Date.now() + wait };
    saveTries(next);
    setWaitUntil(next.until);
    setNow(Date.now());
    setError(true);
    setCode('');
    inputRef.current?.focus();
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
          maxLength={64}
          aria-invalid={error}
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setError(false);
          }}
        />
        {error && <p className="field-error">Λάθος κωδικός.</p>}
        {waitSec > 0 && (
          <p className="field-error" role="status">
            Πολλές λάθος προσπάθειες. Δοκίμασε ξανά σε {waitSec} δευτ.
          </p>
        )}
        <div className="lock-actions">
          <button type="button" className="secondary-button" onClick={onCancel}>
            Άκυρο
          </button>
          <button type="submit" className="primary-button" disabled={!code || checking || waitSec > 0}>
            {checking ? 'Έλεγχος…' : 'Άνοιγμα'}
          </button>
        </div>
      </form>
    </div>
  );
}
