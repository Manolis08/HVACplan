import { describe, expect, it } from 'vitest';
import { defaultInputs, defaultToggles, evaluate } from '../model/evaluate';
import { templateById } from '../model/templates';
import type { Vec3 } from '../model/types';
import { essentialDims, layoutDims } from './dimLayout';
import { bboxCorners, viewBasis, viewById, type ViewId } from './views';

const t = templateById('notched-cube');
const part = evaluate(t, defaultInputs(t), defaultToggles(t)).part!;

/** Ορθογραφική προβολή σε pixel (10 px/mm, κέντρο οθόνης 400,300). */
function projector(view: ViewId) {
  const { right, up, dir } = viewBasis(viewById(view).dir);
  const project = (p: Vec3): [number, number] => {
    const x = p[0] * right.x + p[1] * right.y + p[2] * right.z;
    const y = p[0] * up.x + p[1] * up.y + p[2] * up.z;
    return [400 + x * 10, 300 - y * 10];
  };
  return { project, viewDir: [dir.x, dir.y, dir.z] as Vec3 };
}

function labelsFor(view: ViewId, scale = { kind: 'reduce' as const, n: 1 }) {
  const { project, viewDir } = projector(view);
  const svg = layoutDims({ dims: part.dims, project, viewDir, corners: bboxCorners(part.bbox), scale, mode: 'all' });
  return Object.fromEntries(
    [...svg.matchAll(/data-dim="([^"]+)".*?<text[^>]*>([^<]*)<\/text>/g)].map((m) => [m[1], m[2]]),
  );
}

describe('ετικέτες διαστάσεων στο 3D', () => {
  it('πρόσοψη: δεν δείχνει το βάθος (παράλληλο με τη ματιά)', () => {
    const l = labelsFor('front');
    expect(l.L).toBe('30');
    expect(l.H).toBe('20');
    expect(l.W).toBeUndefined();
    expect(l.nd).toBeUndefined();
  });

  it('κάτοψη: δεν δείχνει το ύψος', () => {
    const l = labelsFor('top');
    expect(l.L).toBe('30');
    expect(l.W).toBe('20');
    expect(l.H).toBeUndefined();
  });

  it('οι αριθμοί ακολουθούν την κλίμακα', () => {
    expect(labelsFor('iso', { kind: 'enlarge', n: 3 } as never).L).toBe('90');
    expect(labelsFor('iso', { kind: 'reduce', n: 2 }).L).toBe('15');
  });
});

describe('μικρές διαστάσεις όταν η κάμερα είναι μακριά', () => {
  it('το Ø4 του εξαρτήματος φαίνεται και σε 1 px/mm (μακρινή κάμερα)', () => {
    const b = templateById('bearing-block');
    const bp = evaluate(b, defaultInputs(b), defaultToggles(b)).part!;
    const { right, up, dir } = viewBasis(viewById('iso').dir);
    const project = (p: Vec3): [number, number] => [
      400 + (p[0] * right.x + p[1] * right.y + p[2] * right.z) * 1,
      300 - (p[0] * up.x + p[1] * up.y + p[2] * up.z) * 1,
    ];
    const svg = layoutDims({
      dims: bp.dims,
      project,
      viewDir: [dir.x, dir.y, dir.z],
      corners: bboxCorners(bp.bbox),
      scale: { kind: 'reduce', n: 1 },
      mode: 'all',
    });
    expect(svg).toContain('>Ø4<');
    expect(svg).toContain('>Ø20<');
    expect(svg).toContain('>R20<');
  });
});

describe('απαραίτητες διαστάσεις', () => {
  const ids = (id: string) => {
    const tt = templateById(id);
    const p = evaluate(tt, defaultInputs(tt), defaultToggles(tt)).part!;
    return { all: p.dims.map((d) => d.id), kept: essentialDims(p.dims).map((d) => d.id) };
  };

  it('ΤΕΤΡΙΣ: παραλείπει όσες βγαίνουν με αφαίρεση (Ls = L − P, Hu = Ht − Hs)', () => {
    const { all, kept } = ids('stepped-block');
    expect(all).toContain('Ls');
    expect(all).toContain('Hu');
    expect(kept).not.toContain('Ls');
    expect(kept).not.toContain('Hu');
    expect(kept).toEqual(expect.arrayContaining(['L', 'W', 'Ht', 'P', 'Wc', 'Hs', 'Hw', 'Dw']));
  });

  it('ΚΥΒΟΣ και ΕΞΑΡΤΙΜΑ: καμία δεν περισσεύει, κρατά όλες (και τις διαμέτρους)', () => {
    for (const id of ['notched-cube', 'bearing-block']) {
      const { all, kept } = ids(id);
      expect(kept).toEqual(all);
    }
  });

  it('στο 3D η επιλογή «Απαραίτητες» δεν δείχνει τις περιττές', () => {
    const tt = templateById('stepped-block');
    const p = evaluate(tt, defaultInputs(tt), defaultToggles(tt)).part!;
    const { project, viewDir } = projector('iso');
    const svg = layoutDims({ dims: p.dims, project, viewDir, corners: bboxCorners(p.bbox), scale: { kind: 'reduce', n: 1 }, mode: 'essential' });
    expect(svg).not.toContain('data-dim="Ls"');
    expect(svg).not.toContain('data-dim="Hu"');
    expect(svg).toContain('data-dim="P"');
  });
});
