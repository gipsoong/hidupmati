import { defineConfig } from 'vite';

// Relative base so the build works from any static host path (GitHub Pages, etc.)
export default defineConfig({ base: './', build: { chunkSizeWarningLimit: 800 } });
