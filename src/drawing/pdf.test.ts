/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { parse } from 'opentype.js';
import { describe, expect, it } from 'vitest';
import { defaultInputs, defaultToggles, evaluate } from '../model/evaluate';
import { templateById } from '../model/templates';
import type { GlyphFont } from './pdf';
import { svgContent, svgToPdf } from './pdf';
import { computeSheetViews, sheetSvg } from './sheet';

const font = (name: string) => {
  const b = readFileSync(`node_modules/@fontsource/noto-sans/files/noto-sans-${name}-400-normal.woff`);
  return parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer) as GlyphFont;
};
const fonts = [font('greek'), font('latin')];

const t = templateById('bearing-block');
const p = evaluate(t, defaultInputs(t), defaultToggles(t)).part!;
const { svg } = sheetSvg(computeSheetViews(p, 'first'), p, {
  projection: 'first',
  projectionLines: true,
  scale: { kind: 'reduce', n: 2 },
  fields: { title: 'Έδρανο με χελιδονοουρά', author: 'Γ. Π.', section: 'Β1', classroom: 'Β', drawingNo: 'ΣΧ-01', school: 'ΕΠΑΛ', date: '24/10/2026' },
});

describe('εξαγωγή PDF', () => {
  const bytes = svgToPdf(svg, fonts, 'Έδρανο');
  const pdf = new TextDecoder().decode(bytes);

  it('έγκυρη δομή: A3 οριζόντιο, πίνακας xref που δείχνει σωστά τα αντικείμενα', () => {
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('/MediaBox [0 0 1190.551 841.89]');
    const startxref = Number(pdf.match(/startxref\n(\d+)/)![1]);
    expect(pdf.slice(startxref, startxref + 4)).toBe('xref');
    const offsets = [...pdf.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    offsets.forEach((o, i) => expect(pdf.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
    const len = Number(pdf.match(/\/Length (\d+)/)![1]);
    const start = pdf.indexOf('stream\n') + 'stream\n'.length;
    expect(pdf.slice(start + len, start + len + '\nendstream'.length)).toBe('\nendstream');
  });

  it('οι κρυφές μένουν διακεκομμένες και οι άξονες τελεία-παύλα', () => {
    expect(pdf).toContain('[2.5 1.25] 0 d');
    expect(pdf).toContain('[8 1.5 1 1.5] 0 d');
  });

  it('το κείμενο (και τα ελληνικά) γίνεται καμπύλες, χωρίς γραμματοσειρά μέσα στο PDF', () => {
    expect(pdf).not.toContain('/Font');
    const textOnly = svgContent('<svg viewBox="0 0 10 10"><text x="1" y="5" font-size="3.5">Έδρανο Ø20</text></svg>', fonts).ops;
    expect(textOnly.match(/ m\n/g)!.length).toBeGreaterThan(8); // περιγράμματα γραμμάτων
    expect(textOnly).toContain(' c\n');
  });

  it('περιστροφή κειμένου: κάθετη ετικέτα έχει περιγράμματα σε στενή στήλη', () => {
    const ops = svgContent(
      '<svg viewBox="0 0 100 100"><text x="50" y="50" font-size="3.5" text-anchor="middle" dominant-baseline="middle" transform="rotate(-90 50 50)">500</text></svg>',
      fonts,
    ).ops;
    const xs = [...ops.matchAll(/(-?[\d.]+) (-?[\d.]+) [ml]\n/g)].map((m) => Number(m[1]));
    const ys = [...ops.matchAll(/(-?[\d.]+) (-?[\d.]+) [ml]\n/g)].map((m) => Number(m[2]));
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(3.5); // ύψος γραμμάτων
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(4); // μήκος «500»
  });
});
