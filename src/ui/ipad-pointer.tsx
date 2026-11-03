import { useEffect, useRef } from 'react';
import './ipad-pointer.css';

// Δρομέας σαν του iPad: ένας θολωμένος κύκλος που ακολουθεί τον δείκτη με ελαφρά καθυστέρηση, και γίνεται
// σχήμα του κουμπιού κάτω από τον δείκτη. Εμφανίζεται μόνο με ποντίκι, trackpad ή γραφίδα· στα πεδία
// κειμένου μένει το κανονικό γράμμα, και στην αφή δεν εμφανίζεται.

const SIZE = 28;
const PAD = 4;
const LERP = 0.34;
const PRESS_SCALE = 0.86;
/** πόσο πρέπει να κινηθεί ο δείκτης με πατημένο το πλήκτρο (px) για να θεωρηθεί σύρσιμο και να εξαφανιστεί ο κύκλος */
const DRAG_DISTANCE = 4;
const TARGET =
  'button:not(:disabled), a[href], [role="button"], [role="tab"], [role="switch"], [role="menuitem"], select, label, summary, input[type="checkbox"], input[type="radio"], input[type="range"], [data-pointer]';
const TEXT =
  'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]), textarea, [contenteditable="true"]';
// Τα «χεράκια» του Τ+Π και τα κουμπιά στη γωνία της προβολής (πλήρης οθόνη, ισομετρική): δεν έχουν περίγραμμα, και ο
// κύκλος παίρνει το σχήμα του εικονιδίου τους (τα χεράκια, με την ίδια κλίση του πατώματος)
const HAND = '.tp-hand';
const SHAPE = `${HAND}, .fs-fab`;
/** περιθώριο γύρω από το εικονίδιο, σε μονάδες του viewBox του */
const SHAPE_PAD = 6;
// Οι μπάρες (range): ο κύκλος πάει στη βούλα της μπάρας, όχι σε ολόκληρη τη μπάρα
const RANGE = 'input[type="range"]';
const THUMB = 16;
// Στοιχεία που κινούνται ή αλλάζουν όσο πατιούνται, οπότε ο κύκλος συνεχίζει να τα ακολουθεί και στο πάτημα
const FOLLOW = `${HAND}, ${RANGE}`;
const IDENTITY = [1, 0, 0, 1];

/** Ο γραμμικός μετασχηματισμός (κλίση, περιστροφή, κλίμακα) που έχει το στοιχείο μαζί με όλους τους γονείς του. */
function linearOf(el: Element) {
  let m = new DOMMatrix();
  for (let e: Element | null = el; e; e = e.parentElement) {
    const t = getComputedStyle(e).transform;
    if (t && t !== 'none') m = new DOMMatrix(t).multiply(m);
  }
  return m;
}

/**
 * Μάσκα με το σχήμα ενός εικονιδίου SVG (γεμάτη, λίγο πιο παχιά από το περίγραμμά του) και το μέγεθος που έχει ο
 * κύκλος ώστε το εικονίδιο να χωράει με περιθώριο.
 */
function shapeOf(svg: SVGSVGElement) {
  const d = [...svg.querySelectorAll('path')].map((p) => p.getAttribute('d') ?? '').filter(Boolean);
  if (!d.length) return null;
  const vb = svg.viewBox.baseVal;
  const vw = vb.width || 24;
  const vh = vb.height || 24;
  const k = (Number(svg.getAttribute('width')) || vw) / vw; // px ανά μονάδα του viewBox
  const paths = d.map((p) => `<path d="${p}" fill="#000" stroke="#000" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
  const w = vw + SHAPE_PAD * 2;
  const h = vh + SHAPE_PAD * 2;
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.x - SHAPE_PAD} ${vb.y - SHAPE_PAD} ${w} ${h}">${paths}</svg>`;
  return { mask: `url("data:image/svg+xml,${encodeURIComponent(markup)}")`, width: w * k, height: h * k };
}

export function IpadPointer() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    const dot = ref.current!;
    const root = document.documentElement;
    root.classList.add('ipad-pointer');

    let x = 0, y = 0; // θέση που φαίνεται
    let tx = 0, ty = 0; // θέση-στόχος
    let hit: Element | null = null; // κουμπί κάτω από τον δείκτη
    let raf = 0;
    let pressing = false; // το πλήκτρο του ποντικιού είναι πατημένο
    let dragging = false; // πατημένο και σέρνει (π.χ. το 3D αντικείμενο ή το χεράκι του Τ+Π)
    let downX = 0, downY = 0; // πού πατήθηκε
    let lastX = 0, lastY = 0; // πού είναι ο δείκτης
    let dotScale = 1; // τρέχουσα κλίμακα του κύκλου
    let lin = [...IDENTITY]; // τρέχουσα κλίση του κύκλου (a, b, c, d)
    let linT = [...IDENTITY]; // κλίση-στόχος
    let shapeMask: string | null = null; // σχήμα εικονιδίου που πρέπει να πάρει ο κύκλος
    let maskedShape: string | null = null; // σχήμα εικονιδίου που έχει τώρα ο κύκλος

    const aimAt = (el: Element | null, cx: number, cy: number) => {
      linT = IDENTITY;
      shapeMask = null;
      const svg = el?.matches(SHAPE) ? el.querySelector('svg') : null;
      const shape = svg ? shapeOf(svg) : null;
      if (el && svg && shape) {
        const r = svg.getBoundingClientRect();
        tx = r.left + r.width / 2;
        ty = r.top + r.height / 2;
        const m = linearOf(el);
        linT = [m.a, m.b, m.c, m.d];
        shapeMask = shape.mask;
        dot.style.width = `${shape.width}px`;
        dot.style.height = `${shape.height}px`;
        dot.style.borderRadius = '50%';
        dot.classList.add('is-snap');
      } else if (el?.matches(RANGE)) {
        // η βούλα της μπάρας: η θέση της υπολογίζεται από την τιμή και την κλίση της μπάρας
        const input = el as HTMLInputElement;
        const min = Number(input.min) || 0;
        const max = Number(input.max) || 100;
        const f = (Number(input.value) - min) / (max - min || 1);
        const m = linearOf(el);
        const r = el.getBoundingClientRect();
        const off = (f - 0.5) * (input.offsetWidth - THUMB);
        tx = r.left + r.width / 2 + m.a * off;
        ty = r.top + r.height / 2 + m.b * off;
        dot.style.width = `${SIZE}px`;
        dot.style.height = `${SIZE}px`;
        dot.style.borderRadius = '50%';
        dot.classList.add('is-snap');
      } else if (el) {
        const r = el.getBoundingClientRect();
        tx = r.left + r.width / 2;
        ty = r.top + r.height / 2;
        const radius = getComputedStyle(el).borderTopLeftRadius;
        dot.style.width = `${r.width + PAD * 2}px`;
        dot.style.height = `${r.height + PAD * 2}px`;
        dot.style.borderRadius = radius === '0px' ? '8px' : radius;
        dot.classList.add('is-snap');
      } else {
        tx = cx;
        ty = cy;
        dot.style.width = `${SIZE}px`;
        dot.style.height = `${SIZE}px`;
        dot.style.borderRadius = '50%';
        dot.classList.remove('is-snap');
      }
    };

    const hide = () => {
      hit = null;
      dot.classList.add('is-hidden');
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return hide();
      lastX = e.clientX;
      lastY = e.clientY;
      if (pressing && !dragging && Math.hypot(e.clientX - downX, e.clientY - downY) > DRAG_DISTANCE) {
        dragging = true;
        dot.classList.add('is-dragging');
      }
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest(TEXT)) return hide();
      if (dot.classList.contains('is-hidden')) {
        x = e.clientX;
        y = e.clientY;
        dot.classList.remove('is-hidden');
      }
      // πατημένο κουμπί: το κουμπί αλλάζει μέγεθος ή θέση μόνο του (:active), οπότε ο κύκλος μένει ακίνητος
      if (pressing && hit?.isConnected && !hit.matches(FOLLOW)) return;
      // όσο ο δείκτης μένει μέσα στο ίδιο κουμπί (π.χ. πάνω στο μολύβι μιας κάρτας), δεν αλλάζει ο στόχος
      if (!(hit?.isConnected && el && hit.contains(el))) hit = el?.closest(TARGET) ?? null;
      aimAt(hit, e.clientX, e.clientY);
    };

    // όταν ο δείκτης φεύγει από τη σελίδα
    const onOut = (e: PointerEvent) => {
      if (!e.relatedTarget) hide();
    };
    const press = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      pressing = true;
      downX = lastX = e.clientX;
      downY = lastY = e.clientY;
    };
    const release = () => {
      pressing = false;
      if (!dragging) return;
      // τέλος σύρσιμου: ο κύκλος ξαναφαίνεται κατευθείαν κάτω από τον δείκτη, χωρίς να «πετάξει» από παλιά θέση
      dragging = false;
      x = tx = lastX;
      y = ty = lastY;
      const el = document.elementFromPoint(lastX, lastY);
      hit = el?.closest(TEXT) ? null : (el?.closest(TARGET) ?? null);
      aimAt(hit, lastX, lastY);
      dot.classList.remove('is-dragging');
    };

    const frame = () => {
      // το κουμπί μπορεί να μετακινηθεί ή να μεγαλώσει (σύρσιμο, hover): ο κύκλος το ακολουθεί, εκτός όταν πατιέται
      if (hit) {
        if (!hit.isConnected) hide();
        else if (!pressing || hit.matches(FOLLOW)) aimAt(hit, tx, ty);
      }
      x += (tx - x) * LERP;
      y += (ty - y) * LERP;
      // η σμίκρυνση στο πάτημα μπαίνει μέσα στο transform (όχι στην ιδιότητα scale, που εφαρμόζεται μετά
      // τη μετακίνηση και θα έσπρωχνε τον κύκλο προς την πάνω-αριστερή γωνία της σελίδας)
      dotScale += ((pressing ? PRESS_SCALE : 1) - dotScale) * 0.3;
      for (let i = 0; i < 4; i++) lin[i] += (linT[i] - lin[i]) * 0.3;
      // το σχήμα του εικονιδίου εμφανίζεται όταν ο κύκλος φτάσει πάνω του
      const near = shapeMask !== null && Math.hypot(tx - x, ty - y) < 16;
      const want = near ? shapeMask : null;
      if (want !== maskedShape) {
        maskedShape = want;
        const mask = want ?? '';
        dot.style.maskImage = mask;
        dot.style.webkitMaskImage = mask;
        dot.style.maskSize = '100% 100%';
        dot.style.webkitMaskSize = '100% 100%';
        dot.style.maskRepeat = 'no-repeat';
        dot.style.webkitMaskRepeat = 'no-repeat';
        dot.classList.toggle('is-shape', !!want);
      }
      const [a, b, c, d] = lin;
      dot.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) matrix(${a}, ${b}, ${c}, ${d}, 0, 0) scale(${dotScale})`;
      raf = requestAnimationFrame(frame);
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerout', onOut);
    window.addEventListener('pointerdown', press, { passive: true });
    window.addEventListener('pointerup', release, { passive: true });
    window.addEventListener('pointercancel', release, { passive: true });
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      root.classList.remove('ipad-pointer');
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerout', onOut);
      window.removeEventListener('pointerdown', press);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
  }, []);

  return <div ref={ref} className="ipad-pointer-dot is-hidden" aria-hidden="true" />;
}
