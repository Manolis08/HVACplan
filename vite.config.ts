import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { serviceWorker } from './vite.plugins.ts';

export default defineConfig({
  // Σχετικές διαδρομές: το build δουλεύει σε οποιονδήποτε υποφάκελο φιλοξενίας.
  base: './',
  plugins: [react(), serviceWorker()],
  build: {
    // three.js + react-three-fiber: ένα μεγάλο αρχείο, αποθηκεύεται μία φορά από το service worker.
    chunkSizeWarningLimit: 1600,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
