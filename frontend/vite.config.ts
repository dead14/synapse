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
    // Bind on both IPv4 and IPv6 loopback interfaces. Some Chrome/Windows
    // configurations resolve `localhost` to 127.0.0.1 while Vite's default
    // hostname resolution can bind only to ::1, which presents as a blank
    // error page even though the dev server is running.
    host: true,
    proxy: {
      '/api': backendProxy,
      '/socket.io': {
        ...backendProxy,
        ws: true,
      },
    },
  },
  preview: {
    host: true,
    proxy: {
      '/api': backendProxy,
      '/socket.io': {
        ...backendProxy,
        ws: true,
      },
    },
  },
})
