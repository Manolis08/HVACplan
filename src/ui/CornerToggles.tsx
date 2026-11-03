import type { ReactNode } from 'react';

// Κουμπιά-διακόπτες στη γωνία της προβολής 3D (μόνο εικονίδιο, όπως της ισομετρικής και των ετικετών διαστάσεων).
// Διαγραμμένο εικονίδιο = ανενεργό.

function ToggleFab({ className, on, label, onClick, children }: { className: string; on: boolean; label: string; onClick: () => void; children: ReactNode }) {
  const title = `${label}: ${on ? 'ενεργό — πάτα για κλείσιμο' : 'κλειστό — πάτα για άνοιγμα'}`;
  return (
    <button type="button" className={`fs-fab ${className}`} aria-pressed={on} aria-label={`${label}: ${on ? 'ενεργό' : 'κλειστό'}`} title={title} onClick={onClick}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {children}
        {!on && <path d="M4 4l16 16" />}
      </svg>
    </button>
  );
}

/** Διακεκομμένες (κρυμμένες) γραμμές: κύβος με διακεκομμένες τις εσωτερικές ακμές. */
export function DashedButton({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <ToggleFab className="dashed-fab" on={on} label="Διακεκομμένες γραμμές" onClick={onClick}>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
      <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" strokeDasharray="2 2.6" />
    </ToggleFab>
  );
}

/** Χρώματα όψεων: παλέτα. */
export function ColorsButton({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <ToggleFab className="colors-fab" on={on} label="Χρώματα όψεων" onClick={onClick}>
      <path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.6-.9 1.2-1.7-.5-1 .1-2.3 1.5-2.3H17a4 4 0 0 0 4-4c0-5-4-10-9-10z" />
      <path d="M7.5 11h.01M10 7.5h.01M14.5 7.5h.01" />
    </ToggleFab>
  );
}
