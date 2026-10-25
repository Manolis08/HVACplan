import { DRACO_GLTF_CONFIG, DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Ο αποκωδικοποιητής Draco πακετάρεται μέσα στην εφαρμογή (το Vite αντιγράφει τα αρχεία του
// three.js), άρα η αποσυμπίεση δουλεύει και χωρίς internet. Χρησιμοποιούμε την έκδοση για glTF.
let draco: DRACOLoader | null = null;

export function configureDraco(loader: GLTFLoader) {
  if (!draco) {
    draco = new DRACOLoader();
    draco.setDecoderPath(DRACO_GLTF_CONFIG);
  }
  loader.setDRACOLoader(draco);
}
