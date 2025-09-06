/// <reference types="node" />

import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import expressApp from './server.js'; // Import the express app

// Custom plugin to run express server as middleware
const expressServerPlugin = {
  name: 'express-server',
  configureServer(server) {
    // Mount the express app as a middleware
    server.middlewares.use(expressApp);
  }
};


// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // FIX: The explicit import of 'process' was removed to resolve a TypeScript type conflict.
  // The global `process` object is available in the Vite config (a Node.js environment),
  // and its type is correctly inferred from the `/// <reference types="node" />` directive at the top of the file.
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [
      react(),
      expressServerPlugin,
    ],
    define: {
      'process.env.API_KEY': JSON.stringify(env.VITE_GEMINI_API_KEY),
    },
    // The server.proxy option is no longer needed as we are using middleware
    server: {
      host: true,
      allowedHosts: [
        'studio.homelabz.co.uk'
      ]
    }
  };
});