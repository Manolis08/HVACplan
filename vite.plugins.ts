import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { Plugin } from 'vite';

// Ο DRACOLoader του three.js αναφέρει δύο σετ αποκωδικοποιητή και το Vite τα αντιγράφει και τα δύο.
// Χρησιμοποιούμε μόνο το σετ για glTF· το γενικό σετ (ίδιο περιεχόμενο με αυτά τα αρχεία)
// δεν μπαίνει στην τοπική αποθήκευση του service worker.
const UNUSED_DRACO = ['draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js'].map((f) =>
  resolve('node_modules/three/examples/jsm/libs/draco', f),
);

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

function walk(dir: string, root = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full, root) : [relative(root, full).split('\\').join('/')];
  });
}

/**
 * Service worker για λειτουργία χωρίς internet: μετά το build καταγράφει ΟΛΑ τα αρχεία του
 * dist και γράφει sw.js που τα αποθηκεύει τοπικά. Η έκδοση της cache είναι hash του περιεχομένου,
 * άρα κάθε αλλαγή φέρνει νέα έκδοση και ο χρήστης ειδοποιείται για ανανέωση.
 */
export function serviceWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'opseis-sw',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const unused = new Set(UNUSED_DRACO.map((f) => sha256(readFileSync(f))));
      const files = walk(outDir)
        .filter((f) => f !== 'sw.js' && !f.endsWith('.map') && !f.split('/').some((p) => p.startsWith('.')))
        .filter((f) => !unused.has(sha256(readFileSync(join(outDir, f)))))
        .sort();
      const template = readFileSync(resolve('scripts/sw-template.js'), 'utf8');
      const hash = createHash('sha256').update(template);
      for (const f of files) hash.update(f).update(readFileSync(join(outDir, f)));
      const version = hash.digest('hex').slice(0, 12);
      const assets = ['./', ...files.map((f) => `./${f}`)];
      writeFileSync(
        join(outDir, 'sw.js'),
        template.replace('__VERSION__', version).replace('__ASSETS__', JSON.stringify(assets, null, 2)),
      );
    },
  };
}

/**
 * Κανόνες ασφαλείας στο τελικό build (όχι στην ανάπτυξη, όπου το Vite χρειάζεται εσωτερικά scripts).
 * Η εφαρμογή τρέχει εξ ολοκλήρου στον browser: φορτώνει κώδικα και δεδομένα μόνο από το ίδιο site,
 * δεν στέλνει τίποτα αλλού και δεν μπορεί να ενσωματωθεί σε ξένη σελίδα μέσω <object>/<embed>.
 * - script-src 'wasm-unsafe-eval': μόνο για τον αποκωδικοποιητή Draco (WebAssembly), όχι eval για JS.
 * - worker-src blob:: ο αποκωδικοποιητής Draco τρέχει σε worker που φτιάχνεται τοπικά.
 * - connect/img blob: data:: τα αρχεία 3D του χρήστη διαβάζονται τοπικά, χωρίς ανέβασμα.
 * - style-src 'unsafe-inline': στυλ σε ιδιότητα style (π.χ. χρώματα δειγμάτων)· δεν επιτρέπει scripts.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

export function securityHeaders(): Plugin {
  return {
    name: 'hvacplan-security',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />\n    <meta name="referrer" content="no-referrer" />`,
      );
    },
  };
}
