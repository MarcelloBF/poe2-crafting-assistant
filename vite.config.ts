import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// poe.ninja não envia cabeçalho CORS. Em desenvolvimento, o proxy abaixo permite
// que o navegador consulte a API pública de economia do PoE2 através do Vite.
// No executável, electron/main.cjs faz a mesma ponte. No site estático, o app usa a cópia
// public/data/prices/*.json gerada por `npm run prices:update` (o GitHub Actions roda a cada 6 h).
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    // release/ é a saída do electron-builder; observá-la trava a renomeação de pastas no Windows.
    watch: { ignored: ['**/release/**'] },
    proxy: {
      '/ninja': {
        target: 'https://poe.ninja',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/ninja/, ''),
        headers: { 'User-Agent': 'poe2-crafting-assistant (local dev proxy)' },
      },
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
} as any);
