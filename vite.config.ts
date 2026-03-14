import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ESM_SH_DEPENDENCIES = [
  'https://esm.sh/solid-js@2.0.0-experimental.15',
  'https://esm.sh/@solidjs/web@2.0.0-experimental.15',
];

export default defineConfig({
  base: './',
  define: {
    'process.env': {},
  },
  resolve: {
    alias: {
      'node:assert': 'assert',
      '@net-vim/core': path.resolve(__dirname, 'node_modules', '@net-vim/core', 'dist', 'index.js'),
    },
  },
  plugins: [
    tailwindcss(),
    solidPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'Solid 2.0 Playground',
        short_name: 'Solid2Play',
        description: 'A playground for Solid 2.0, built with Solid 1.0',
        theme_color: '#000000',
        icons: [
          {
            src: 'vite-icon.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
          },
          {
            src: 'vite-icon.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
          },
          {
            src: 'vite-icon.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        additionalManifestEntries: ESM_SH_DEPENDENCIES.map((url) => ({ url, revision: null })),
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/cdnjs\.cloudflare\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'cloudflare-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365, // <== 365 days
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^https:\/\/esm\.sh\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'esm-sh-cache',
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 60 * 60 * 24 * 365, // <== 365 days
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 3000,
  },
  build: {
    target: 'esnext',
  },
});
