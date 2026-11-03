// Οι διαστάσεις οθόνης (px σελίδας) στις οποίες φωτογραφίζεται η εφαρμογή για το intro. Η διάταξη της εφαρμογής
// εξαρτάται από το μέγεθος του παραθύρου, οπότε το φιλμ χρησιμοποιεί τη φωτογραφία που πλησιάζει περισσότερο στο
// παράθυρο του χρήστη και την τεντώνει στο ακριβές του μέγεθος: το τελευταίο καρέ έχει το ίδιο πλαίσιο με την εφαρμογή.
// Το script scripts/capture-intro.mjs διαβάζει την ίδια λίστα.

export interface Preset {
  name: string;
  width: number;
  height: number;
  dpr: number;
  mobile?: boolean;
}

export const DESKTOP_PRESETS: Preset[] = [
  { name: 'd1180', width: 1180, height: 820, dpr: 2 }, // tablet σε οριζόντια θέση
  { name: 'd1280', width: 1280, height: 720, dpr: 2 }, // μικρό laptop
  { name: 'd1366', width: 1366, height: 700, dpr: 2 }, // laptop 1366×768, παράθυρο browser
  { name: 'd1440', width: 1440, height: 900, dpr: 2 }, // πλήρης οθόνη 16:10
  { name: 'd1440w', width: 1440, height: 780, dpr: 2 }, // MacBook, παράθυρο browser
  { name: 'd1500', width: 1500, height: 750, dpr: 2 }, // πλατύ παράθυρο
  { name: 'd1512', width: 1512, height: 860, dpr: 2 }, // MacBook Pro 14″, παράθυρο browser
  { name: 'd1710', width: 1710, height: 980, dpr: 2 }, // MacBook Air 15″, παράθυρο browser
  { name: 'd1920', width: 1920, height: 950, dpr: 2 }, // οθόνη 1080p, παράθυρο browser
];

/** Πόσο διαφέρει το παράθυρο από τη φωτογραφία (σχετική διαφορά πλάτους ή ύψους): 0 = ακριβώς ίδιο μέγεθος. */
export function presetMismatch(p: Preset, vw: number, vh: number) {
  return Math.max(Math.abs(vw / p.width - 1), Math.abs(vh / p.height - 1));
}

export const MOBILE_PRESET: Preset = { name: 'mobile', width: 390, height: 844, dpr: 3, mobile: true };

/** Η φωτογραφία που ταιριάζει καλύτερα σε παράθυρο vw × vh (απόσταση σε λογαρίθμους πλάτους και ύψους). */
export function pickPreset(vw: number, vh: number): Preset {
  if (vw < 900 && vh > vw) return MOBILE_PRESET;
  let best = DESKTOP_PRESETS[0];
  let bestD = Infinity;
  for (const p of DESKTOP_PRESETS) {
    const d = Math.abs(Math.log(vw / p.width)) + Math.abs(Math.log(vh / p.height));
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}
