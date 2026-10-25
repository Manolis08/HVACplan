/// <reference types="node" />
// Δημιουργία δοκιμαστικών αρχείων στον φάκελο samples/ (npm run samples).
// Στα κανονικά τεστ παραλείπεται.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import draco3d from 'draco3d';
import { BufferAttribute, BufferGeometry, Mesh } from 'three';
import { DRACOExporter } from 'three/examples/jsm/exporters/DRACOExporter.js';
import { it } from 'vitest';
import { defaultInputs, defaultToggles, evaluate } from '../model/evaluate';
import { templateById } from '../model/templates';
import { toBinaryStl, toFile, toGlb, toGltfWithBin, toObj } from './exporters';
import { writeGlb } from './gltfPrep';

/** GLB με συμπίεση Draco (KHR_draco_mesh_compression), για να δοκιμαστεί η αποσυμπίεση. */
async function toDracoGlb(tris: Float32Array, unitMm: number): Promise<ArrayBuffer> {
  const encoder = await draco3d.createEncoderModule({});
  (globalThis as Record<string, unknown>).DracoEncoderModule = () => encoder;
  const p = toFile(tris, { unitMm, up: 'Y' });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(p, 3));
  const data = await new DRACOExporter().parseAsync(new Mesh(g), { exportNormals: false, exportUvs: false });
  const min = [0, 1, 2].map((a) => Math.min(...p.filter((_, i) => i % 3 === a)));
  const max = [0, 1, 2].map((a) => Math.max(...p.filter((_, i) => i % 3 === a)));
  const json = {
    asset: { version: '2.0', generator: 'Opseis 3D test (Draco)' },
    extensionsUsed: ['KHR_draco_mesh_compression'],
    extensionsRequired: ['KHR_draco_mesh_compression'],
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0 },
            indices: 1,
            mode: 4,
            extensions: { KHR_draco_mesh_compression: { bufferView: 0, attributes: { POSITION: 0 } } },
          },
        ],
      },
    ],
    accessors: [
      { componentType: 5126, count: p.length / 3, type: 'VEC3', min, max },
      { componentType: 5125, count: p.length / 3, type: 'SCALAR' },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: data.byteLength }],
    buffers: [{ byteLength: data.byteLength }],
  };
  return writeGlb(json, new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
}

const partOf = (id: string) => {
  const t = templateById(id);
  return evaluate(t, defaultInputs(t), defaultToggles(t)).part!;
};

it.runIf(process.env.GEN_SAMPLES)('γράφει τα δοκιμαστικά αρχεία', async () => {
  const dir = join(process.cwd(), 'samples');
  mkdirSync(dir, { recursive: true });
  const cube = partOf('notched-cube').triangles;
  const block = partOf('bearing-block').triangles;
  const write = (name: string, data: ArrayBuffer | string) =>
    writeFileSync(join(dir, name), typeof data === 'string' ? data : Buffer.from(data));

  write('kyvos-egkopi_mm_Z.stl', toBinaryStl(cube, { unitMm: 1, up: 'Z' }));
  write('kyvos-egkopi_mm_Y.glb', toGlb(cube, { unitMm: 1, up: 'Y' }));
  write('kyvos-egkopi_m_Y.glb', toGlb(cube, { unitMm: 1000, up: 'Y' }));
  write('kyvos-egkopi_cm_Y.obj', toObj(cube, { unitMm: 10, up: 'Y' }));
  const { gltf, bin } = toGltfWithBin(cube, { unitMm: 1000, up: 'Y' }, 'kyvos-egkopi_m_Y.bin');
  write('kyvos-egkopi_m_Y.gltf', gltf);
  write('kyvos-egkopi_m_Y.bin', bin);
  write('edrano_in_Z.stl', toBinaryStl(block, { unitMm: 25.4, up: 'Z' }));
  write('kyvos-egkopi_draco_m_Y.glb', await toDracoGlb(cube, 1000));
});
