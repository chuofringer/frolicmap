import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'

// Vite's %VITE_…% HTML replacement leaves the LITERAL placeholder in the
// output when the var is unset at build time — prod shipped
// `data-cf-beacon='{"token": "%VITE_CF_BEAM_TOKEN%"}'` for weeks unnoticed
// (issue #644). With no token there is nothing for the beacon to report to,
// so drop the script tag entirely instead of shipping a broken one.
function stripBeaconWithoutToken(token: string | undefined): Plugin {
  return {
    name: 'frolicmap:strip-cf-beacon-without-token',
    transformIndexHtml(html) {
      if (token) return html
      return html.replace(/^[ \t]*<script[^>]*data-cf-beacon[^\n]*\n/m, '')
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [
    stripBeaconWithoutToken(loadEnv(mode, __dirname, '').VITE_CF_BEAM_TOKEN),
    react(),
    tailwindcss(),
    VitePWA({
      // `injectManifest`, not `generateSW`: the caching rules for #521 (never
      // cache /api, exclude the generated /cities* and /admin* surfaces from
      // navigation handling, cache-first only the MapLibre chunk + basemap
      // CDN hosts) are real branching logic, not declarative route configs —
      // `src/sw.ts` implements them by importing the pure, unit-tested
      // `src/pwa/cachingStrategy.ts` directly, which `generateSW`'s
      // stringified-predicate model can't do (it can't bundle an import).
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: false, // registered manually in src/pwa/registerServiceWorker.ts (kill switch + reload handling)
      manifest: false, // public/site.webmanifest already exists and is linked from index.html
      devOptions: { enabled: false }, // sw.ts only runs against a real `vite build`; see main.tsx's PROD guard
      injectManifest: {
        // AdminApp is Access-gated and lazy; never precache it — an
        // unauthenticated visitor's SW should never hold a copy of it.
        // MapLibre gets its own cache-first runtime route (src/sw.ts) instead
        // of being precached, per the issue's sizing note (~1MB chunk).
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2}'],
        globIgnores: [
          '**/AdminApp-*.js',
          '**/maplibre-gl-*.js',
          // Not part of the app shell — `og-image.png`/`logo.png` are only
          // fetched by social-media link scrapers and design assets, never
          // by the running app. `logo.png` alone is 3.5 MB, well past
          // Workbox's default 2 MiB precache-entry limit.
          'og-image.png',
          'logo.png',
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8787', // wrangler dev
    },
  },
}))
