import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

import svgr from 'vite-plugin-svgr';

const backendTarget = process.env.VITE_API_URL || 'http://localhost:8000';

const backendProxy = {
  target: backendTarget,
  changeOrigin: true,
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    svgr({
      svgrOptions: {
        icon: true,
        exportType: "named",
        namedExport: "ReactComponent",
      },
    })
  ],
  server: {
    proxy: {
      '/api': backendProxy,
      '/socket.io': {
        ...backendProxy,
        ws: true,
      },
    },
  },
  preview: {
    proxy: {
      '/api': backendProxy,
      '/socket.io': {
        ...backendProxy,
        ws: true,
      },
    },
  },
})
