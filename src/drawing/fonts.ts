// Γραμματοσειρές για το PDF (Noto Sans, άδεια OFL): ελληνικά + λατινικά. Πακετάρονται με την
// εφαρμογή, άρα η εξαγωγή PDF δουλεύει και χωρίς internet. Φορτώνονται μόνο όταν χρειαστούν.
import greekUrl from '@fontsource/noto-sans/files/noto-sans-greek-400-normal.woff?url';
import latinUrl from '@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff?url';
import type { GlyphFont } from './pdf';

let loaded: Promise<GlyphFont[]> | null = null;

export function loadPdfFonts(): Promise<GlyphFont[]> {
  if (!loaded) {
    loaded = (async () => {
      const { parse } = await import('opentype.js');
      const fonts = await Promise.all(
        [greekUrl, latinUrl].map(async (u) => parse(await (await fetch(u)).arrayBuffer()) as unknown as GlyphFont),
      );
      return fonts;
    })();
    loaded.catch(() => {
      loaded = null;
    });
  }
  return loaded;
}
