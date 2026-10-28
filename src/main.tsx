import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { registerServiceWorker } from './lib/pwa';
import { applyTheme, initialTheme } from './lib/theme';
import './styles.css';

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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
