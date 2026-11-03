import { useEffect, useRef, useState } from 'react';
import { THEMES } from '../lib/theme';
import { FLOORS } from './floors';
import { pickPreset, presetMismatch } from './presets';
import { wantIntro } from './wantIntro';
import { INTRO } from './timeline';

// Intro κατά το άνοιγμα της εφαρμογής: πτήση πάνω από την εφαρμογή σε 3D, και μετά μπαίνει μέσα της.
// Παίζει κάθε φορά που ανοίγει η εφαρμογή· ένα κλικ, άγγιγμα ή πλήκτρο το προσπερνά. Δεν παίζει όταν το
// σύστημα ζητά λιγότερη κίνηση, όταν το URL έχει ?intro=0, ή αν δεν φορτώσει γρήγορα.

/** αν οι εικόνες δεν έχουν φορτώσει ως τότε, η εφαρμογή ανοίγει κανονικά χωρίς intro */
const LOAD_TIMEOUT_MS = 2500;
/** σβήσιμο όταν δεν φορτώνει */
const SKIP_FADE = 0.25;
/** κάθε κλικ/πλήκτρο επιταχύνει το φιλμ· η επιτάχυνση ξεθωριάζει με χρόνο ημιζωής HALF_LIFE */
const CLICK_BOOST = 1.6;
const MAX_RATE = 8;
const HALF_LIFE = 0.7;

type Phase = 'loading' | 'playing' | 'leaving' | 'gone';

export function Intro() {
  const [phase, setPhase] = useState<Phase>(() => (wantIntro() ? 'loading' : 'gone'));
  const [fade, setFade] = useState(INTRO.fade);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const leaveRef = useRef<(fast: boolean) => void>(() => {});

  useEffect(() => {
    if (phase !== 'loading') return;
    let cancelled = false;
    let raf = 0;
    let film: import('./film').Film | null = null;
    let left = false;
    let boost = 0;

    const leave = (fast: boolean) => {
      if (left) return;
      left = true;
      cancelAnimationFrame(raf);
      setFade(fast ? SKIP_FADE : INTRO.fade);
      setPhase('leaving');
      window.setTimeout(() => {
        film?.dispose();
        film = null;
        setPhase('gone');
      }, (fast ? SKIP_FADE : INTRO.fade) * 1000 + 50);
    };
    leaveRef.current = () => {
      boost += CLICK_BOOST;
    };
    const timeout = window.setTimeout(() => leave(true), LOAD_TIMEOUT_MS);

    (async () => {
      const { createFilm, loadImages } = await import('./film');
      // η φωτογραφία της εφαρμογής που ταιριάζει καλύτερα στο μέγεθος του παραθύρου (βλ. presets.ts)
      const preset = pickPreset(window.innerWidth, window.innerHeight);
      const mobile = !!preset.mobile;
      // το φιλμ είναι φωτογραφημένο σε κάθε φόντο, ώστε η είσοδος στην εφαρμογή να ταιριάζει
      const theme = (THEMES.find((x) => x.id === document.documentElement.dataset.theme) ?? THEMES[0]).id;
      const base = `${import.meta.env.BASE_URL}intro/${preset.name}/${theme}/`;
      const layout = await (await fetch(base + 'layout.json')).json();
      const images = await loadImages(base, layout);
      if (cancelled || left || !canvasRef.current) return;
      film = createFilm(canvasRef.current, layout, images, mobile, theme);
      if (!film) return leave(true);
      window.clearTimeout(timeout);
      setPhase('playing');
      const t0 = performance.now();
      // μόνο στην ανάπτυξη: ?introAt=1.6 κρατά το intro παγωμένο σε εκείνο το δευτερόλεπτο (για έλεγχο καρέ)
      const still = import.meta.env.DEV ? Number(new URLSearchParams(window.location.search).get('introAt') ?? NaN) : NaN;
      let t = 0;
      let last = t0;
      const tick = (now: number) => {
        if (Number.isFinite(still)) {
          film?.seek(still);
          raf = requestAnimationFrame(tick);
          return;
        }
        const dt = Math.min(0.5, (now - last) / 1000);
        last = now;
        boost *= Math.pow(0.5, dt / HALF_LIFE);
        t += dt * Math.min(MAX_RATE, 1 + boost);
        film?.seek(Math.min(t, INTRO.end));
        if (t >= INTRO.end) {
          // τελείωσε η βουτιά: αν το παράθυρο έχει το μέγεθος της φωτογραφίας, το τελευταίο καρέ είναι ίδιο με την
          // εφαρμογή και φεύγει αμέσως. Αλλιώς, η διάταξη της εφαρμογής διαφέρει λίγα pixel (η φωτογραφία τεντώνεται στο
          // μέγεθος του παραθύρου), και σβήνει πολύ γρήγορα (0,12–0,25 s, ανάλογα με τη διαφορά) ώστε να μη φανεί «κόψιμο»
          const mismatch = presetMismatch(preset, window.innerWidth, window.innerHeight);
          const blend = mismatch < 0.003 ? 0 : Math.min(0.25, 0.12 + mismatch * 3);
          if (blend > 0) {
            setFade(blend);
            setPhase('leaving');
          } else {
            setPhase('gone');
          }
          window.setTimeout(() => {
            film?.dispose();
            film = null;
            setPhase('gone');
          }, blend * 1000 + 200);
          return;
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    })().catch(() => leave(true));

    const onResize = () => film?.resize();
    window.addEventListener('resize', onResize);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(timeout);
      window.removeEventListener('resize', onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // κάθε κλικ, άγγιγμα ή πλήκτρο επιταχύνει το φιλμ (όσο πιο γρήγορα, τόσο πιο πολύ)
  useEffect(() => {
    if (phase !== 'loading' && phase !== 'playing') return;
    const skip = () => leaveRef.current(true);
    const opts = { capture: true, passive: true } as const;
    window.addEventListener('pointerdown', skip, opts);
    window.addEventListener('keydown', skip, opts);
    return () => {
      window.removeEventListener('pointerdown', skip, opts);
      window.removeEventListener('keydown', skip, opts);
    };
  }, [phase]);

  const [c0, c1] = FLOORS[document.documentElement.dataset.theme ?? ''] ?? FLOORS.light;
  const floorCss = `radial-gradient(120% 100% at 50% 50%, ${c0}, ${c1})`;
  if (phase === 'gone') return null;
  return (
    <div className={`intro${phase === 'leaving' ? ' leaving' : ''}`} style={{ transitionDuration: `${fade}s`, transitionTimingFunction: 'ease-in-out', background: floorCss }} aria-hidden="true">
      <canvas ref={canvasRef} className="intro-canvas" />
    </div>
  );
}
