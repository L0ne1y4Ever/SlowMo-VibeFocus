import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['three', 'lil-gui'],
        },
      },
    },
  },
  server: {
    host: true,
    port: 5173,
  },
});
