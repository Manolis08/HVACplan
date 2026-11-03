import type { DimsMode } from '../viewer/dimLayout';

const TITLES: Record<DimsMode, string> = {
  all: 'Ετικέτες διαστάσεων: όλες — πάτα για τις απαραίτητες',
  essential: 'Ετικέτες διαστάσεων: απαραίτητες — πάτα για να κρυφτούν',
  none: 'Ετικέτες διαστάσεων: καμία — πάτα για όλες',
};

/**
 * Κουμπί στη γωνία της προβολής: οι ετικέτες διαστάσεων γυρίζουν με τη σειρά όλες → απαραίτητες → καμία.
 * Εικονίδιο: βέλος μέτρησης με άκρα (όλες), χωρίς άκρα (απαραίτητες), διαγραμμένο (καμία).
 */
export function LabelsButton({ mode, onClick }: { mode: DimsMode; onClick: () => void }) {
  return (
    <button type="button" className="fs-fab labels-fab" aria-label={TITLES[mode]} title={TITLES[mode]} onClick={onClick}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={mode === 'essential' ? 'M3 12h18M7 9l-4 3 4 3M17 9l4 3-4 3' : 'M3 12h18M3 8v8M21 8v8M7 9l-4 3 4 3M17 9l4 3-4 3'} />
        {mode === 'none' && <path d="M4 4l16 16" />}
      </svg>
    </button>
  );
}
