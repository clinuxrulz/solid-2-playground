import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: './',
  define: {
    'process.env': {},
  },
  resolve: {
    alias: {
      'node:assert': 'assert',
      '@net-vim/core': '/data/data/com.termux/files/home/GitHub/solid-2-playground/node_modules/@net-vim/core/dist/index.js',
    },
  },
  plugins: [
    tailwindcss(),
    solidPlugin(),
  ],
  server: {
    port: 3000,
  },
  build: {
    target: 'esnext',
  },
});
