// Καταχώριση service worker (μόνο στο τελικό build) και ειδοποιήσεις προς την εφαρμογή.

export type PwaEvent = { type: 'offline-ready' } | { type: 'update'; apply: () => void };

const listeners = new Set<(e: PwaEvent) => void>();
let last: PwaEvent | null = null;

const emit = (e: PwaEvent) => {
  last = e;
  listeners.forEach((l) => l(e));
};

export function onPwaEvent(listener: (e: PwaEvent) => void): () => void {
  listeners.add(listener);
  if (last) listener(last);
  return () => listeners.delete(listener);
}

/** Μέχρι πόσο μετά το άνοιγμα μια νέα έκδοση εφαρμόζεται χωρίς ερώτηση. */
const AUTO_UPDATE_WINDOW_MS = 15_000;
const openedAt = performance.now();

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', async () => {
    try {
      const hadController = !!navigator.serviceWorker.controller;
      const reg = await navigator.serviceWorker.register('./sw.js');
      // Νέα έκδοση: στα πρώτα δευτερόλεπτα μετά το άνοιγμα (ο χρήστης δεν έχει αρχίσει ακόμα δουλειά)
      // εφαρμόζεται αυτόματα με μία ανανέωση. Αργότερα ρωτάμε με το κουμπί «Ανανέωση», ώστε να μη
      // χαθεί κάτι που κάνει (π.χ. ανοιχτό αρχείο 3D, ξεκλείδωτο φύλλο).
      const askUpdate = (w: ServiceWorker) => {
        const apply = () => w.postMessage({ type: 'SKIP_WAITING' });
        if (performance.now() - openedAt < AUTO_UPDATE_WINDOW_MS) apply();
        else emit({ type: 'update', apply });
      };
      const track = (w: ServiceWorker) =>
        w.addEventListener('statechange', () => {
          if (w.state !== 'installed') return;
          if (navigator.serviceWorker.controller) askUpdate(w);
          else emit({ type: 'offline-ready' });
        });
      if (reg.waiting && navigator.serviceWorker.controller) askUpdate(reg.waiting);
      if (reg.installing) track(reg.installing);
      reg.addEventListener('updatefound', () => reg.installing && track(reg.installing));
      // Έλεγχος για νέα έκδοση αμέσως στο άνοιγμα (όχι μόνο όταν το αποφασίσει ο browser).
      void reg.update().catch(() => undefined);

      // Μετά την «Ανανέωση», η νέα έκδοση αναλαμβάνει και ξαναφορτώνουμε μία φορά.
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController || reloading) return;
        reloading = true;
        location.reload();
      });
      // Έλεγχος για νέα έκδοση όταν η εφαρμογή ξαναγίνεται ορατή.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void reg.update().catch(() => undefined);
      });
    } catch {
      // Χωρίς service worker η εφαρμογή δουλεύει κανονικά, απλώς όχι χωρίς internet.
    }
  });
}
