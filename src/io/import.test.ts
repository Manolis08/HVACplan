import { describe, expect, it } from 'vitest';
import { defaultInputs, defaultToggles, evaluate } from '../model/evaluate';
import { templateById } from '../model/templates';
import type { Vec3 } from '../model/types';
import { toAsciiStl, toBinaryStl, toGlb, toGltfWithBin, toObj } from './exporters';
import { loadModel, MAX_FILE_BYTES, type InputFile } from './loadModel';
import { buildFilePart, IDENTITY, mulMat3, orientedSize, prepareModel, rot90, type Orientation } from './meshTools';

const enc = new TextEncoder();
const file = (name: string, data: ArrayBuffer | string): InputFile => {
  const buf = typeof data === 'string' ? (enc.encode(data).buffer as ArrayBuffer) : data;
  return { name, size: buf.byteLength, read: async () => buf };
};

const partOf = (id: string, inputs: Record<string, string> = {}) => {
  const t = templateById(id);
  return evaluate(t, { ...defaultInputs(t), ...inputs }, defaultToggles(t)).part!;
};

const cube = partOf('notched-cube'); // 30 × 20 × 20
const block = partOf('bearing-block'); // 100 × 80 × 70 (όλα διαφορετικά)

const size = (p: { bbox: { min: Vec3; max: Vec3 } }) =>
  [0, 1, 2].map((a) => +(p.bbox.max[a] - p.bbox.min[a]).toFixed(4));

async function importAs(files: InputFile[], o: Orientation) {
  const raw = await loadModel(files);
  const prepared = prepareModel(raw.triangles);
  return { raw, prepared, part: buildFilePart(prepared, o) };
}

const mmZ: Orientation = { unit: 'mm', up: 'Z', rotation: IDENTITY };

describe('δοκιμαστικό παράδειγμα: ίδιο κομμάτι από αρχείο → 30 × 20 × 20', () => {
  it('STL (δυαδικό, mm, Z πάνω) με δηλωμένη μονάδα mm', async () => {
    const { part, raw } = await importAs([file('kyvos.stl', toBinaryStl(cube.triangles, { unitMm: 1, up: 'Z' }))], mmZ);
    expect(raw.suggested).toEqual({}); // κανένα μάντεμα για STL
    expect(size(part)).toEqual([30, 20, 20]);
    expect(part.dims.map((d) => +d.value.toFixed(4))).toEqual([30, 20, 20]);
  });

  it('STL κειμένου (ASCII)', async () => {
    const { part } = await importAs([file('kyvos.stl', toAsciiStl(cube.triangles, { unitMm: 1, up: 'Z' }))], mmZ);
    expect(size(part)).toEqual([30, 20, 20]);
  });

  it('GLB (μέτρα, Y πάνω, με υφή που λείπει και μετατόπιση κόμβου)', async () => {
    const { part, raw } = await importAs([file('kyvos.glb', toGlb(cube.triangles, { unitMm: 1000, up: 'Y' }))], {
      unit: 'm',
      up: 'Y',
      rotation: IDENTITY,
    });
    expect(raw.suggested).toEqual({ unit: 'm', up: 'Y' });
    expect(size(part)).toEqual([30, 20, 20]);
  });

  it('GLB σε mm (όπως ζητά το κριτήριο αποδοχής: δηλώνω mm)', async () => {
    const { part } = await importAs([file('kyvos.glb', toGlb(cube.triangles, { unitMm: 1, up: 'Y' }))], {
      unit: 'mm',
      up: 'Y',
      rotation: IDENTITY,
    });
    expect(size(part)).toEqual([30, 20, 20]);
  });

  it('οι ακμές από το STL είναι ίδιες με του προτύπου (ίδιο πλήθος, κλειστό πλέγμα)', async () => {
    const { prepared } = await importAs([file('kyvos.stl', toBinaryStl(cube.triangles, { unitMm: 1, up: 'Z' }))], mmZ);
    expect(prepared.stats.boundaryEdges).toBe(0);
    expect(prepared.stats.nonManifoldEdges).toBe(0);
    // οι ακμές του προτύπου είναι ενωμένα ευθύγραμμα τμήματα· του αρχείου ανά ακμή τριγώνου
    const totalLength = (e: Float32Array) => {
      let s = 0;
      for (let i = 0; i < e.length; i += 6) s += Math.hypot(e[i + 3] - e[i], e[i + 4] - e[i + 1], e[i + 5] - e[i + 2]);
      return s;
    };
    expect(totalLength(prepared.edges)).toBeCloseTo(totalLength(cube.edges), 3);
  });
});

describe('μονάδες, πάνω άξονας, περιστροφές (Έδρανο 100 × 80 × 70)', () => {
  const stl = file('edrano.stl', toBinaryStl(block.triangles, { unitMm: 10, up: 'Y' })); // cm, Y πάνω

  it('σωστή δήλωση (cm, Y) → 100 × 80 × 70', async () => {
    const { part } = await importAs([stl], { unit: 'cm', up: 'Y', rotation: IDENTITY });
    expect(size(part)).toEqual([100, 80, 70]);
  });

  it('λάθος μονάδα ή άξονας δίνει άλλα μέτρα (γι’ αυτό ρωτάμε)', async () => {
    expect(size((await importAs([stl], { unit: 'mm', up: 'Y', rotation: IDENTITY })).part)).toEqual([10, 8, 7]);
    expect(size((await importAs([stl], { unit: 'cm', up: 'Z', rotation: IDENTITY })).part)).toEqual([100, 70, 80]);
  });

  it('περιστροφή 90° γύρω από Z ανταλλάσσει μήκος και βάθος· δύο φορές = 180°', async () => {
    const z = rot90('Z');
    expect(size((await importAs([stl], { unit: 'cm', up: 'Y', rotation: z })).part)).toEqual([80, 100, 70]);
    expect(size((await importAs([stl], { unit: 'cm', up: 'Y', rotation: mulMat3(z, z) })).part)).toEqual([100, 80, 70]);
  });

  it('γρήγορος υπολογισμός διαστάσεων για τον πίνακα μονάδων', async () => {
    const { prepared } = await importAs([stl], mmZ);
    expect(orientedSize(prepared.rawBox, { unit: 'cm', up: 'Y', rotation: IDENTITY }).map((v) => +v.toFixed(4))).toEqual([100, 80, 70]);
    expect(orientedSize(prepared.rawBox, { unit: 'in', up: 'Y', rotation: rot90('X') }).map((v) => +v.toFixed(3))).toEqual(
      [100, 70, 80].map((v) => +((v / 10) * 25.4).toFixed(3)),
    );
  });

  it('κεντράρισμα: κέντρο στο X/Y, βάση στο z = 0', async () => {
    const { part } = await importAs([stl], { unit: 'cm', up: 'Y', rotation: IDENTITY });
    expect(part.bbox.min.map((v) => +v.toFixed(4))).toEqual([-50, -40, 0]);
    expect(part.bbox.max.map((v) => +v.toFixed(4))).toEqual([50, 40, 70]);
  });

  it('OBJ και .gltf με εξωτερικό .bin', async () => {
    const obj = file('edrano.obj', toObj(block.triangles, { unitMm: 1, up: 'Y' }));
    expect(size((await importAs([obj], { unit: 'mm', up: 'Y', rotation: IDENTITY })).part)).toEqual([100, 80, 70]);
    const { gltf, bin } = toGltfWithBin(block.triangles, { unitMm: 1000, up: 'Y' }, 'edrano%20part.bin');
    const files = [file('edrano.gltf', gltf), file('edrano part.bin', bin)];
    expect(size((await importAs(files, { unit: 'm', up: 'Y', rotation: IDENTITY })).part)).toEqual([100, 80, 70]);
  });
});

describe('σαφή μηνύματα σφάλματος', () => {
  const err = async (files: InputFile[]) => {
    try {
      await loadModel(files);
    } catch (e) {
      return (e as Error).message;
    }
    throw new Error('έπρεπε να αποτύχει');
  };

  it('μη υποστηριζόμενος τύπος', async () => {
    expect(await err([file('model.fbx', 'x')])).toMatch(/«\.fbx» δεν υποστηρίζεται/);
  });

  it('κατεστραμμένο GLB', async () => {
    expect(await err([file('bad.glb', new Uint8Array(64).fill(7).buffer)])).toMatch(/κατεστραμμένο.*GLB/);
    const glb = toGlb(cube.triangles, { unitMm: 1, up: 'Y' });
    expect(await err([file('cut.glb', glb.slice(0, 200))])).toMatch(/κατεστραμμένο/);
  });

  it('κατεστραμμένο STL και OBJ χωρίς επιφάνειες', async () => {
    expect(await err([file('bad.stl', 'αυτό δεν είναι STL')])).toMatch(/κατεστραμμένο.*STL/);
    expect(await err([file('lines.obj', 'v 0 0 0\nv 1 0 0\nl 1 2')])).toMatch(/δεν περιέχει επιφάνειες/);
  });

  it('λείπει το .bin ενός .gltf', async () => {
    const { gltf } = toGltfWithBin(cube.triangles, { unitMm: 1, up: 'Y' }, 'part.bin');
    expect(await err([file('a.gltf', gltf)])).toMatch(/χρειάζεται και το «part\.bin»/);
  });

  it('πολύ μεγάλο αρχείο (ελέγχεται πριν διαβαστεί)', async () => {
    const huge: InputFile = { name: 'big.stl', size: MAX_FILE_BYTES + 1, read: async () => { throw new Error('δεν έπρεπε να διαβαστεί'); } };
    expect(await err([huge])).toMatch(/πολύ μεγάλο/);
  });

  it('άδειο αρχείο και δύο αρχεία 3D μαζί', async () => {
    expect(await err([file('empty.stl', new ArrayBuffer(0))])).toMatch(/άδειο/);
    expect(await err([file('a.stl', 'x'), file('b.obj', 'y')])).toMatch(/ένα αρχείο 3D τη φορά/);
  });
});
