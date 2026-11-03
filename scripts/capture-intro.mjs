// Φωτογραφίζει την εφαρμογή για το intro: ολόκληρη την οθόνη χωρίς τα στοιχεία που «σηκώνονται» (κουμπιά,
// κάρτες, chips) και κάθε στοιχείο μόνο του σε διάφανο φόντο, μαζί με τη θέση του, για υπολογιστή και
// κινητό και για κάθε φόντο. Γράφει στο public/intro/<διάταξη>/<φόντο>/.
// Χρήση (με τον dev server ανοιχτό): node scripts/capture-intro.mjs [url]
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { DESKTOP_PRESETS, MOBILE_PRESET } from '../src/intro/presets.ts';

const URL = (process.argv[2] ?? 'http://localhost:5173/') + '?intro=0';
/** προαιρετικά, μόνο ένα σετ: node scripts/capture-intro.mjs <url> d1440/gray */
const ONLY = process.argv[3];
const OUT = 'public/intro';
const PAD = 28;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const SETS = [...DESKTOP_PRESETS, MOBILE_PRESET];
/** ίδια ονόματα και κλειδί με το src/lib/theme.ts */
const THEMES = ['gray', 'dark', 'light', 'black'];
const THEME_KEY = 'opseis3d:theme';

/** Τι σηκώνεται και πόσο: ύψος (px σελίδας) και γωνία που «σηκώνεται» προς τον φακό (μοίρες). */
const PIECES = [
  { sel: '.theme-picker', z: 26, a: 20 },
  { sel: '.mode-switch', z: 58, a: 30 },
  { sel: '.pane-switch', z: 72, a: 32 },
  { sel: '.template-item', z: [112, 130, 118], a: 44 },
  { sel: '.params-toggle', z: 34, a: 24 },
  { sel: '.chip-view', z: 70, a: 30 },
  { sel: '.chip-scale', z: 64, a: 30 },
  { sel: '.corner-tools .fs-fab', z: [36, 44], a: 28 },
];

const ISOLATE = `
  html, body, #root { background: transparent !important; }
  body * { visibility: hidden !important; }
  [data-intro-active], [data-intro-active] * { visibility: visible !important; }
  [data-intro-active] { box-shadow: none !important; -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }
`;

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});

// Κωδικοποίηση σε WebP μέσα στον browser (μικρότερα αρχεία από PNG, με διαφάνεια).
const encoder = await browser.newPage();
async function webp(png, quality) {
  const b64 = await encoder.evaluate(
    async ([data, q]) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      c.getContext('2d').drawImage(bmp, 0, 0);
      const blob = await c.convertToBlob({ type: 'image/webp', quality: q });
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(s);
    },
    [png.toString('base64'), quality],
  );
  return Buffer.from(b64, 'base64');
}

for (const set of SETS) for (const theme of THEMES) {
  if (ONLY && ONLY !== `${set.name}/${theme}`) continue;
  const ctx = await browser.newContext({
    viewport: { width: set.width, height: set.height },
    deviceScaleFactor: set.dpr,
    reducedMotion: 'no-preference', // ίδια διάταξη με την εφαρμογή που παίζει το intro (με reduce το πάνελ του 3D βγαίνει 4px πιο φαρδύ)
    hasTouch: !!set.mobile,
    isMobile: !!set.mobile,
  });
  await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), [THEME_KEY, theme]);
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000); // το 3D σχεδιάζεται
  // ώσπου να σταθεροποιηθεί η κάμερα του 3D: δύο διαδοχικές φωτογραφίες ίδιες (αλλιώς το τελευταίο καρέ του intro
  // θα είχε το αντικείμενο λίγα pixel πιο πέρα από την πραγματική εφαρμογή)
  for (let i = 0, prev = null; i < 40; i++) {
    const cur = await page.screenshot();
    if (prev && prev.equals(cur)) break;
    prev = cur;
    await page.waitForTimeout(700);
  }

  // σήμανση των στοιχείων που σηκώνονται (μόνο όσα φαίνονται μέσα στην οθόνη)
  const pieces = await page.evaluate(
    ([defs, W, H]) => {
      const out = [];
      let n = 0;
      for (const d of defs) {
        let i = 0;
        for (const el of document.querySelectorAll(d.sel)) {
          const r = el.getBoundingClientRect();
          if (r.width < 4 || r.height < 4 || r.right < 0 || r.bottom < 0 || r.left > W || r.top > H) continue;
          if (getComputedStyle(el).visibility === 'hidden' || Number(getComputedStyle(el).opacity) < 0.05) continue;
          const id = `p${n++}`;
          el.setAttribute('data-intro-layer', id);
          const z = Array.isArray(d.z) ? d.z[i % d.z.length] : d.z;
          out.push({ id, x: r.x, y: r.y, w: r.width, h: r.height, z, a: d.a });
          i++;
        }
      }
      return out;
    },
    [PIECES, set.width, set.height],
  );

  const dir = `${OUT}/${set.name}/${theme}`;
  mkdirSync(dir, { recursive: true });

  // ολόκληρη η οθόνη χωρίς τα στοιχεία
  const hide = await page.addStyleTag({ content: '[data-intro-layer], [data-intro-layer] * { visibility: hidden !important; }' });
  writeFileSync(`${dir}/page.webp`, await webp(await page.screenshot(), 0.95));
  await hide.evaluate((n) => n.remove());
  // και ολόκληρη, με όλα στη θέση τους: το τελευταίο καρέ του φιλμ
  writeFileSync(`${dir}/full.webp`, await webp(await page.screenshot(), 0.95));

  // κάθε στοιχείο μόνο του, με διάφανο φόντο και περιθώριο
  const iso = await page.addStyleTag({ content: ISOLATE });
  const layout = { width: set.width, height: set.height, dpr: set.dpr, pad: PAD, page: 'page.webp', full: 'full.webp', pieces: [] };
  for (const p of pieces) {
    await page.evaluate((id) => document.querySelector(`[data-intro-layer="${id}"]`).setAttribute('data-intro-active', ''), p.id);
    // περιθώριο γύρω από το στοιχείο, μέσα στα όρια της οθόνης (ώστε εικόνα και θέση να ταιριάζουν)
    const x0 = Math.max(0, p.x - PAD), y0 = Math.max(0, p.y - PAD);
    const x1 = Math.min(set.width, p.x + p.w + PAD), y1 = Math.min(set.height, p.y + p.h + PAD);
    const clip = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    const png = await page.screenshot({ clip, omitBackground: true });
    await page.evaluate((id) => document.querySelector(`[data-intro-layer="${id}"]`).removeAttribute('data-intro-active'), p.id);
    writeFileSync(`${dir}/${p.id}.webp`, await webp(png, 0.92));
    layout.pieces.push({ file: `${p.id}.webp`, x: clip.x, y: clip.y, w: clip.width, h: clip.height, z: p.z, a: p.a });
  }
  await iso.evaluate((n) => n.remove());
  writeFileSync(`${dir}/layout.json`, JSON.stringify(layout, null, 1));
  console.log(`${set.name}/${theme}: ${layout.pieces.length} pieces`);
  await ctx.close();
}

await browser.close();
