import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: { __B6_TEST__: 'false' },
  server: { host: true, port: 5173 },
});
