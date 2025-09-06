/// <reference types="node" />

import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [
      react(),
    ],
    define: {
      'process.env.API_KEY': JSON.stringify(env.VITE_GEMINI_API_KEY),
    },
    server: {
      host: true, // Expose on network
      allowedHosts: [
        'studio.homelabz.co.uk'
      ],
      proxy: {
        // Proxy API requests
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        // Proxy public stream endpoint
        '/main': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        // Proxy WebSocket connections
        '/ws': {
          target: 'ws://localhost:3000',
          ws: true,
        },
      }
    }
  };
});