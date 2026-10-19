import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import { App } from './App'
import { useMapStore } from './stores/useMapStore'
import { getBasemapTheme } from './config/mapStyle'
import { loadLocale, i18next } from './i18n'
import { isAdminPath, localeBasename, localeFromPath, redirectToStoredLocale } from './i18n/locale'
import { clearChunkReloadFlag, setupServiceWorker } from './pwa/registerServiceWorker'

// Lazy page components live in ./pages/lazyPages: react-refresh/only-export-components
// wants component definitions in files that export them, and this entry file
// exports nothing.
import { AdminApp, TermsPage, PrivacyPage, CitiesPage } from './pages/lazyPages'

const applyTheme = (basemap: Parameters<typeof getBasemapTheme>[0]) => {
  document.documentElement.classList.toggle('dark', getBasemapTheme(basemap) === 'dark')
}
applyTheme(useMapStore.getState().basemap)
useMapStore.subscribe((s, prev) => {
  if (s.basemap !== prev.basemap) applyTheme(s.basemap)
})

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
  },
})

// A returning visitor who chose Chinese lands here on an unprefixed URL — a
// bookmark, a search result, a shared English link, or one of our own
// `/cities/{slug}` links. Send them to their language BEFORE anything mounts.
//
// This has to happen as a redirect rather than by handing the stored locale to
// `basename`: react-router renders NOTHING when its basename doesn't prefix
// the current path, so `basename="/zh"` on `/` is a blank page, not a fallback.
// Terminates because the target path always carries the prefix.
// A never-settling promise rather than a throw: the navigation is already in
// flight, and an uncaught module-eval error would show up in the console (and
// any future error tracking) on every single redirect.
if (redirectToStoredLocale()) await new Promise(() => {})

// The basename is derived from the PATH ONLY, never from storage, for the same
// reason. Every route below is therefore written once, unprefixed.
// `/admin` is never translated, even reached as `/zh/admin`.
const locale = isAdminPath(window.location.pathname)
  ? 'en'
  : localeFromPath(window.location.pathname) ?? 'en'

// Fetch the locale bundle before the first paint so nothing renders in the
// wrong language. English needs no fetch. A rejection here (a purged chunk
// after a deploy, a flaky network) must not abort module evaluation and leave
// a white page — i18next is already initialised with English synchronously, so
// degrading to an English UI beats rendering nothing.
await loadLocale(locale).catch((err) => {
  console.error('[i18n] locale bundle failed to load; falling back to English', err)
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* Chinese lives under `/zh`; English is the root. */}
      <BrowserRouter basename={localeBasename(locale)}>
        <Routes>
          <Route path="/admin/*" element={<Suspense fallback={<div className="p-6">{i18next.t('common.loading')}</div>}><AdminApp /></Suspense>} />
          <Route path="/terms" element={<Suspense fallback={<div className="p-6">{i18next.t('common.loading')}</div>}><TermsPage /></Suspense>} />
          <Route path="/privacy" element={<Suspense fallback={<div className="p-6">{i18next.t('common.loading')}</div>}><PrivacyPage /></Suspense>} />
          {/* Only ever reached where no static /cities file exists — i.e. the
              locale prefixes, which have no generated pages. On English the
              prerendered file wins at the edge. */}
          <Route path="/cities" element={<Suspense fallback={<div className="p-6">{i18next.t('common.loading')}</div>}><CitiesPage /></Suspense>} />
          <Route path="/*" element={<App />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)

// Only in production builds: `vite dev` never emits a sw.js, and registering
// against a dev server's HMR-driven module graph would just create noise.
if (import.meta.env.PROD) {
  clearChunkReloadFlag()
  void setupServiceWorker()
}
