import { describe, expect, it } from 'vitest';
import { omegaTarget, settlePlan } from './Viewer';

describe('σβούρα αλλαγής σχήματος', () => {
  it('η επιβράδυνση σταματά ακριβώς σε ακέραιο αριθμό στροφών, όποια κι αν είναι η γωνία και η ταχύτητα', () => {
    for (let k = 0; k < 400; k++) {
      const ang = Math.random() * 100;
      const omega = 9 + Math.random() * 51;
      const { D, T } = settlePlan(ang, omega, 0.5);
      const end = (ang + D) / (2 * Math.PI);
      expect(Math.abs(end - Math.round(end))).toBeLessThan(1e-9);
      // ο χρόνος επιβράδυνσης δεν είναι ποτέ πολύ μικρός (οπτικά απότομο) ούτε υπερβολικά μεγάλος
      expect(T).toBeGreaterThanOrEqual(0.5 - 1e-9);
      expect(T).toBeLessThan(0.5 + (4 * Math.PI) / omega + 1e-9);
      // σταθερή επιβράδυνση: απόσταση = ω·T/2
      expect(D).toBeCloseTo((omega * T) / 2, 9);
    }
  });

  it('όσο περισσότερα γρήγορα κλικ, τόσο πιο γρήγορη η σβούρα, με όριο', () => {
    expect(omegaTarget(0)).toBe(12);
    expect(omegaTarget(11)).toBeGreaterThan(omegaTarget(0));
    expect(omegaTarget(33)).toBeGreaterThan(omegaTarget(11));
    expect(omegaTarget(1000)).toBe(60);
  });
});
