import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// In dev, the Go server runs separately (default :8080) and Vite proxies the
// API to it. BANDMATE_API overrides where the API lives.
export default defineConfig({
  plugins: [svelte()],
  server: {
    proxy: {
      '/api': process.env.BANDMATE_API ?? 'http://localhost:8080',
    },
  },
});
