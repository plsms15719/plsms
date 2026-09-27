import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  const isHttps = process.env.APP_URL ? process.env.APP_URL.startsWith('https') : false;

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
      dedupe: ['react', 'react-dom'],
    },
    server: {
      allowedHosts: true as const,
      hmr: {
        protocol: isHttps ? 'wss' : 'ws',
        clientPort: isHttps ? 443 : 3000,
      },
      watch: {
        ignored: ['**/data_storage/**', '**/*.db*', '**/*.json', '**/server/**'],
      },
    },
  };
});
