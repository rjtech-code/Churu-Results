import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    // Never inline assets as data: URIs — the backend CSP (default-src 'self') would block them.
    assetsInlineLimit: 0,
    sourcemap: false,
  },
  server: {
    port: 5173,
    strictPort: true,
    // Dev: the browser talks to Vite; /api goes to the backend. changeOrigin stays false so the
    // backend sees Origin http://localhost:5173 (set APP_ORIGIN to that in backend/.env for dev).
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: false } },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
  },
});
