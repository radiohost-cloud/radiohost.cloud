import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // FIX: Cast `process` to `any` to resolve TypeScript error about missing `cwd` property.
  // This is necessary because the Node.js type definitions are not being correctly resolved in the environment.
  const env = loadEnv(mode, (process as any).cwd(), '');
  return {
    plugins: [
      react(),
    ],
    server: {
      host: true,
      allowedHosts: [
        'studio.homelabz.co.uk'
      ],
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/media': {
            target: 'http://localhost:3000',
            changeOrigin: true,
        },
        '/artwork': {
            target: 'http://localhost:3000',
            changeOrigin: true,
        },
        '/stream': {
            target: 'http://localhost:3000',
            changeOrigin: true,
        },
        // Proxy WebSocket connections. The client will connect to ws(s)://<host>/socket
        // and Vite will forward it to ws://localhost:3000/socket
        '/socket': {
          target: 'ws://localhost:3000',
          ws: true,
        },
      }
    }
  };
});