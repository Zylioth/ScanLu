import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'ScanLu',
        short_name: 'ScanLu',
        description: 'Scan, order a drink, get a ticket.',
        theme_color: '#0B3D2E',
        background_color: '#FFF9EE',
        display: 'standalone',
        orientation: 'any',
        // Relative, so the install target follows whatever base the site is
        // served from (root locally, /ScanLu/ on GitHub Pages).
        start_url: './menu',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // /admin must still get the app shell, so no denylist here. The base
        // path is applied by Vite when the site is served from a subdirectory.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@supabase')) return 'supabase'
          if (id.includes('@fontsource')) return 'fonts'
        },
      },
    },
  },
})
