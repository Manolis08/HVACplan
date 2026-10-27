import { useEffect, useState } from 'react';
import { Icon } from './Icon';

// Πρόταση εγκατάστασης στην οθόνη αφετηρίας, μόνο σε κινητό/tablet και μόνο αν δεν τρέχει ήδη ως εφαρμογή.
// Android (Chrome κ.ά.): κανονικό κουμπί εγκατάστασης. iPhone/iPad: το Safari δεν επιτρέπει κουμπί,
// οπότε δείχνουμε τα δύο βήματα. Αν ο χρήστης το κλείσει, δεν ξαναβγαίνει για 7 ημέρες.

const DISMISS_KEY = 'opseis3d:install-dismissed';
const DISMISS_DAYS = 7;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const isMobile = () => isIos() || /Android|Mobi/i.test(navigator.userAgent);

function dismissedRecently(): boolean {
  try {
    const t = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    return Date.now() - t < DISMISS_DAYS * 86_400_000;
  } catch {
    return false;
  }
}

export function InstallBanner() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);
  const ios = isIos();

  useEffect(() => {
    if (!isMobile() || isStandalone() || dismissedRecently()) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BeforeInstallPromptEvent);
      setShow(true);
    };
    const onInstalled = () => setShow(false);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    // Στο iPhone δεν υπάρχει γεγονός εγκατάστασης: εμφανίζουμε τις οδηγίες λίγο μετά το άνοιγμα.
    const t = ios ? setTimeout(() => setShow(true), 2500) : undefined;
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      if (t) clearTimeout(t);
    };
  }, [ios]);

  const dismiss = () => {
    setShow(false);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // χωρίς αποθήκευση: θα ξαναβγεί στο επόμενο άνοιγμα
    }
  };

  if (!show) return null;
  return (
    <div className="install-banner" role="dialog" aria-label="Εγκατάσταση εφαρμογής">
      <img className="install-icon" src="icons/icon-192.png" alt="" width="40" height="40" />
      <div className="install-text">
        <strong>Βάλε το HVACplan στην οθόνη σου</strong>
        {ios ? (
          <span>
            Πάτα <Icon name="share" size={15} /> <b>Κοινή χρήση</b> και μετά <Icon name="addBox" size={15} />{' '}
            <b>Προσθήκη στην οθόνη αφετηρίας</b>.
          </span>
        ) : (
          <span>Ανοίγει σαν εφαρμογή, σε πλήρη οθόνη, και χωρίς internet.</span>
        )}
      </div>
      {!ios && prompt && (
        <button
          type="button"
          className="primary-button"
          onClick={async () => {
            await prompt.prompt();
            const { outcome } = await prompt.userChoice;
            setPrompt(null);
            if (outcome === 'accepted') setShow(false);
            else dismiss();
          }}
        >
          Εγκατάσταση
        </button>
      )}
      <button type="button" className="link-button install-close" onClick={dismiss} aria-label="Κλείσιμο">
        <Icon name="close" />
      </button>
    </div>
  );
}
