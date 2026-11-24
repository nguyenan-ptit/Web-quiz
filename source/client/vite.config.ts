import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../..', '');
  const target = env.BACKEND_URL || 'http://localhost:8080';
  return {
    plugins: [react()],
    envDir: '../..',
    server: {
      port: 5173,
      proxy: {
        '/api': { target, changeOrigin: true },
        '/ws': { target, ws: true },
      },
    },
  };
});
