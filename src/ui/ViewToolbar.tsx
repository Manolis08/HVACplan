import { VIEWS, type ViewId } from '../viewer/views';

interface Props {
  current: ViewId | null;
  onSelect: (view: ViewId) => void;
  onFit: () => void;
}

export function ViewToolbar({ current, onSelect, onFit }: Props) {
  return (
    <nav className="view-toolbar" aria-label="Όψεις">
      {VIEWS.map((v) => (
        <button
          key={v.id}
          type="button"
          aria-pressed={current === v.id}
          className="view-button"
          onClick={() => onSelect(v.id)}
        >
          {v.label}
        </button>
      ))}
      <button type="button" className="view-button fit" onClick={onFit} title="Χώρεσε το μοντέλο στην οθόνη">
        Προσαρμογή
      </button>
    </nav>
  );
}
