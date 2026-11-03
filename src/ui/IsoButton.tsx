/** Κουμπί στη γωνία της προβολής 3D: ισομετρική όψη, προσαρμοσμένη να χωράει το μοντέλο στην οθόνη. */
export function IsoButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="fs-fab iso-fab"
      aria-label="Ισομετρική όψη"
      title="Ισομετρική όψη (χωράει και το μοντέλο στην οθόνη)"
      onClick={onClick}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3zM12 12l8-4.5M12 12v9M12 12L4 7.5" />
      </svg>
    </button>
  );
}
