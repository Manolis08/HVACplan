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

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', async () => {
    try {
      const hadController = !!navigator.serviceWorker.controller;
      const reg = await navigator.serviceWorker.register('./sw.js');
      const askUpdate = (w: ServiceWorker) =>
        emit({ type: 'update', apply: () => w.postMessage({ type: 'SKIP_WAITING' }) });
      const track = (w: ServiceWorker) =>
        w.addEventListener('statechange', () => {
          if (w.state !== 'installed') return;
          if (navigator.serviceWorker.controller) askUpdate(w);
          else emit({ type: 'offline-ready' });
        });
      if (reg.waiting && navigator.serviceWorker.controller) askUpdate(reg.waiting);
      if (reg.installing) track(reg.installing);
      reg.addEventListener('updatefound', () => reg.installing && track(reg.installing));

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
