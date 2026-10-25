export type ProjectionAngle = 'first' | 'third';

/**
 * Σύμβολο γωνίας προβολής (ISO 5456-2): κόλουρος κώνος σε πρόσοψη (τραπέζιο, στενή
 * πλευρά αριστερά) και σε πλάγια όψη (δύο ομόκεντροι κύκλοι). 1η γωνία: κύκλοι δεξιά,
 * 3η γωνία: κύκλοι αριστερά.
 */
export function ProjectionSymbol({ angle, size = 56 }: { angle: ProjectionAngle; size?: number }) {
  const first = angle === 'first';
  const tx = first ? 4 : 34; // αρχή τραπεζίου
  const cx = first ? 46 : 16; // κέντρο κύκλων
  return (
    <svg
      viewBox="0 0 62 30"
      width={size}
      height={(size * 30) / 62}
      role="img"
      aria-label={first ? 'Σύμβολο προβολής 1ης γωνίας' : 'Σύμβολο προβολής 3ης γωνίας'}
      className="projection-symbol"
    >
      <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
        <path d={`M${tx} 11 L${tx + 24} 5 L${tx + 24} 25 L${tx} 19 Z`} />
        <circle cx={cx} cy="15" r="10" />
        <circle cx={cx} cy="15" r="4" />
      </g>
      <g stroke="currentColor" strokeWidth="0.7" strokeDasharray="6 2 1 2">
        <line x1="1" y1="15" x2="61" y2="15" />
        <line x1={cx} y1="2" x2={cx} y2="28" />
      </g>
    </svg>
  );
}
