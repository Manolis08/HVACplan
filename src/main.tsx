import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { Intro } from './intro/Intro';
import { IpadPointer } from './ui/ipad-pointer';
import { installSegmentedSlide } from './ui/segmentedSlide';
import { registerServiceWorker } from './lib/pwa';
import { applyTheme, initialTheme } from './lib/theme';
import './styles.css';
// ΔΟΚΙΜΗ: Liquid Glass σε όλο το UI (βγαίνει αφαιρώντας αυτή τη γραμμή)
import './glass.css';

// Προστασία από clickjacking: η εφαρμογή δεν τρέχει μέσα σε πλαίσιο (iframe) άλλης σελίδας.
// (Το GitHub Pages δεν επιτρέπει header X-Frame-Options/frame-ancestors, οπότε ελέγχουμε εδώ.)
let framed = false;
try {
  framed = window.top !== window.self;
} catch {
  framed = true;
}
if (framed) {
  try {
    window.top!.location.href = window.location.href;
  } catch {
    document.documentElement.innerHTML = '';
  }
  throw new Error('HVACplan: δεν επιτρέπεται η ενσωμάτωση σε άλλη σελίδα.');
}

applyTheme(initialTheme());
registerServiceWorker();

// Ο καμβάς του 3D μετριέται ενώ το πάνελ ακόμα κάνει την κίνηση εισόδου (pane-in: μικρή σμίκρυνση), οπότε
// έμενε 1-3 px μικρότερος από το πάνελ, με τυχαίο μέγεθος σε κάθε άνοιγμα. Μόλις τελειώσει η κίνηση, ξαναμετριέται.
document.addEventListener('animationend', (e) => {
  if (e.animationName === 'pane-in' && e.target instanceof Element && e.target.querySelector('.viewer-canvas')) {
    window.dispatchEvent(new Event('resize'));
  }
});

installSegmentedSlide();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <Intro />
    <IpadPointer />
  </StrictMode>,
);
