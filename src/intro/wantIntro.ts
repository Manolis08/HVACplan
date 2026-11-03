/** Παίζει το intro σε αυτό το άνοιγμα; Όχι όταν το URL έχει ?intro=0 ή όταν το σύστημα ζητά λιγότερη κίνηση. */
export function wantIntro() {
  try {
    if (new URLSearchParams(window.location.search).get('intro') === '0') return false;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  } catch {
    return false;
  }
  return true;
}
