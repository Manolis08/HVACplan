import { useEffect, useRef } from 'react';
import './ipad-pointer.css';

// Δρομέας σαν του iPad: ένας θολωμένος κύκλος που ακολουθεί τον δείκτη με ελαφρά καθυστέρηση, και γίνεται
// σχήμα του κουμπιού κάτω από τον δείκτη. Εμφανίζεται μόνο με ποντίκι, trackpad ή γραφίδα· στα πεδία
// κειμένου μένει το κανονικό γράμμα, και στην αφή δεν εμφανίζεται.

const SIZE = 28;
const PAD = 4;
const LERP = 0.34;
const TARGET =
  'button:not(:disabled), a[href], [role="button"], [role="tab"], [role="switch"], [role="menuitem"], select, label, summary, input[type="checkbox"], input[type="radio"], input[type="range"], [data-pointer]';
const TEXT =
  'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]), textarea, [contenteditable="true"]';

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

    const aimAt = (el: Element | null, cx: number, cy: number) => {
      if (el) {
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
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest(TEXT)) return hide();
      if (dot.classList.contains('is-hidden')) {
        x = e.clientX;
        y = e.clientY;
        dot.classList.remove('is-hidden');
      }
      hit = el?.closest(TARGET) ?? null;
      aimAt(hit, e.clientX, e.clientY);
    };

    // όταν ο δείκτης φεύγει από τη σελίδα
    const onOut = (e: PointerEvent) => {
      if (!e.relatedTarget) hide();
    };
    // αν η σελίδα κινηθεί κάτω από τον δείκτη, το κουμπί ξαναμετριέται
    const onScroll = () => {
      if (hit) aimAt(hit, tx, ty);
    };
    const press = () => dot.classList.add('is-press');
    const release = () => dot.classList.remove('is-press');

    const frame = () => {
      x += (tx - x) * LERP;
      y += (ty - y) * LERP;
      dot.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
      raf = requestAnimationFrame(frame);
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerout', onOut);
    window.addEventListener('pointerdown', press, { passive: true });
    window.addEventListener('pointerup', release, { passive: true });
    window.addEventListener('pointercancel', release, { passive: true });
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      root.classList.remove('ipad-pointer');
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerout', onOut);
      window.removeEventListener('pointerdown', press);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      window.removeEventListener('scroll', onScroll, { capture: true });
    };
  }, []);

  return <div ref={ref} className="ipad-pointer-dot is-hidden" aria-hidden="true" />;
}
