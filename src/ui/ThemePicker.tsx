import { useEffect, useRef, useState } from 'react';
import { THEMES, themeInfo, type Theme } from '../lib/theme';
import { Icon } from './Icon';

interface Props {
  value: Theme;
  onChange: (t: Theme) => void;
}

/** Κυκλάκι με το χρώμα του φόντου· ανοίγει μενού τεσσάρων χρωμάτων. */
export function ThemePicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="theme-picker" ref={ref}>
      <button
        type="button"
        className={`theme-toggle swatch-only${open ? ' open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Χρώμα φόντου: ${themeInfo(value).label}`}
        title="Χρώμα φόντου"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="swatch" style={{ background: themeInfo(value).swatch }} aria-hidden="true" />
      </button>
      {open && (
        <div className="theme-menu" role="menu" aria-label="Χρώμα φόντου">
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="menuitemradio"
              aria-checked={t.id === value}
              onClick={() => {
                onChange(t.id);
                setOpen(false);
              }}
            >
              <span className="swatch" style={{ background: t.swatch }} aria-hidden="true" />
              <span>{t.label}</span>
              {t.id === value && <Icon name="check" size={14} className="theme-check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
