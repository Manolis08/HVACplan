// Παράγει τα εικονίδια της εφαρμογής (PNG + SVG) χωρίς εξωτερικά εργαλεία:
// ισομετρικός «κύβος με εγκοπή» με μια γραμμή διάστασης. Τρέξε: npm run icons
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const OUT = new URL('../public/icons/', import.meta.url);
mkdirSync(OUT, { recursive: true });

const BG = [23, 33, 43];
const LINE = [23, 33, 43];
const DIM = [92, 168, 255];
const SHADE = { top: [236, 241, 246], front: [176, 192, 208], right: [129, 149, 170] };

// Ορατές έδρες του κύβου 30 × 20 × 20 με εγκοπή 12 × 9 × 13 (όπως το πρότυπο).
const q = (shade, plane, ...pts) => ({ shade, plane, pts });
const FACES = [
  q('top', 'z20', [0, 0, 20], [9, 0, 20], [9, 20, 20], [0, 20, 20]),
  q('top', 'z20', [21, 0, 20], [30, 0, 20], [30, 20, 20], [21, 20, 20]),
  q('top', 'z20', [9, 9, 20], [21, 9, 20], [21, 20, 20], [9, 20, 20]),
  q('top', 'z7', [9, 0, 7], [21, 0, 7], [21, 9, 7], [9, 9, 7]),
  q('front', 'y0', [0, 0, 0], [30, 0, 0], [30, 0, 7], [0, 0, 7]),
  q('front', 'y0', [0, 0, 7], [9, 0, 7], [9, 0, 20], [0, 0, 20]),
  q('front', 'y0', [21, 0, 7], [30, 0, 7], [30, 0, 20], [21, 0, 20]),
  q('front', 'y9', [9, 9, 7], [21, 9, 7], [21, 9, 20], [9, 9, 20]),
  q('right', 'x30', [30, 0, 0], [30, 20, 0], [30, 20, 20], [30, 0, 20]),
  q('right', 'x9', [9, 0, 7], [9, 9, 7], [9, 9, 20], [9, 0, 20]),
];

// Γραμμή διάστασης κάτω από το μήκος (στο επίπεδο z = 0, μπροστά από το κομμάτι).
const w = 0.55;
const OVERLAY = [
  [[0, -7 - w, 0], [30, -7 - w, 0], [30, -7 + w, 0], [0, -7 + w, 0]],
  [[-w, -1.5, 0], [w, -1.5, 0], [w, -9.5, 0], [-w, -9.5, 0]],
  [[30 - w, -1.5, 0], [30 + w, -1.5, 0], [30 + w, -9.5, 0], [30 - w, -9.5, 0]],
  [[0, -7, 0], [5, -9.2, 0], [5, -4.8, 0]],
  [[30, -7, 0], [25, -4.8, 0], [25, -9.2, 0]],
];

// Ισομετρική προβολή (κάμερα από μπροστά-δεξιά-πάνω, όπως η «Ισομετρική» της εφαρμογής).
const project = ([x, y, z]) => [(x + y) / Math.SQRT2, (-x + y + 2 * z) / Math.sqrt(6), (x - y + z) / Math.sqrt(3)];

function pointInPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function render(size, { maskable }) {
  const SS = 4; // υπερδειγματοληψία για ομαλές άκρες
  const N = size * SS;
  const faces = FACES.map((f) => ({ ...f, p: f.pts.map(project) }));
  const overlay = OVERLAY.map((poly) => poly.map(project));
  const all = [...faces.flatMap((f) => f.p), ...overlay.flat()];
  const minX = Math.min(...all.map((p) => p[0]));
  const maxX = Math.max(...all.map((p) => p[0]));
  const minY = Math.min(...all.map((p) => p[1]));
  const maxY = Math.max(...all.map((p) => p[1]));
  const target = (maskable ? 0.56 : 0.7) * N;
  const k = target / Math.max(maxX - minX, maxY - minY);
  const ox = N / 2 - ((minX + maxX) / 2) * k;
  const oy = N / 2 + ((minY + maxY) / 2) * k;
  const toPx = ([x, y]) => [ox + x * k, oy - y * k];
  const facePx = faces.map((f) => ({ ...f, px: f.p.map(toPx) }));
  const overlayPx = overlay.map((poly) => poly.map(toPx));
  const planes = [...new Set(FACES.map((f) => f.plane))];

  // Ανά δείγμα: ποια έδρα φαίνεται (z-buffer με το βάθος του κέντρου κάθε έδρας ανά επίπεδο).
  const planeId = new Int16Array(N * N).fill(-1);
  const shadeOf = new Int16Array(N * N).fill(-1);
  const depthBuf = new Float32Array(N * N).fill(-Infinity);
  facePx.forEach((f, fi) => {
    const xs = f.px.map((p) => p[0]);
    const ys = f.px.map((p) => p[1]);
    // Βάθος από το επίπεδο της έδρας: γραμμική παρεμβολή με 3 κορυφές.
    const [a, b, c] = [0, 1, 2].map((i) => [...f.px[i], f.p[i][2]]);
    const det = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(N - 1, Math.ceil(Math.max(...ys))); y++) {
      for (let x = Math.max(0, Math.floor(Math.min(...xs))); x <= Math.min(N - 1, Math.ceil(Math.max(...xs))); x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        if (!pointInPoly(px, py, f.px)) continue;
        const l1 = ((px - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (py - a[1])) / det;
        const l2 = ((b[0] - a[0]) * (py - a[1]) - (px - a[0]) * (b[1] - a[1])) / det;
        const d = a[2] + l1 * (b[2] - a[2]) + l2 * (c[2] - a[2]);
        const i = y * N + x;
        if (d > depthBuf[i]) {
          depthBuf[i] = d;
          planeId[i] = planes.indexOf(f.plane);
          shadeOf[i] = fi;
        }
      }
    }
  });

  const lineR = Math.max(1, Math.round(N / 170));
  const radius = maskable ? 0 : N * 0.22;
  const rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const X = x * SS + sx;
          const Y = y * SS + sy;
          // στρογγυλεμένο τετράγωνο φόντου
          const cx = Math.min(Math.max(X + 0.5, radius), N - radius);
          const cy = Math.min(Math.max(Y + 0.5, radius), N - radius);
          if (radius > 0 && Math.hypot(X + 0.5 - cx, Y + 0.5 - cy) > radius) continue;
          let col = BG;
          const i = Y * N + X;
          const pid = planeId[i];
          if (pid >= 0) {
            col = SHADE[FACES[shadeOf[i]].shade];
            // ακμή: γειτονικό δείγμα σε άλλο επίπεδο ή στο φόντο
            for (const [dx, dy] of [[lineR, 0], [-lineR, 0], [0, lineR], [0, -lineR]]) {
              const nx = X + dx;
              const ny = Y + dy;
              const other = nx < 0 || ny < 0 || nx >= N || ny >= N ? -1 : planeId[ny * N + nx];
              if (other !== pid) {
                col = LINE;
                break;
              }
            }
          }
          if (overlayPx.some((poly) => pointInPoly(X + 0.5, Y + 0.5, poly))) col = DIM;
          r += col[0];
          g += col[1];
          b += col[2];
          a += 255;
        }
      }
      const n = SS * SS;
      const o = (y * size + x) * 4;
      // προπολλαπλασιασμός ώστε οι διάφανες άκρες να μη «βρομίζουν»
      const cov = a / 255;
      rgba[o] = cov ? r / cov : 0;
      rgba[o + 1] = cov ? g / cov : 0;
      rgba[o + 2] = cov ? b / cov : 0;
      rgba[o + 3] = a / n;
    }
  }
  return { rgba, facePx, overlayPx, N };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function png(size, rgba) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const [name, size, opts] of [
  ['icon-192.png', 192, { maskable: false }],
  ['icon-512.png', 512, { maskable: false }],
  ['icon-maskable-512.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, { maskable: true }],
]) {
  writeFileSync(new URL(name, OUT), png(size, render(size, opts).rgba));
}

// SVG για favicon (ίδια γεωμετρία, ζωγραφισμένη από πίσω προς τα μπρος).
{
  const { facePx, overlayPx, N } = render(64, { maskable: false });
  const s = 64 / N;
  const pts = (poly) => poly.map(([x, y]) => `${(x * s).toFixed(2)},${(y * s).toFixed(2)}`).join(' ');
  const order = facePx
    .map((f, i) => ({ f, d: f.p.reduce((acc, p) => acc + p[2], 0) / f.p.length, i }))
    .sort((a, b) => a.d - b.d);
  const rgb = (c) => `rgb(${c.join(',')})`;
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">',
    `<rect width="64" height="64" rx="14" fill="${rgb(BG)}"/>`,
    ...order.map(({ f }) => `<polygon points="${pts(f.px)}" fill="${rgb(SHADE[f.shade])}" stroke="${rgb(LINE)}" stroke-width="0.8" stroke-linejoin="round"/>`),
    ...overlayPx.map((poly) => `<polygon points="${pts(poly)}" fill="${rgb(DIM)}"/>`),
    '</svg>',
  ].join('\n');
  writeFileSync(new URL('icon.svg', OUT), svg);
}

console.log('Εικονίδια γράφτηκαν στο public/icons/');
