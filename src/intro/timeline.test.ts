import { describe, expect, it } from 'vitest';
import { INTRO, makeTimeline, speedShare, trapezoid } from './timeline';

const desktop = makeTimeline({ w: 1440, h: 900 }, { w: 1440, h: 900 }, false);
const mobile = makeTimeline({ w: 390, h: 844 }, { w: 390, h: 844 }, true);
const odd = makeTimeline({ w: 1440, h: 900 }, { w: 1920, h: 1000 }, false);
const times = (t0: number, t1: number, dt = 1 / 120) => Array.from({ length: Math.round((t1 - t0) / dt) + 1 }, (_, i) => t0 + i * dt);

describe('intro: κάμερα', () => {
  it('η πτήση δεν σταματά και δεν κάνει «άλματα»: η ταχύτητα αλλάζει ομαλά, σταθερή στην κρουαζιέρα', () => {
    for (const t of times(1.2, 4.3)) expect(speedShare(t)).toBe(1);
    let prev = speedShare(0);
    for (const t of times(0, 5.6, 1 / 600)) {
      const v = speedShare(t);
      expect(Math.abs(v - prev)).toBeLessThan(0.02);
      prev = v;
    }
  });

  it('η κάμερα προχωρά πάντα προς τα κάτω στην εφαρμογή (ποτέ πίσω) στην πτήση', () => {
    for (const tl of [desktop, mobile]) {
      let prev = -Infinity;
      for (const t of times(0.05, INTRO.rise[0])) {
        const c = tl.camera(t);
        expect(c.ly).toBeGreaterThan(prev);
        prev = c.ly;
      }
      expect(tl.camera(0).ly).toBeCloseTo(tl.ly0, 6);
    }
  });

  it('δεν κάνει zoom μέσα και πάλι έξω: η απόσταση μόνο μεγαλώνει ως την ανάβαση', () => {
    for (const tl of [desktop, mobile, odd]) {
      let prev = 0;
      for (const t of times(0, INTRO.over[0])) {
        const D = tl.camera(t).D;
        expect(D).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = D;
      }
    }
  });

  it('στο τέλος η εφαρμογή γεμίζει την οθόνη, από πάνω, χωρίς στρογγυλεμένες γωνίες', () => {
    for (const tl of [desktop, mobile, odd]) {
      const c = tl.camera(INTRO.end);
      expect(c.tilt).toBe(0);
      expect(c.corner).toBeCloseTo(0, 9);
      expect(c.D).toBeCloseTo(tl.D_fill, 6);
    }
    // ίδιες διαστάσεις οθόνης και φωτογραφίας: 1:1
    expect(desktop.F / desktop.D_fill).toBeCloseTo(1, 9);
    // άλλη αναλογία: η πάνω άκρη της εφαρμογής στην πάνω άκρη της οθόνης (όπως ξεκινά η πραγματική)
    const c = odd.camera(INTRO.end);
    expect(c.shift).toBeCloseTo(0, 9);
    expect(c.ly - 1000 / 2 / (c.F / c.D)).toBeCloseTo(0, 6);
  });

  it('η ομαλή κίνηση της ανάβασης ξεκινά και τελειώνει σε στάση', () => {
    expect(trapezoid(4.5, 4.5, 5.0, 5.5, 5.9)).toBe(0);
    expect(trapezoid(5.9, 4.5, 5.0, 5.5, 5.9)).toBe(1);
    let prev = 0;
    for (const t of times(4.5, 5.9, 1 / 600)) {
      const v = trapezoid(t, 4.5, 5.0, 5.5, 5.9);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = v;
    }
  });

  it('τα στοιχεία σηκώνονται στην πτήση και κάθονται ξανά πριν τη βουτιά', () => {
    const p = { x: 30, y: 150, w: 110, h: 76, z: 120, a: 44 };
    expect(desktop.lift(p, 0).z).toBe(0);
    expect(desktop.lift(p, 2).z).toBeGreaterThan(100);
    expect(desktop.lift(p, INTRO.over[0]).z).toBe(0);
    const bottom = { x: 556, y: 834, w: 93, h: 36, z: 30, a: 30 };
    expect(desktop.lift(bottom, 1).z).toBe(0); // μακριά ακόμη
    expect(desktop.lift(bottom, 4.4).z).toBeGreaterThan(15);
  });
});
