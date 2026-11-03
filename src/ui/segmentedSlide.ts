// Δείκτης που γλιστράει κάτω από την ενεργή επιλογή σε κάθε ομάδα κουμπιών-επιλογών (.segmented με role="radiogroup":
// ετικέτες διαστάσεων, έτοιμο σχήμα / αρχείο 3D, μονάδα, άξονας, διάταξη φύλλου…), όπως στις καρτέλες 3D / Φύλλο / Τ+Π.
// Μετράει τη θέση του ενεργού κουμπιού και τη δίνει στο CSS (--seg-x, --seg-y, --seg-w, --seg-h, --seg-r)· το CSS
// ζωγραφίζει και κινεί τον δείκτη. Ξαναμετράει όταν αλλάζει η επιλογή, όταν εμφανίζεται νέα ομάδα και όταν αλλάζει το μέγεθος.

const GROUP = '.segmented[role="radiogroup"]';

function place(el: HTMLElement) {
  const on = el.querySelector<HTMLElement>('[aria-checked="true"]');
  if (!on || !on.offsetWidth) return; // κρυμμένη ή χωρίς επιλογή: ξαναμετριέται όταν εμφανιστεί
  const s = el.style;
  s.setProperty('--seg-x', `${on.offsetLeft}px`);
  s.setProperty('--seg-y', `${on.offsetTop}px`);
  s.setProperty('--seg-w', `${on.offsetWidth}px`);
  s.setProperty('--seg-h', `${on.offsetHeight}px`);
  s.setProperty('--seg-r', getComputedStyle(on).borderTopLeftRadius);
  if (!el.hasAttribute('data-slide')) {
    el.setAttribute('data-slide', '');
    // η κίνηση ενεργοποιείται μετά την πρώτη τοποθέτηση, ώστε ο δείκτης να μη «πετάει» από την άκρη
    requestAnimationFrame(() => requestAnimationFrame(() => el.setAttribute('data-slide-ready', '')));
  }
}

export function installSegmentedSlide() {
  const watched = new WeakSet<Element>();
  const resize = new ResizeObserver(() => schedule());
  let queued = false;

  function refresh() {
    document.querySelectorAll<HTMLElement>(GROUP).forEach((el) => {
      if (!watched.has(el)) {
        watched.add(el);
        resize.observe(el);
      }
      place(el);
    });
  }
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      refresh();
    });
  }

  new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'attributes') return schedule();
      for (const n of m.addedNodes) {
        if (n instanceof Element && (n.matches(GROUP) || n.querySelector(GROUP))) return schedule();
      }
    }
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-checked'] });
  window.addEventListener('resize', schedule);
  schedule();
}
