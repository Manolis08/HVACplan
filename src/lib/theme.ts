export type Theme = 'dark' | 'light';

const KEY = 'opseis3d:theme';

/** Σκοτεινό εξ ορισμού· θυμόμαστε την επιλογή του χρήστη στη συσκευή. */
export function initialTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#0a0f14' : '#17212b');
  try {
    localStorage.setItem(KEY, t);
  } catch {
    // χωρίς αποθήκευση: απλώς δεν θυμόμαστε
  }
}
