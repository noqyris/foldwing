/// <reference types="vitest" />
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the bundle works inside the Capacitor iOS/Android shell.
  base: './',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 2000,
  },
  server: {
    host: true,
    port: 5173,
  },
  test: {
    // Everything under test is pure math with no DOM dependency, so the fast
    // node environment is enough. Phaser is never imported by a test.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
