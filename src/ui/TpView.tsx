import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { ONE_TO_ONE } from '../lib/scale';
import type { Theme } from '../lib/theme';
import { buildP, buildT, buildTP, JOIN_START, machiningOf, pieceOffset, shiftPart, TP, tpFootprints, tpPieces } from '../model/tp';
import { scheduleFor } from '../model/tpProcess';
import { atHome, createDrag, nearHome, stepDrag, type DragBody } from '../model/tpDrag';
import type { BBox, Vec3 } from '../model/types';
import type { DimsMode } from '../viewer/dimLayout';
import { COMPACT_STYLE } from '../viewer/dimLayout';
import { Viewer, type FloatPose, type Project, type ViewerApi } from '../viewer/Viewer';
import { viewLabel, type ViewId } from '../viewer/views';
import { HandPose } from './HandPose';
import { TpTools, type ToolsSource } from './TpTools';

// Τ+Π: η άσκηση συναρμογής σε 3D, όπως τα υπόλοιπα σχήματα. Η μπάρα δείχνει την κατεργασία (τρύπες με το
// τρυπάνι, κοπή με το σιδεροπρίονο, λίμα) και μετά τη συναρμογή· σέρνοντάς την ορίζεις πού θα πάει, και η
// κίνηση φτάνει εκεί με τον δικό της ρυθμό (σαν να γίνεται στην πραγματικότητα). Εδώ τα σχήματα δεν γλιστρούν: όταν επιλέγεται
// ένα κομμάτι, το άλλο σβήνει και η κάμερα κάνει zoom στο επιλεγμένο (και ανάποδα για το «μαζί»). Πάνω σε κάθε κομμάτι υπάρχει ένα «χεράκι»
// που δείχνει μόνο εκείνο (ξανά πάτημα: και τα δύο), και δίπλα στη μεγάλη ακμή του μοντέλου μια μπάρα
// που σέρνεται: από ορθογώνια λάμα σε Τ ή Π, ή για τα δύο μαζί, κοπή και μετά συναρμογή.

type Show = 'both' | 'T' | 'P';
const ORDER: Record<Show, number> = { T: 0, both: 1, P: 2 };
const { W, T, LA, LB, TL } = TP;

/** Μέγεθος του χεριού στο μοντέλο (mm), το ύψος του πάνω από την επιφάνεια (1 mm) και το ελάχιστο μέγεθος σε pixel (να πατιέται στο κινητό). */
const HAND_MM = 14;
const HAND_LIFT = 1;
const MIN_HAND_PX = 40;

/**
 * Σύρσιμο (ragdoll): όταν κρατάς πατημένο το χεράκι και κουνήσεις το ποντίκι πάνω από αυτό το όριο (px),
 * το κομμάτι βγαίνει από το σύνολο και ακολουθεί το ποντίκι σαν να κρέμεται από το χέρι (φυσική και
 * συγκρούσεις στο model/tpDrag). Όταν αφήσεις, επιλέγεται το κομμάτι που τράβηξες· αν το αφήσεις κοντά
 * στη θέση του, ο μαγνήτης το ξαναβάζει μέσα και η επιλογή ακυρώνεται.
 */
const DRAG_START_PX = 6;
const DRAG_LIFT = 3; // mm πάνω από το κανονικό του ύψος (μικρότερο από το πάχος: οι συγκρούσεις ισχύουν)
/** όριο (s) για την επιστροφή στη θέση του, αν για κάποιο λόγο δεν κάτσει νωρίτερα */
const RETURN_TIMEOUT = 1.5;
/** διάρκεια (s) της μετάβασης «zoom στο κομμάτι / σβήσιμο του άλλου» */
const FOCUS_TIME = 0.7;
/** μέγιστη απόσταση (mm) από τη θέση του όπου μπορεί να μείνει ένα κομμάτι όταν το αφήνεις· πιο μακριά κόβεται εδώ */
const DROP_RANGE = 150;
/** πόσο (ms) μένουν «ενεργά» τα εργαλεία (κινούνται μπρος-πίσω) μετά την τελευταία κίνηση της μπάρας */
const ACTIVE_MS = 300;
/** διάρκεια (s) της αναπαραγωγής από το 0 στο 100 %: όλη η διαδικασία μαζί, ή ένα κομμάτι μόνο του */
const PLAY_SECONDS: Record<Show, number> = { both: 26, T: 18, P: 18 };

type Piece = 'T' | 'P';
const other = (id: Piece): Piece => (id === 'T' ? 'P' : 'T');

/** Σημείο λαβής (κέντρο του χεριού) κάθε κομματιού, στη θέση του μέσα στο σύνολο (πρόοδος pBoth). */
function anchorOf(id: Piece, pBoth: number): Vec3 {
  const x = pieceOffset(id, pBoth) + (id === 'T' ? LA / 2 - 3 : (TL + LB) / 2); // το Τ λίγο πίσω από το 56
  return [x, W / 2, T];
}

/** Μετάβαση: focus = από το «μαζί» σε ένα κομμάτι, unfocus = από ένα κομμάτι στο «μαζί». */
interface Trans {
  kind: 'focus' | 'unfocus';
  id: Piece;
  pivot: Vec3;
}

/** Πρόοδος της κατεργασίας για ό,τι φαίνεται: στο «μαζί» ως το JOIN_START, στο μεμονωμένο όλη η μπάρα. */
const tauOf = (show: Show, progress: Record<Show, number>) => (show === 'both' ? machiningOf(progress.both) : progress[show]);

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Drag {
  id: 'T' | 'P';
  start: [number, number];
  cursor: [number, number];
  started: boolean;
  /** αφέθηκε κοντά στη θέση του και επιστρέφει εκεί (ακύρωση) */
  returning: boolean;
  returnStart: number;
  body: DragBody;
  raf: number;
  last: number;
}

/** Απόσταση της μπάρας από την ακμή, σε pixel. */
const TRACK_OFFSET = 22;
const TRACK_HEIGHT = 36;
/** Κάτω από αυτό το μήκος (π.χ. πλάγια όψη, όπου η ακμή γίνεται σημείο) η μπάρα μπαίνει οριζόντια κάτω από το μοντέλο. */
const MIN_TRACK = 110;

interface Props {
  theme: Theme;
  dimsMode: DimsMode;
  showHidden: boolean;
  colorMode: boolean;
}

export function TpView({ theme, dimsMode, showHidden, colorMode }: Props) {
  const [show, setShow] = useState<Show>('both');
  const showRef = useRef(show);
  showRef.current = show;
  // Πρόοδος κάθε προβολής (η μπάρα ακολουθεί κατευθείαν το δάχτυλο/ποντίκι, όσο γρήγορα κι αν το κουνάς).
  const [shown, setShown] = useState<Record<Show, number>>({ T: 1, P: 1, both: 1 });
  const [moving, setMoving] = useState(false);
  const [playing, setPlaying] = useState(false);
  const running = moving || playing;
  const shownRef = useRef<Record<Show, number>>({ T: 1, P: 1, both: 1 });
  const idleTimer = useRef(0);
  const toolsRef = useRef<ToolsSource | null>(null);
  const [view, setView] = useState<ViewId | null>('iso');
  // ετικέτες διαστάσεων: εμφάνιση/απόκρυψη (πάνω από την ήδη επιλεγμένη λειτουργία διαστάσεων)
  const [labels, setLabels] = useState(true);
  // όσο κρατάς το δάχτυλο/ποντίκι στη μπάρα, οι ετικέτες κρύβονται· εμφανίζονται όταν το αφήσεις
  const [scrubbing, setScrubbing] = useState(false);
  useEffect(() => {
    const up = () => setScrubbing(false);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, []);
  const viewerRef = useRef<ViewerApi>(null);
  const handT = useRef<HTMLDivElement>(null);
  const handP = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const projectRef = useRef<Project | null>(null);
  const dragRef = useRef<Drag | null>(null);
  // το κομμάτι που κινείται (σέρνεται ή επιστρέφει στη θέση του)· μένει και μετά το άφημα του ποντικιού
  const flyRef = useRef<Drag | null>(null);
  const didDrag = useRef(false);
  const poseRef = useRef<FloatPose>({ pos: [0, 0, 0], rot: [0, 0, 0] });
  const [dragging, setDragging] = useState<'T' | 'P' | null>(null);
  const [trans, setTrans] = useState<Trans | null>(null);
  // Όταν επιλέγεις ένα κομμάτι αφού το έχεις αφήσει κάπου, μένει εκεί (ίσιο) και η κάμερα κάνει zoom πάνω του·
  // αυτή είναι η μετατόπισή του (X, Y) από τη θέση του μέσα στο σύνολο.
  const [focusOffset, setFocusOffset] = useState<[number, number]>([0, 0]);
  const transRaf = useRef(0);
  /** διαφάνεια του κομματιού που σβήνει (focus) ή εμφανίζεται (unfocus) */
  const fadeRef = useRef(1);
  useEffect(() => () => cancelAnimationFrame(transRaf.current), []);

  // στάση κάθε χεριού: ανοιχτό → μισόκλειστο με το ποντίκι πάνω → κλειστό όσο πατιέται
  const [hover, setHover] = useState<Show | null>(null);
  const [pressed, setPressed] = useState<Show | null>(null);

  const p = shown[show];
  const pBoth = shown.both;
  const pieces = useMemo(() => tpPieces(pBoth), [pBoth]);
  // Το μεμονωμένο Τ ή Π μένει εκεί που είναι μέσα στο σύνολο, ώστε η κάμερα να κάνει zoom πάνω του.
  // Όσο σέρνεται ένα κομμάτι, στη σκηνή μένει μόνο το άλλο (στο ίδιο πλαίσιο, χωρίς διαστάσεις).
  const part = useMemo(
    () =>
      dragging
        ? pieces[other(dragging)]
        : show === 'both'
          ? buildTP(p)
          : shiftPart(show === 'T' ? buildT(p) : buildP(p), pieceOffset(show, pBoth) + focusOffset[0], focusOffset[1]),
    [show, p, pBoth, dragging, pieces, focusOffset],
  );

  // Κέντρο της επάνω πλευράς του σώματος κάθε κομματιού (εκεί κάθεται το χεράκι).
  const homeT = anchorOf('T', pBoth);
  const homeP = anchorOf('P', pBoth);
  const shifted = (a: Vec3): Vec3 => [a[0] + focusOffset[0], a[1] + focusOffset[1], a[2]];
  const anchorT = show === 'T' ? shifted(homeT) : homeT;
  const anchorP = show === 'P' ? shifted(homeP) : homeP;
  // Πλαίσιο για τα επίπεδα κοπής της κάμερας: όλη η σκηνή και όσο μακριά μπορεί να μείνει ένα κομμάτι.
  const clipBox = useMemo(() => {
    const { min, max } = pieces.T.bbox;
    return { min: [min[0] - DROP_RANGE, min[1] - DROP_RANGE, min[2]], max: [max[0] + DROP_RANGE, max[1] + DROP_RANGE, max[2]] } as BBox;
  }, [pieces]);

  /**
   * Μετάβαση ανάμεσα στο «μαζί» και σε ένα κομμάτι. focus: το κομμάτι πηγαίνει (από εκεί που αφέθηκε) στη
   * θέση του, το άλλο σβήνει, και η κάμερα κάνει zoom πάνω του. unfocus: το άλλο εμφανίζεται και η
   * κάμερα απομακρύνεται ώστε να χωρούν και τα δύο.
   */
  const runTransition = (kind: Trans['kind'], id: Piece, from?: FloatPose) => {
    cancelAnimationFrame(transRaf.current);
    setPlaying(false);
    // η κοπή του κομματιού μένει ίδια ανάμεσα στο «μαζί» (0…0,5 κοπή) και στο μεμονωμένο (0…1)
    let nextBoth = pBoth;
    if (kind === 'focus') jump({ [id]: machiningOf(pBoth) });
    else {
      // έτοιμο κομμάτι: το «μαζί» μένει όπου ήταν (τουλάχιστον κομμένο)· αλλιώς στο ίδιο σημείο της κατεργασίας
      nextBoth = shown[id] >= 1 ? Math.max(pBoth, JOIN_START) : shown[id] * JOIN_START;
      jump({ both: nextBoth });
    }
    const pivot = anchorOf(id, nextBoth);
    // focus: το κομμάτι μένει εκεί που το άφησες (ίσιο), unfocus: γυρίζει από εκεί που είναι στη θέση του
    const clampRange = (v: number) => Math.max(-DROP_RANGE, Math.min(DROP_RANGE, v));
    const dropOff: [number, number] = from ? [clampRange(from.pos[0] - pivot[0]), clampRange(from.pos[1] - pivot[1])] : [0, 0];
    const endOff = kind === 'focus' ? dropOff : ([0, 0] as [number, number]);
    const startPose: FloatPose =
      from ?? (kind === 'unfocus' ? { pos: [pivot[0] + focusOffset[0], pivot[1] + focusOffset[1], pivot[2]], rot: [0, 0, 0] } : { pos: [...pivot], rot: [0, 0, 0] });
    const start = startPose;
    const end: Vec3 = [pivot[0] + endOff[0], pivot[1] + endOff[1], pivot[2]];
    if (kind === 'focus') setFocusOffset(dropOff);
    poseRef.current = start;
    fadeRef.current = kind === 'focus' ? 1 : 0;
    flyRef.current = null;
    setDragging(null);
    setShow(kind === 'focus' ? id : 'both');
    setTrans({ kind, id, pivot });
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = reducedMotion() ? 1 : Math.min(1, (now - t0) / (FOCUS_TIME * 1000));
      const e = easeInOut(t);
      const lerp = (a: Vec3, b: Vec3): Vec3 => [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e, a[2] + (b[2] - a[2]) * e];
      poseRef.current = { pos: lerp(start.pos, end), rot: lerp(start.rot, [0, 0, 0]) };
      fadeRef.current = kind === 'focus' ? 1 - e : e;
      if (t < 1) transRaf.current = requestAnimationFrame(tick);
      else {
        if (kind === 'unfocus') setFocusOffset([0, 0]);
        setTrans(null);
      }
    };
    transRaf.current = requestAnimationFrame(tick);
  };
  /** Αλλαγή προόδου (η μπάρα και ό,τι φαίνεται). */
  function jump(next: Partial<Record<Show, number>>) {
    shownRef.current = { ...shownRef.current, ...next };
    setShown((st) => ({ ...st, ...next }));
  }
  // Τα εργαλεία «δουλεύουν» όσο κουνιέται η μπάρα και ηρεμούν λίγο μετά.
  const wake = () => {
    setMoving(true);
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setMoving(false), ACTIVE_MS);
  };
  useEffect(() => () => window.clearTimeout(idleTimer.current), []);

  // Αναπαραγωγή: η μπάρα προχωρά ομαλά με σταθερό ρυθμό ώσπου να φτάσει το 100 %.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const cur = shownRef.current[show];
      const v = Math.min(1, cur + dt / PLAY_SECONDS[show]);
      jump({ [show]: v });
      if (v >= 1) setPlaying(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, show]);
  const togglePlay = () => {
    if (playing) return setPlaying(false);
    // στο τέλος, ξαναρχίζει από την αρχή
    if (shownRef.current[show] >= 1) jump({ [show]: 0 });
    setPlaying(true);
  };

  const transState = useRef({ runTransition });
  transState.current = { runTransition };

  // Το χεράκι είναι ένα επίπεδο χέρι (παλάμη προς τα κάτω) που βρίσκεται 1 mm πάνω από την επάνω
  // επιφάνεια του κομματιού και η σκιά του πέφτει πάνω στην επιφάνεια. Μπαίνει στο επίπεδο XY του
  // μοντέλου με affine μετασχηματισμό από την προβολή της κάμερας, άρα γυρίζει και μεγεθύνεται μαζί του.
  const place = (el: HTMLElement | null, project: Project, at: Vec3, dir: [number, number], handZ = at[2] + HAND_LIFT) => {
    if (!el) return;
    const ICON = 24;
    const o = project(at);
    const ex = project([at[0] + 1, at[1], at[2]]);
    const ey = project([at[0], at[1] + 1, at[2]]);
    const exx = ex[0] - o[0], exy = ex[1] - o[1], eyx = ey[0] - o[0], eyy = ey[1] - o[1];
    const det = exx * eyy - exy * eyx;
    // όψεις «από το πλάι» (το επίπεδο φαίνεται ως γραμμή): το χεράκι δεν έχει νόημα, κρύβεται
    if (Math.abs(det) < 0.6) {
      el.style.visibility = 'hidden';
      return;
    }
    const pxPerMm = Math.sqrt(Math.abs(det));
    const s = Math.max(HAND_MM, MIN_HAND_PX / pxPerMm) / ICON; // mm ανά μονάδα εικονιδίου
    const matrix = (z: number) => {
      const p = project([at[0], at[1], z]);
      // εικονίδιο (u, v) → επίπεδο: τα δάχτυλα (προς τα πάνω στο εικονίδιο) δείχνουν κατά dir,
      // το δεξί του εικονιδίου είναι κάθετο σε αυτά
      const [dx, dy] = dir;
      const m = [s * (dy * exx - dx * eyx), s * (dy * exy - dx * eyy), -s * (dx * exx + dy * eyx), -s * (dx * exy + dy * eyy)];
      const e = p[0] - ICON / 2 * (m[0] + m[2]);
      const f = p[1] - ICON / 2 * (m[1] + m[3]);
      return `matrix(${m[0]}, ${m[1]}, ${m[2]}, ${m[3]}, ${e}, ${f})`;
    };
    el.style.setProperty('--mh', matrix(handZ));
    el.style.setProperty('--ms', matrix(at[2]));
    el.style.visibility = 'visible';
  };

  const onFrame = (project: Project, size: { width: number; height: number }) => {
    projectRef.current = project;
    const flying = flyRef.current;
    // τα δάχτυλα του Τ δείχνουν προς το Π, του Π προς το Τ· στο σύρσιμο το χέρι ακολουθεί το κομμάτι
    const handAt = (id: 'T' | 'P', anchor: Vec3, sign: number) => {
      const el = id === 'T' ? handT.current : handP.current;
      if (flying?.id !== id) return place(el, project, anchor, [sign, 0]);
      const { pos, yaw } = flying.body;
      place(el, project, [pos[0], pos[1], T], [sign * Math.cos(yaw), sign * Math.sin(yaw)], pos[2] + HAND_LIFT);
    };
    handAt('T', anchorT, 1);
    handAt('P', anchorP, -1);

    const el = track.current;
    if (!el) return;
    const { min, max } = part.bbox;
    const center = project([(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]);
    // Από τις τέσσερις μεγάλες ακμές (κατά μήκος του X), εκείνη που φαίνεται πιο δεξιά και ψηλά.
    let best: [[number, number], [number, number]] | null = null;
    let bestScore = -Infinity;
    for (const y of [min[1], max[1]])
      for (const z of [min[2], max[2]]) {
        const a = project([min[0], y, z]);
        const b = project([max[0], y, z]);
        const score = (a[0] + b[0]) / 2 - 0.5 * ((a[1] + b[1]) / 2);
        if (score > bestScore) {
          bestScore = score;
          best = [a, b];
        }
      }
    let [a, b] = best!;
    if (b[0] < a[0]) [a, b] = [b, a]; // πάντα από αριστερά προς τα δεξιά: 0 % → 100 %
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    let len = Math.hypot(dx, dy);
    let x0: number, y0: number;
    if (len >= MIN_TRACK) {
      // κάθετα στην ακμή, προς τα έξω από το μοντέλο
      let nx = -dy / len, ny = dx / len;
      if (nx * ((a[0] + b[0]) / 2 - center[0]) + ny * ((a[1] + b[1]) / 2 - center[1]) < 0) [nx, ny] = [-nx, -ny];
      x0 = a[0] + nx * TRACK_OFFSET;
      y0 = a[1] + ny * TRACK_OFFSET;
    } else {
      let bottom = -Infinity;
      for (const x of [min[0], max[0]])
        for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) bottom = Math.max(bottom, project([x, y, z])[1]);
      len = Math.min(280, size.width - 40);
      dx = len;
      dy = 0;
      x0 = center[0] - len / 2;
      y0 = Math.min(bottom + TRACK_OFFSET, size.height - TRACK_HEIGHT);
    }
    el.style.left = `${x0}px`;
    el.style.top = `${y0 - TRACK_HEIGHT / 2}px`;
    el.style.width = `${len}px`;
    const ang = Math.atan2(dy, dx);
    el.style.transform = `rotate(${ang}rad)`;
    el.style.setProperty('--ang', `${ang}rad`);
    el.style.visibility = 'visible';
  };

  // Μετατροπή μετατόπισης οθόνης (px) σε μετατόπιση στο επίπεδο XY της επάνω επιφάνειας.
  const screenToPlane = (dx: number, dy: number): [number, number] => {
    const project = projectRef.current;
    if (!project) return [0, 0];
    const o = project([0, 0, T]);
    const ex = project([1, 0, T]);
    const ey = project([0, 1, T]);
    const a = ex[0] - o[0], b = ey[0] - o[0], c = ex[1] - o[1], d = ey[1] - o[1];
    const det = a * d - b * c;
    if (Math.abs(det) < 0.6) return [0, 0];
    return [(d * dx - b * dy) / det, (-c * dx + a * dy) / det];
  };

  const startDrag = (d: Drag) => {
    d.started = true;
    didDrag.current = true;
    flyRef.current = d;
    d.last = performance.now();
    poseRef.current = { pos: [...d.body.pivot] as Vec3, rot: [0, 0, 0] };
    setDragging(d.id);
    const step = (now: number) => {
      const dt = (now - d.last) / 1000;
      d.last = now;
      const { pivot } = d.body;
      if (d.returning) {
        // επιστροφή: ο στόχος είναι η θέση συναρμογής
        stepDrag(d.body, [...pivot], dt);
        if (atHome(d.body) || now - d.returnStart > RETURN_TIMEOUT * 1000) {
          flyRef.current = null;
          setDragging(null);
          return;
        }
      } else {
        const [wx, wy] = screenToPlane(d.cursor[0] - d.start[0], d.cursor[1] - d.start[1]);
        stepDrag(d.body, [pivot[0] + wx, pivot[1] + wy, pivot[2] + DRAG_LIFT], dt);
      }
      const { pos, rx, ry, yaw } = d.body;
      poseRef.current = { pos: [pos[0], pos[1], pos[2]], rot: [rx, ry, yaw] };
      d.raf = requestAnimationFrame(step);
    };
    d.raf = requestAnimationFrame(step);
  };

  const dragState = useRef({ startDrag });
  dragState.current = { startDrag };
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      d.cursor = [e.clientX, e.clientY];
      if (!d.started && Math.hypot(d.cursor[0] - d.start[0], d.cursor[1] - d.start[1]) > DRAG_START_PX) dragState.current.startDrag(d);
    };
    const end = (e: PointerEvent) => {
      const d = dragRef.current;
      dragRef.current = null;
      setPressed(null);
      if (!d?.started) return;
      // αφέθηκε κοντά στη θέση του (ή ακυρώθηκε το σύρσιμο): ξαναμπαίνει μέσα, χωρίς επιλογή
      if (e.type !== 'pointerup' || nearHome(d.body)) {
        d.returning = true;
        d.returnStart = performance.now();
        return;
      }
      cancelAnimationFrame(d.raf);
      // «μπαίνει στην επιλογή»: zoom στο κομμάτι που τράβηξες, το άλλο σβήνει
      const { pos, rx, ry, yaw } = d.body;
      transState.current.runTransition('focus', d.id, { pos: [pos[0], pos[1], pos[2]], rot: [rx, ry, yaw] });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      if (flyRef.current) cancelAnimationFrame(flyRef.current.raf);
    };
  }, []);

  const beginPress = (id: 'T' | 'P', e: React.PointerEvent) => {
    setPressed(id);
    didDrag.current = false;
    if (show !== 'both' || flyRef.current || trans || !canDrag) return; // μόνο από το σύνολο βγαίνει κομμάτι, ένα τη φορά
    const pivot: Vec3 = [...(id === 'T' ? anchorT : anchorP)];
    const rects = tpFootprints(pBoth);
    dragRef.current = {
      id,
      start: [e.clientX, e.clientY],
      cursor: [e.clientX, e.clientY],
      started: false,
      returning: false,
      returnStart: 0,
      body: createDrag(pivot, rects[id], rects[id === 'T' ? 'P' : 'T']),
      raf: 0,
      last: 0,
    };
  };

  const hand = (id: 'T' | 'P', label: string, ref: RefObject<HTMLDivElement | null>) => {
    const pose = pressed === id ? 1 : hover === id ? 0.5 : 0;
    return (
    <div ref={ref} className="tp-pin">
      <span className="tp-pin-shadow" aria-hidden="true">
        <HandPose pose={pose} />
      </span>
      <div className="tp-pin-hand">
        <button
          type="button"
          className="tp-hand"
          aria-pressed={show === id}
          aria-label={show === id ? 'Δείξε το Τ και το Π μαζί' : `Δείξε μόνο το ${label}`}
          title={show === id ? 'Τ+Π μαζί' : `Μόνο το ${label}`}
          onPointerEnter={() => setHover(id)}
          onPointerLeave={() => setHover((h) => (h === id ? null : h))}
          onPointerDown={(e) => beginPress(id, e)}
          onClick={() => {
            if (didDrag.current || trans) return; // το σύρσιμο έχει ήδη κάνει την επιλογή
            runTransition(show === id ? 'unfocus' : 'focus', id);
          }}
        >
          <HandPose pose={pose} />
        </button>
      </div>
    </div>
    );
  };

  const name = show === 'both' ? 'Τ+Π' : show === 'T' ? 'Τ' : 'Π';
  // Τα χεράκια φαίνονται όταν η μπάρα στέκεται. Σύρσιμο κομματιού μόνο στην αρχή ή στο τέλος της κατεργασίας
  // (ορθογώνια ή έτοιμα κομμάτια), όπου τα σχήματα για τις συγκρούσεις είναι γνωστά.
  const tau = tauOf(show, shown);
  const handsOn = !trans && !running;
  const canDrag = tau <= 0 || tau >= 1;

  // Τα εργαλεία διαβάζουν σε κάθε καρέ αυτό το αντικείμενο (η πρόοδος ενημερώνεται και από την κίνηση της μπάρας).
  const toolOffsets: ToolsSource['offsets'] =
    trans || dragging
      ? {}
      : show === 'both'
        ? { T: [pieceOffset('T', pBoth), 0], P: [pieceOffset('P', pBoth), 0] }
        : { [show]: [pieceOffset(show, pBoth) + focusOffset[0], focusOffset[1]] };
  toolsRef.current = { schedule: scheduleFor(show), tau: tauOf(show, shownRef.current), offsets: toolOffsets, running };
  const percent = Math.round(p * 100);
  const overlay = (
    <>
      {handsOn && show !== 'P' && hand('T', 'Τ', handT)}
      {handsOn && show !== 'T' && hand('P', 'Π', handP)}
      <div ref={track} className="tp-track">
        <span className="tp-track-label">
          {name} <strong>{percent}%</strong>
        </span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={percent}
          aria-label={show === 'both' ? 'Κοπή και συναρμογή του Τ και του Π' : `Κοπή: από ορθογώνιο σε ${name}`}
          aria-valuetext={`${percent}%`}
          onPointerDown={() => {
            setScrubbing(true);
            setPlaying(false);
          }}
          onChange={(e) => {
            jump({ [show]: Number(e.target.value) / 100 });
            wake();
          }}
        />
        <button
          type="button"
          className="tp-play"
          aria-label={playing ? 'Παύση' : 'Παίξε το animation'}
          title={playing ? 'Παύση' : 'Παίξε το animation'}
          onClick={togglePlay}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor">
            {playing ? <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /> : <path d="M8 5.5v13l11-6.5z" />}
          </svg>
        </button>
      </div>
    </>
  );

  return (
    <div className="tp-pane">
      <div className="viewer tp-viewer">
        <Viewer
          ref={viewerRef}
          part={part}
          scale={ONE_TO_ONE}
          dimsMode={labels && !scrubbing && !running ? dimsMode : 'none'}
          dimStyle={COMPACT_STYLE}
          clipBox={clipBox}
          showHidden={showHidden}
          colorMode={colorMode}
          theme={theme}
          shape={{ key: `tp-${show}`, index: ORDER[show] }}
          onViewChange={setView}
          onFrame={onFrame}
          overlay={overlay}
          metal
          noSlide
          scene={<TpTools sourceRef={toolsRef} />}
          hidePart={!!trans}
          ghost={trans ? { part: pieces[other(trans.id)], opacityRef: fadeRef } : null}
          floating={
            trans
              ? { part: pieces[trans.id], pivot: trans.pivot, poseRef }
              : dragging
                ? { part: pieces[dragging], pivot: flyRef.current?.body.pivot ?? [0, 0, T], poseRef }
                : null
          }
        />
        <div className="chip chip-view" aria-live="polite">
          Όψη: <strong>{viewLabel(view)}</strong>
        </div>
      </div>
      <nav className="view-toolbar" aria-label="Όψη και ετικέτες">
        <button
          type="button"
          className="view-button"
          aria-pressed={view === 'iso'}
          onClick={() => viewerRef.current?.goTo('iso')}
          title="Ισομετρική όψη, προσαρμοσμένη να χωράει στην οθόνη"
        >
          Ισομετρική
        </button>
        <button
          type="button"
          className="view-button"
          aria-pressed={labels}
          onClick={() => setLabels((v) => !v)}
          title={labels ? 'Κρύψε τις ετικέτες διαστάσεων' : 'Δείξε τις ετικέτες διαστάσεων'}
        >
          Ετικέτες διαστάσεων
        </button>
      </nav>
    </div>
  );
}
