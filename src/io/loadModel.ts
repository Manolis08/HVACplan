import { BufferGeometry, InstancedMesh, Matrix4, Mesh, Object3D, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { corrupt, ModelError, technical } from './errors';
import { prepareGltf, readGlb } from './gltfPrep';
import type { UpAxis, Unit } from './units';

export type ModelFormat = 'glb' | 'gltf' | 'stl' | 'obj';

export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_TRIANGLES = 1_000_000;

/** Αρχείο εισόδου (στον browser ένα File· στα τεστ ένα buffer στη μνήμη). */
export interface InputFile {
  name: string;
  size: number;
  read: () => Promise<ArrayBuffer>;
}

export interface RawModel {
  name: string;
  format: ModelFormat;
  sizeBytes: number;
  /** Τρίγωνα στις μονάδες και τους άξονες του αρχείου. */
  triangles: Float32Array;
  /** Τι ορίζει το ίδιο το format (μόνο για glTF). Ποτέ μαντεψιά. */
  suggested: { unit?: Unit; up?: UpAxis };
}

export interface LoadOptions {
  /** Ρυθμίζει τον GLTFLoader (π.χ. αποσυμπίεση Draco). */
  configureGltf?: (loader: GLTFLoader) => void;
}

const FORMATS: Record<string, ModelFormat> = { glb: 'glb', gltf: 'gltf', stl: 'stl', obj: 'obj' };

export const extensionOf = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
};

export const formatMb = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0).replace('.', ',')} MB`;

const countFmt = (n: number) => n.toLocaleString('el-GR');

/** Μαζεύει όλα τα τρίγωνα σκηνής σε κοινές συντεταγμένες (με τους μετασχηματισμούς των κόμβων). */
export function collectTriangles(root: Object3D): Float32Array {
  root.updateMatrixWorld(true);
  const items: { geometry: BufferGeometry; matrices: Matrix4[] }[] = [];
  let total = 0;
  root.traverse((obj) => {
    const mesh = obj as Mesh;
    if (!mesh.isMesh || !mesh.geometry?.getAttribute('position')) return;
    const g = mesh.geometry;
    const tris = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    let matrices = [mesh.matrixWorld];
    const inst = obj as InstancedMesh;
    if (inst.isInstancedMesh) {
      matrices = [];
      for (let i = 0; i < inst.count; i++) {
        const m = new Matrix4();
        inst.getMatrixAt(i, m);
        matrices.push(new Matrix4().multiplyMatrices(inst.matrixWorld, m));
      }
    }
    total += Math.floor(tris) * matrices.length;
    items.push({ geometry: g, matrices });
  });

  if (total === 0)
    throw new ModelError('Το αρχείο δεν περιέχει επιφάνειες (τρίγωνα). Ίσως έχει μόνο γραμμές ή σημεία.');
  if (total > MAX_TRIANGLES)
    throw new ModelError(
      `Το μοντέλο έχει πάρα πολλά τρίγωνα (${countFmt(total)}). Μέγιστο: ${countFmt(MAX_TRIANGLES)}. Απλοποίησέ το στο πρόγραμμα σχεδίασης και δοκίμασε ξανά.`,
    );

  const out = new Float32Array(total * 9);
  const v = new Vector3();
  let o = 0;
  for (const { geometry, matrices } of items) {
    const pos = geometry.getAttribute('position');
    const index = geometry.index;
    const n = Math.floor((index ? index.count : pos.count) / 3) * 3;
    for (const m of matrices) {
      for (let i = 0; i < n; i++) {
        const k = index ? index.getX(i) : i;
        v.fromBufferAttribute(pos, k).applyMatrix4(m);
        out[o++] = v.x;
        out[o++] = v.y;
        out[o++] = v.z;
      }
    }
  }
  for (let i = 0; i < out.length; i++) {
    if (!Number.isFinite(out[i])) throw corrupt('μοντέλο 3D', 'Βρέθηκαν μη αριθμητικές συντεταγμένες (NaN/Infinity).');
  }
  return out;
}

function geometryTriangles(g: BufferGeometry): Float32Array {
  const mesh = new Mesh(g);
  return collectTriangles(mesh);
}

async function parseGltf(main: ArrayBuffer, format: 'glb' | 'gltf', resources: Map<string, ArrayBuffer>, opts: LoadOptions) {
  let json: Record<string, unknown>;
  let bin: Uint8Array | null = null;
  if (format === 'glb') {
    ({ json, bin } = readGlb(main));
  } else {
    try {
      json = JSON.parse(new TextDecoder().decode(main));
    } catch (e) {
      throw corrupt('glTF', `Μη έγκυρο JSON: ${technical(e)}`);
    }
  }
  const glb = prepareGltf(json, bin, resources);
  const loader = new GLTFLoader();
  opts.configureGltf?.(loader);
  const scene = await new Promise<Object3D>((resolve, reject) => {
    loader.parse(glb, '', (gltf) => resolve(gltf.scene), (err) => reject(err));
  }).catch((e) => {
    if (e instanceof ModelError) throw e;
    throw corrupt(format.toUpperCase(), technical(e));
  });
  return collectTriangles(scene);
}

/** Διαβάζει ένα αρχείο 3D (μαζί με τυχόν συνοδευτικά .bin) και επιστρέφει τα τρίγωνά του. */
export async function loadModel(files: InputFile[], opts: LoadOptions = {}): Promise<RawModel> {
  if (files.length === 0) throw new ModelError('Δεν επιλέχθηκε αρχείο.');
  const mains = files.filter((f) => FORMATS[extensionOf(f.name)]);
  if (mains.length === 0) {
    const ext = extensionOf(files[0].name);
    throw new ModelError(
      ext
        ? `Ο τύπος αρχείου «.${ext}» δεν υποστηρίζεται. Υποστηρίζονται: GLB, GLTF, STL, OBJ.`
        : 'Το αρχείο δεν έχει κατάληξη. Υποστηρίζονται: .glb, .gltf, .stl, .obj.',
    );
  }
  if (mains.length > 1)
    throw new ModelError('Επίλεξε ένα αρχείο 3D τη φορά (μαζί με τα .bin του, αν είναι .gltf).');

  const main = mains[0];
  const format = FORMATS[extensionOf(main.name)];
  const totalSize = files.reduce((s, f) => s + f.size, 0);
  if (totalSize > MAX_FILE_BYTES)
    throw new ModelError(`Το αρχείο είναι πολύ μεγάλο (${formatMb(totalSize)}). Μέγιστο μέγεθος: ${formatMb(MAX_FILE_BYTES)}.`);
  if (main.size === 0) throw new ModelError('Το αρχείο είναι άδειο (0 bytes).');

  const read = async (f: InputFile) => {
    try {
      return await f.read();
    } catch (e) {
      throw new ModelError(`Δεν ήταν δυνατή η ανάγνωση του «${f.name}».`, technical(e));
    }
  };
  const buffer = await read(main);

  let triangles: Float32Array;
  switch (format) {
    case 'stl': {
      let g: BufferGeometry;
      try {
        g = new STLLoader().parse(buffer);
      } catch (e) {
        throw corrupt('STL', technical(e));
      }
      if (!g.getAttribute('position') || g.getAttribute('position').count === 0)
        throw corrupt('STL', 'Δεν βρέθηκαν τρίγωνα.');
      triangles = geometryTriangles(g);
      break;
    }
    case 'obj': {
      let root: Object3D;
      try {
        root = new OBJLoader().parse(new TextDecoder().decode(buffer));
      } catch (e) {
        throw corrupt('OBJ', technical(e));
      }
      triangles = collectTriangles(root);
      break;
    }
    case 'glb':
    case 'gltf': {
      const resources = new Map<string, ArrayBuffer>();
      for (const f of files) if (f !== main) resources.set(f.name.toLowerCase(), await read(f));
      triangles = await parseGltf(buffer, format, resources, opts);
      break;
    }
  }

  return {
    name: main.name,
    format,
    sizeBytes: totalSize,
    triangles,
    suggested: format === 'glb' || format === 'gltf' ? { unit: 'm', up: 'Y' } : {},
  };
}

/** Μετατροπή File του browser σε InputFile. */
export const fromBrowserFile = (f: File): InputFile => ({ name: f.name, size: f.size, read: () => f.arrayBuffer() });
