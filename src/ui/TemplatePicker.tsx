import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import type { TemplateDef } from '../model/types';
import { Icon } from './Icon';

// Μικρά εικονίδια με το χαρακτηριστικό προφίλ κάθε προτύπου.
const ICONS: Record<string, ReactNode> = {
  'notched-cube': <path d="M4 28V6h12v10h8V6h12v22Z" />,
  'stepped-block': <path d="M3 25V8H21V23H37V29H15V25Z" />,
  'bearing-block': (
    <>
      <path d="M3 29H13L11 26H29L27 29H37V22H27V12A7 7 0 0 0 13 12V22H3Z" />
      <circle cx="20" cy="12" r="3.5" />
    </>
  ),
};

interface Props {
  /** Τα πρότυπα με τη σειρά του χρήστη. */
  templates: TemplateDef[];
  /** Όνομα προς εμφάνιση (το δικό του χρήστη, αν έχει δώσει). */
  nameOf: (t: TemplateDef) => string;
  value: string;
  onChange: (id: string) => void;
  onReorder: (ids: string[]) => void;
  /** Νέο όνομα· κενό = επαναφορά στο αρχικό. */
  onRename: (id: string, name: string) => void;
}

const move = (ids: string[], from: number, to: number) => {
  const out = [...ids];
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x);
  return out;
};

export function TemplatePicker({ templates, nameOf, value, onChange, onReorder, onRename }: Props) {
  const ids = templates.map((t) => t.id);
  const [dragging, setDragging] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const idsRef = useRef(ids);
  idsRef.current = ids;

  // Σύρσιμο με pointer events (ποντίκι και αφή): η κάρτα κάτω από το δάχτυλο παίρνει τη θέση.
  const onHandleDown = (e: PointerEvent<HTMLButtonElement>, id: string) => {
    e.preventDefault();
    setDragging(id);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // χωρίς capture το σύρσιμο δουλεύει όσο ο δείκτης μένει πάνω στη λαβή· δεν είναι κρίσιμο
    }
  };
  const onHandleMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (!dragging) return;
    const over = document
      .elementsFromPoint(e.clientX, e.clientY)
      .map((el) => (el as HTMLElement).closest<HTMLElement>('[data-template-id]'))
      .find((el) => el && el.dataset.templateId !== dragging);
    const target = over?.dataset.templateId;
    if (!target) return;
    const cur = idsRef.current;
    const from = cur.indexOf(dragging);
    const to = cur.indexOf(target);
    if (from >= 0 && to >= 0 && from !== to) onReorder(move(cur, from, to));
  };
  const onHandleUp = () => setDragging(null);
  // Πληκτρολόγιο: βέλη αριστερά/δεξιά (ή πάνω/κάτω) μετακινούν την κάρτα.
  const onHandleKey = (e: KeyboardEvent<HTMLButtonElement>, id: string) => {
    const d = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : 0;
    if (!d) return;
    e.preventDefault();
    const from = ids.indexOf(id);
    const to = Math.max(0, Math.min(ids.length - 1, from + d));
    if (to !== from) onReorder(move(ids, from, to));
  };

  const startEdit = (t: TemplateDef) => {
    setEditing(t.id);
    setDraft(nameOf(t));
  };
  const commit = (t: TemplateDef) => {
    const name = draft.trim();
    onRename(t.id, name === t.name ? '' : name);
    setEditing(null);
  };

  return (
    <div className="template-grid" role="radiogroup" aria-label="Έτοιμο σχήμα">
      {templates.map((t) => {
        const name = nameOf(t);
        return (
          <div key={t.id} data-template-id={t.id} className={`template-item${dragging === t.id ? ' dragging' : ''}`}>
            {editing === t.id ? (
              <form
                className="template-card editing"
                onSubmit={(e) => {
                  e.preventDefault();
                  commit(t);
                }}
              >
                <input
                  autoFocus
                  aria-label={`Νέο όνομα για «${name}»`}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => commit(t)}
                  onKeyDown={(e) => e.key === 'Escape' && setEditing(null)}
                />
                <button
                  type="button"
                  className="link-button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onRename(t.id, '');
                    setEditing(null);
                  }}
                >
                  Αρχικό όνομα
                </button>
              </form>
            ) : (
              <button
                type="button"
                role="radio"
                aria-checked={t.id === value}
                className="template-card"
                onClick={() => onChange(t.id)}
                title={t.description}
                aria-label={name}
              >
                <svg viewBox="0 0 40 32" width="40" height="32" aria-hidden="true">
                  <g fill="var(--icon-fill)" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
                    {ICONS[t.id]}
                  </g>
                </svg>
                <span>{name}</span>
              </button>
            )}
            <button
              type="button"
              className="card-tool drag-handle"
              aria-label={`Μετακίνηση «${name}» (σύρε, ή βέλη)`}
              title="Σύρε για αλλαγή σειράς"
              onPointerDown={(e) => onHandleDown(e, t.id)}
              onPointerMove={onHandleMove}
              onPointerUp={onHandleUp}
              onPointerCancel={onHandleUp}
              onKeyDown={(e) => onHandleKey(e, t.id)}
            >
              <Icon name="grip" size={14} />
            </button>
            {editing !== t.id && (
              <button
                type="button"
                className="card-tool rename"
                aria-label={`Μετονομασία «${name}»`}
                title="Μετονομασία"
                onClick={() => startEdit(t)}
              >
                <Icon name="pencil" size={14} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
