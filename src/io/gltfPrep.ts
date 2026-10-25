import { corrupt, ModelError } from './errors';

// Το glTF προετοιμάζεται πριν το διαβάσει ο GLTFLoader:
// - αφαιρούνται υλικά, υφές και εικόνες (δεν χρειάζονται για μέτρα και όψεις, και έτσι
//   δεν φορτώνονται άσκοπα στη μνήμη ούτε χρειάζονται αποκωδικοποιητές εικόνων),
// - όλα τα buffers (ενσωματωμένα, data URI ή εξωτερικά .bin) ενώνονται σε ένα GLB,
//   ώστε η φόρτωση να μη ζητά τίποτα από το δίκτυο.

type Json = Record<string, any>;

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/** Επεκτάσεις γεωμετρίας που υποστηρίζονται. */
const GEOMETRY_EXTENSIONS = new Set(['KHR_draco_mesh_compression', 'KHR_mesh_quantization', 'EXT_mesh_gpu_instancing']);

/** Επεκτάσεις που αφορούν μόνο εμφάνιση (υλικά/υφές/φώτα): αγνοούνται με ασφάλεια. */
const isAppearanceExtension = (name: string) =>
  name.startsWith('KHR_materials_') ||
  name.startsWith('KHR_texture_') ||
  name.startsWith('EXT_texture_') ||
  name === 'KHR_lights_punctual' ||
  name === 'KHR_xmp_json_ld';

export function readGlb(buffer: ArrayBuffer): { json: Json; bin: Uint8Array | null } {
  if (buffer.byteLength < 20) throw corrupt('GLB', 'Πολύ μικρό αρχείο.');
  const dv = new DataView(buffer);
  if (dv.getUint32(0, true) !== GLB_MAGIC) throw corrupt('GLB', 'Λείπει η υπογραφή "glTF" στην αρχή του αρχείου.');
  if (dv.getUint32(4, true) < 2)
    throw new ModelError('Το αρχείο είναι glTF 1.0, που δεν υποστηρίζεται. Αποθήκευσέ το ξανά ως glTF 2.0.');
  const length = Math.min(dv.getUint32(8, true), buffer.byteLength);
  let offset = 12;
  let json: Json | null = null;
  let bin: Uint8Array | null = null;
  while (offset + 8 <= length) {
    const chunkLength = dv.getUint32(offset, true);
    const chunkType = dv.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + chunkLength > length) throw corrupt('GLB', 'Ένα τμήμα του αρχείου είναι κομμένο.');
    if (chunkType === CHUNK_JSON) {
      try {
        json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, start, chunkLength)));
      } catch (e) {
        throw corrupt('GLB', `Μη έγκυρο JSON: ${(e as Error).message}`);
      }
    } else if (chunkType === CHUNK_BIN && !bin) {
      bin = new Uint8Array(buffer, start, chunkLength);
    }
    offset = start + chunkLength;
  }
  if (!json) throw corrupt('GLB', 'Λείπει το τμήμα JSON.');
  return { json, bin };
}

export function writeGlb(json: Json, bin: Uint8Array): ArrayBuffer {
  const pad4 = (n: number) => (n + 3) & ~3;
  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = pad4(jsonBytes.length);
  if (jsonLen !== jsonBytes.length) {
    const padded = new Uint8Array(jsonLen).fill(0x20);
    padded.set(jsonBytes);
    jsonBytes = padded;
  }
  const binLen = pad4(bin.length);
  const total = 12 + 8 + jsonLen + (binLen > 0 ? 8 + binLen : 0);
  const out = new ArrayBuffer(total);
  const dv = new DataView(out);
  const u8 = new Uint8Array(out);
  dv.setUint32(0, GLB_MAGIC, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true);
  dv.setUint32(16, CHUNK_JSON, true);
  u8.set(jsonBytes, 20);
  if (binLen > 0) {
    const o = 20 + jsonLen;
    dv.setUint32(o, binLen, true);
    dv.setUint32(o + 4, CHUNK_BIN, true);
    u8.set(bin, o + 8);
  }
  return out;
}

function decodeDataUri(uri: string): Uint8Array {
  const comma = uri.indexOf(',');
  if (comma < 0 || !uri.slice(0, comma).includes(';base64')) throw corrupt('glTF', 'Μη υποστηριζόμενο data URI.');
  const bin = atob(uri.slice(comma + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const baseName = (path: string) => {
  let p = path;
  try {
    p = decodeURIComponent(path);
  } catch {
    // κρατάμε το αρχικό
  }
  return p.split(/[\\/]/).pop() ?? p;
};

/**
 * Καθαρίζει το glTF JSON και ενώνει όλα τα buffers σε ένα GLB.
 * @param resources επιπλέον αρχεία που επέλεξε ο χρήστης (π.χ. scene.bin), ανά όνομα αρχείου.
 */
export function prepareGltf(json: Json, glbBin: Uint8Array | null, resources: Map<string, ArrayBuffer>): ArrayBuffer {
  const version = String(json.asset?.version ?? '');
  if (!version) throw corrupt('glTF', 'Λείπει το asset.version.');
  if (Number.parseFloat(version) < 2)
    throw new ModelError('Το αρχείο είναι glTF 1.0, που δεν υποστηρίζεται. Αποθήκευσέ το ξανά ως glTF 2.0.');

  const required: string[] = json.extensionsRequired ?? [];
  if (required.includes('EXT_meshopt_compression'))
    throw new ModelError(
      'Το αρχείο χρησιμοποιεί συμπίεση meshopt, που δεν υποστηρίζεται. Αποθήκευσέ το χωρίς συμπίεση ή με συμπίεση Draco.',
    );
  const unknown = required.filter((e) => !GEOMETRY_EXTENSIONS.has(e) && !isAppearanceExtension(e));
  if (unknown.length > 0)
    throw new ModelError(`Το αρχείο χρειάζεται επέκταση που δεν υποστηρίζεται: ${unknown.join(', ')}.`);
  json.extensionsRequired = required.filter((e) => GEOMETRY_EXTENSIONS.has(e));
  json.extensionsUsed = (json.extensionsUsed ?? []).filter((e: string) => GEOMETRY_EXTENSIONS.has(e));

  // Εμφάνιση: έξω.
  delete json.images;
  delete json.textures;
  delete json.samplers;
  delete json.materials;
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) delete prim.material;
  }

  // Buffers → ένα ενιαίο.
  const buffers: Json[] = json.buffers ?? [];
  const parts: Uint8Array[] = buffers.map((b, i) => {
    let data: Uint8Array;
    if (b.uri === undefined) {
      if (i !== 0 || !glbBin) throw corrupt('glTF', `Το buffer ${i} δεν έχει δεδομένα.`);
      data = glbBin;
    } else if (String(b.uri).startsWith('data:')) {
      data = decodeDataUri(b.uri);
    } else {
      const file = resources.get(baseName(b.uri).toLowerCase());
      if (!file)
        throw new ModelError(
          `Το αρχείο .gltf χρειάζεται και το «${baseName(b.uri)}». Επίλεξέ τα μαζί (πολλαπλή επιλογή αρχείων).`,
        );
      data = new Uint8Array(file);
    }
    if (typeof b.byteLength === 'number' && data.length < b.byteLength)
      throw corrupt('glTF', `Το buffer ${i} είναι μικρότερο από το αναμενόμενο (${data.length} < ${b.byteLength}).`);
    return data;
  });

  const offsets: number[] = [];
  let total = 0;
  for (const p of parts) {
    offsets.push(total);
    total += (p.length + 7) & ~7;
  }
  const merged = new Uint8Array(total);
  parts.forEach((p, i) => merged.set(p, offsets[i]));

  for (const bv of json.bufferViews ?? []) {
    if (typeof bv.buffer !== 'number' || bv.buffer >= parts.length) throw corrupt('glTF', 'Λάθος αναφορά σε buffer.');
    bv.byteOffset = (bv.byteOffset ?? 0) + offsets[bv.buffer];
    bv.buffer = 0;
  }
  json.buffers = parts.length > 0 ? [{ byteLength: merged.length }] : [];

  return writeGlb(json, merged);
}
