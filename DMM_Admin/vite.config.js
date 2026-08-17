import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    host: '0.0.0.0',
    port: 3001,
    allowedHosts: ['tag.ncet.co.in'],
    proxy: {
      '/api': 'http://localhost:3002',
      '/uploads': 'http://localhost:3002',
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 3001,
    allowedHosts: ['tag.ncet.co.in'],
  },
});
