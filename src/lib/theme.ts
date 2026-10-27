/**
 * Χρώμα φόντου της εφαρμογής: σκούρο μπλε (προεπιλογή), φωτεινό (λευκό), γκρι, μαύρο.
 * Το φύλλο όψεων μένει πάντα λευκό σαν χαρτί.
 */
export type Theme = 'dark' | 'light' | 'gray' | 'black';

export const THEMES: { id: Theme; label: string; swatch: string; viewerBg: string; meta: string }[] = [
  { id: 'dark', label: 'Σκούρο μπλε', swatch: '#141c24', viewerBg: '#141c24', meta: '#0a0f14' },
  { id: 'light', label: 'Φωτεινό', swatch: '#f4f6f8', viewerBg: '#f4f6f8', meta: '#ffffff' },
  { id: 'gray', label: 'Γκρι', swatch: '#3a3d42', viewerBg: '#34373b', meta: '#222427' },
  { id: 'black', label: 'Μαύρο', swatch: '#000000', viewerBg: '#000000', meta: '#000000' },
];

export const themeInfo = (t: Theme) => THEMES.find((x) => x.id === t) ?? THEMES[0];

/** Θέματα με σκούρο φόντο (σκούρα εικονίδια/κείμενα ανάποδα). */
export const isDarkTheme = (t: Theme) => t !== 'light';

const KEY = 'opseis3d:theme';

/** Σκούρο μπλε εξ ορισμού· θυμόμαστε την επιλογή του χρήστη στη συσκευή. */
export function initialTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return THEMES.some((x) => x.id === v) ? (v as Theme) : 'dark';
  } catch {
    return 'dark';
  }
}

export function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeInfo(t).meta);
  try {
    localStorage.setItem(KEY, t);
  } catch {
    // χωρίς αποθήκευση: απλώς δεν θυμόμαστε
  }
}
