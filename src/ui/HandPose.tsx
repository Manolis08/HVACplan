import { useEffect, useRef, useState } from 'react';

// Το εικονίδιο «χεράκι» της εφαρμογής σε τρεις στάσεις: 0 ανοιχτό, 0,5 μισόκλειστο, 1 κλειστό.
// Είναι το ίδιο περίγραμμα με το εικονίδιο hand· καθώς κλείνει, οι κορυφές των δαχτύλων κατεβαίνουν
// προς την παλάμη (μένουν οι αρθρώσεις σαν γροθιά). Η αλλαγή στάσης είναι ομαλή (ease), εκτός αν ο
// χρήστης έχει ζητήσει λιγότερη κίνηση.

/** ύψος κορυφής κάθε δαχτύλου: ανοιχτό → κλειστό */
const TOPS: [number, number][] = [
  [5, 9.4],
  [4, 8.8],
  [6, 9.6],
];
const DURATION = 150;

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Ομαλή μετάβαση της στάσης προς τον στόχο. */
function useCurl(target: number) {
  const [value, setValue] = useState(target);
  const ref = useRef(target);
  useEffect(() => {
    if (reduced()) {
      ref.current = target;
      setValue(target);
      return;
    }
    const from = ref.current;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION);
      ref.current = from + (target - from) * (1 - (1 - t) * (1 - t));
      setValue(ref.current);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return value;
}

const r = (n: number) => Math.round(n * 100) / 100;

function handPath(c: number) {
  const [a, b, d] = TOPS.map(([open, closed]) => r(open + (closed - open) * c));
  return (
    `M9 11V${a}A1.5 1.5 0 0 1 12 ${a}V10.5` +
    `M12 10V${b}A1.5 1.5 0 0 1 15 ${b}V10.5` +
    `M15 10.5V${d}A1.5 1.5 0 0 1 18 ${d}v${r(14 - d)}a7 7 0 0 1-7 7h-.6a6 6 0 0 1-4.6-2.2L${r(3.6 + 1.8 * c)} 15a1.6 1.6 0 0 1 2.4-2.1L9 15.5V11`
  );
}

interface Props {
  /** 0 ανοιχτό · 0,5 μισόκλειστο · 1 κλειστό */
  pose: number;
  size?: number;
}

export function HandPose({ pose, size = 24 }: Props) {
  const c = useCurl(pose);
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={handPath(c)} />
    </svg>
  );
}
