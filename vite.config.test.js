import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/** Same app, with mapbox-gl swapped for the test double. */
export default defineConfig({
  plugins: [react()],
  // Lets the suite inspect what the store decided to write.
  define: { __B6_TEST__: 'true' },
  resolve: { alias: [{ find: /^mapbox-gl$/, replacement: path.resolve('./tests/mapbox-mock.js') }] },
  build: { outDir: 'dist-test' },
});
