// Χρονοδιάγραμμα του intro: πού κοιτάζει η κάμερα, από πόσο μακριά και με ποια κλίση, και πόσο έχει
// σηκωθεί κάθε στοιχείο, σε κάθε χρονική στιγμή t. Όλα είναι συναρτήσεις του t (χωρίς χρονόμετρα), ώστε
// κάθε καρέ να υπολογίζεται από την αρχή. Μονάδες: px της σελίδας (της φωτογραφίας της εφαρμογής).
//
//   0 – 5,0 s   πτήση: χαμηλά πάνω από την εφαρμογή, κοιτάζοντας προς τα πάνω, με σταθερή ταχύτητα
//   4,5 – 5,9   ανάβαση: η κάμερα απομακρύνεται, ισιώνει από πάνω, τα στοιχεία κάθονται στη θέση τους
//   5,9 – 6,1   όλη η εφαρμογή από πάνω, η κάμερα πλησιάζει ελάχιστα (3,5 %)
//   6,1 – 6,7   βουτιά: η εφαρμογή μεγαλώνει ώσπου να γεμίσει την οθόνη
//   6,7 – 7,0   παράδοση στην πραγματική εφαρμογή

export const INTRO = {
  flightEnd: 5.0,
  rise: [4.5, 5.9] as const,
  over: [5.9, 6.1] as const,
  dive: [6.1, 6.7] as const,
  /** το φιλμ τελειώνει εδώ· μετά σβήνει και φαίνεται η εφαρμογή */
  end: 6.7,
  fade: 0.3,
};

/**
 * Η πτήση, χωριστά για υπολογιστή και κινητό (το κινητό κάδρο είναι ψηλό και στενό, οπότε η κάμερα
 * κοιτάζει λιγότερο πλάγια για να μη φαίνεται άδειο δάπεδο):
 *   lx, ly0 → ly1  σημείο εστίασης, ως κλάσμα πλάτους/ύψους της εφαρμογής
 *   view           πόσο από το πλάτος της εφαρμογής φαίνεται στο σημείο εστίασης στην αρχή
 *   tilt           κλίση από την κατακόρυφη (μοίρες)
 *   pullback       πόσο μεγαλώνει ομαλά η απόσταση στη διάρκεια της πτήσης (ποτέ δεν ξαναμικραίνει)
 *   shift          μετατόπιση του φακού στην αρχή (σβήνει ως το τέλος της πτήσης)
 *   lift           πόσο σηκώνονται τα στοιχεία (πολλαπλασιαστής)
 */
export const FLIGHT = {
  desktop: { lx: 0.42, ly0: 0.2, ly1: 0.74, view: 0.52, tilt: 56, pullback: 0.25, shift: 0.26, lift: 1 },
  mobile: { lx: 0.5, ly0: 0.32, ly1: 0.62, view: 0.72, tilt: 42, pullback: 0.05, shift: 0.42, lift: 0.6 },
};
/** περιθώριο γύρω από την εφαρμογή όταν φαίνεται ολόκληρη από πάνω */
const OVER_FILL = 0.84;
const CORNER = 24;

export interface CameraFrame {
  /** σημείο που κοιτάζει η κάμερα, στη σελίδα */
  lx: number;
  ly: number;
  /** απόσταση από αυτό το σημείο */
  D: number;
  /** κλίση από την κατακόρυφη (rad): 0 = ακριβώς από πάνω */
  tilt: number;
  /** εστιακή απόσταση σε px οθόνης */
  F: number;
  /** στρογγύλεμα γωνιών της εφαρμογής (px σελίδας) */
  corner: number;
  /** σκιά της εφαρμογής πάνω στο «δάπεδο» (0…1) */
  pageShadow: number;
  /** μετατόπιση του κέντρου του φακού (κλάσμα του μισού ύψους): το σημείο εστίασης λίγο πιο ψηλά στο κάδρο,
   *  ώστε η εφαρμογή να γεμίζει το κάδρο χωρίς να γυρίσει η κάμερα */
  shift: number;
}

export interface Piece {
  x: number;
  y: number;
  w: number;
  h: number;
  /** πόσο σηκώνεται (px) και πόσο «στέκεται» προς τον φακό (μοίρες) */
  z: number;
  a: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const smooth = (t: number) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};
const ramp = (t: number, t0: number, t1: number) => smooth((t - t0) / (t1 - t0));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/**
 * Ταχύτητα κατά μήκος της εφαρμογής, ως κλάσμα της ταχύτητας «κρουαζιέρας»: ξεκινά από στάση, μισή ως το
 * 0,9 s, διπλασιάζεται ως το 1,2 s, σταθερή ως το 4,3 s, και ηρεμεί καθώς φτάνει στο κάτω μέρος.
 */
export function speedShare(t: number) {
  if (t <= 0) return 0;
  if (t < 0.45) return 0.5 * smooth(t / 0.45);
  if (t < 0.9) return 0.5;
  if (t < 1.2) return lerp(0.5, 1, ramp(t, 0.9, 1.2));
  if (t < 4.3) return 1;
  if (t < 5.0) return lerp(1, 0.12, ramp(t, 4.3, 5.0));
  if (t < 5.5) return lerp(0.12, 0, ramp(t, 5.0, 5.5));
  return 0;
}

/** Μια ομαλή «τραπεζοειδής» κίνηση από 0 σε 1: επιτάχυνση t0–t1, σταθερά t1–t2, επιβράδυνση t2–t3. */
export function trapezoid(t: number, t0: number, t1: number, t2: number, t3: number) {
  // ολοκλήρωμα ταχύτητας με ομαλές (smoothstep) ράμπες, κανονικοποιημένο στο 1
  const total = 0.5 * (t1 - t0) + (t2 - t1) + 0.5 * (t3 - t2);
  // ακριβές ολοκλήρωμα του smoothstep: ∫0^u (3s² − 2s³) ds = u³ − u⁴/2
  const S = (u: number) => u * u * u - (u * u * u * u) / 2;
  let a = 0;
  if (t <= t0) return 0;
  if (t >= t3) return 1;
  if (t < t1) a = (t1 - t0) * S((t - t0) / (t1 - t0));
  else {
    a = 0.5 * (t1 - t0);
    if (t < t2) a += t - t1;
    else {
      a += t2 - t1;
      const u = (t - t2) / (t3 - t2);
      a += (t3 - t2) * (u - S(u));
    }
  }
  return a / total;
}

export function makeTimeline(page: { w: number; h: number }, view: { w: number; h: number }, mobile: boolean) {
  const P = mobile ? FLIGHT.mobile : FLIGHT.desktop;
  const F = 1.632 * view.h;
  const TILT = (P.tilt * Math.PI) / 180;
  const lx = page.w * P.lx;
  const ly0 = page.h * P.ly0;
  const ly1 = page.h * P.ly1;
  // αρχική απόσταση: στο σημείο εστίασης φαίνεται το P.view του πλάτους της εφαρμογής
  const D0 = (P.view * page.w * F) / view.w;

  // ολοκλήρωμα της ταχύτητας → θέση κατά μήκος της εφαρμογής (πίνακας ανά 1 ms)
  const STEP = 0.001;
  const N = Math.ceil(5.6 / STEP) + 1;
  const dist = new Float64Array(N);
  for (let i = 1; i < N; i++) dist[i] = dist[i - 1] + 0.5 * (speedShare((i - 1) * STEP) + speedShare(i * STEP)) * STEP;
  const cruise = (ly1 - ly0) / dist[N - 1];
  const distAt = (t: number) => {
    const x = Math.min(N - 1, Math.max(0, t / STEP));
    const i = Math.floor(x);
    return i >= N - 1 ? dist[N - 1] : lerp(dist[i], dist[i + 1], x - i);
  };

  const sOver = Math.min((OVER_FILL * view.w) / page.w, (OVER_FILL * view.h) / page.h);
  const D_over = F / sOver;
  const sFill = Math.max(view.w / page.w, view.h / page.h);
  const D_fill = F / sFill;
  // όταν η οθόνη έχει άλλη αναλογία από τη φωτογραφία, η βουτιά καταλήγει στο πάνω μέρος της εφαρμογής
  // (εκεί που ξεκινά και η πραγματική), όχι στη μέση
  const fillCy = Math.min(page.h, view.h / sFill) / 2;
  const flightD = (t: number) => D0 * (1 + P.pullback * smooth(t / INTRO.flightEnd));

  /** κάμερα στη χρονική στιγμή t */
  function camera(t: number): CameraFrame {
    const ly = ly0 + cruise * distAt(t);
    const [r0, r1] = INTRO.rise;
    const R = trapezoid(t, r0, r0 + 0.5, r1 - 0.4, r1);
    let lnD = lerp(Math.log(flightD(Math.min(t, INTRO.flightEnd))), Math.log(D_over), R);
    // ανάβαση: η κλίση ισιώνει και το σημείο εστίασης πηγαίνει στο κέντρο της εφαρμογής
    const tilt = TILT * (1 - ramp(t, r0 + 0.25, r1 - 0.35));
    let cx = lerp(lx, page.w / 2, R);
    let cy = lerp(ly, page.h / 2, R);
    // από πάνω: πλησιάζει ελάχιστα
    const [o0, o1] = INTRO.over;
    lnD += Math.log(1 - 0.035 * ramp(t, o0, o1));
    // βουτιά: λογαριθμικά, με ομαλή επιτάχυνση και επιβράδυνση, ώσπου η εφαρμογή να γεμίσει την οθόνη
    const [d0, d1] = INTRO.dive;
    const k = clamp01((t - d0) / (d1 - d0));
    const dive = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    if (t > d0) lnD = lerp(lnD, Math.log(D_fill), dive);
    if (t > d0) {
      cx = page.w / 2;
      cy = lerp(page.h / 2, fillCy, dive);
    }
    return {
      lx: cx,
      ly: cy,
      D: Math.exp(lnD),
      tilt,
      F,
      corner: CORNER * (1 - dive),
      pageShadow: 1 - dive,
      shift: P.shift * (1 - smooth(t / 4.6)),
    };
  }

  /** πόσο έχει σηκωθεί ένα στοιχείο: ανεβαίνει καθώς πλησιάζει η κάμερα, κάθεται ξανά στην ανάβαση */
  function lift(p: Piece, t: number) {
    const ly = ly0 + cruise * distAt(t);
    const cy = p.y + p.h / 2;
    const k = page.h / 900;
    const approach = smooth((ly - (cy - 420 * k)) / (300 * k));
    const start = ramp(t, 0.1, 1.35);
    const settle = 1 - ramp(t, INTRO.rise[0] + 0.05, INTRO.rise[0] + 1.0);
    const amount = approach * start * settle;
    return { z: p.z * P.lift * amount, a: ((p.a * Math.PI) / 180) * amount };
  }

  return { camera, lift, F, D0, D_over, D_fill, ly0, ly1 };
}
