import { useEffect, useRef, useState, type ReactNode } from 'react';
import { IsoButton } from './IsoButton';

/**
 * Εργαλεία στη γωνία κάτω αριστερά της προβολής 3D: το κουμπί ισομετρικής μένει πάντα στην οθόνη, και από πάνω του
 * ένα μικρό «βέλος» ανοίγει ή κλείνει τα υπόλοιπα κουμπιά (ετικέτες, χρώματα, διακεκομμένες…) που δίνονται ως παιδιά.
 */
export function CornerTools({ onIso, children }: { onIso: () => void; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // κλείνει με κλικ έξω από τα κουμπιά ή με Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="corner-tools">
      <IsoButton onClick={onIso} />
      {children && (
        <button
          type="button"
          className="fs-fab tool-more"
          aria-expanded={open}
          aria-label="Περισσότερες επιλογές"
          title={open ? 'Κλείσε τις επιλογές' : 'Περισσότερες επιλογές'}
          onClick={() => setOpen((o) => !o)}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d={open ? 'M6 9l6 6 6-6' : 'M6 15l6-6 6 6'} />
          </svg>
        </button>
      )}
      {open && <div className="tool-extras">{children}</div>}
    </div>
  );
}
