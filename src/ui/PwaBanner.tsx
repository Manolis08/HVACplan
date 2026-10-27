import { useEffect, useState } from 'react';
import { onPwaEvent, type PwaEvent } from '../lib/pwa';
import { Icon } from './Icon';

export function PwaBanner() {
  const [event, setEvent] = useState<PwaEvent | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => onPwaEvent((e) => {
    setEvent(e);
    setHidden(false);
  }), []);

  useEffect(() => {
    if (event?.type !== 'offline-ready') return;
    const t = setTimeout(() => setHidden(true), 6000);
    return () => clearTimeout(t);
  }, [event]);

  if (!event || hidden) return null;
  return (
    <div className="pwa-banner" role="status">
      {event.type === 'offline-ready' ? (
        <span>Η εφαρμογή αποθηκεύτηκε στη συσκευή και δουλεύει πλέον και χωρίς internet.</span>
      ) : (
        <>
          <span>Υπάρχει νέα έκδοση της εφαρμογής.</span>
          <button type="button" className="primary-button" onClick={event.apply}>
            Ανανέωση
          </button>
        </>
      )}
      <button type="button" className="link-button" onClick={() => setHidden(true)} aria-label="Κλείσιμο ειδοποίησης">
        <Icon name="close" />
      </button>
    </div>
  );
}
