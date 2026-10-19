/**
 * Service worker registration — issue #521.
 *
 * Two things live here beyond a plain `registerSW()` call:
 *
 * 1. A kill switch (`VITE_PWA_DISABLED=true`). If a shipped SW ever
 *    misbehaves in prod, the fix must not depend on every client visiting
 *    again to pick up a *fixed* SW — that's the same chicken-and-egg problem
 *    a bad SW creates in the first place. Flipping the env var and
 *    redeploying makes every subsequent load unregister any existing SW and
 *    drop its caches instead of registering a new one, same shape as the
 *    other kill switches in this repo (`EVENTS_GATE_ENABLED`,
 *    `WELCOME_GATE_FIRST_VISIT_ENABLED` in `src/config/constants.ts`).
 *
 * 2. A one-shot reload on `vite:preloadError`. Hashed chunk filenames mean a
 *    client that's had the app open across a deploy will request a chunk
 *    (e.g. `CitiesPage-*.js`) that the new deploy no longer serves — 404, and
 *    `import()` rejects. `skipWaiting`/`clientsClaim` in `src/sw.ts` narrow
 *    that window but can't close it (a request in flight when the new worker
 *    activates still finishes on the old one). Session-storage flag caps it
 *    at one reload so a genuinely broken deploy fails loudly instead of
 *    reload-looping.
 */

const CHUNK_RELOAD_FLAG = 'frolicmap.pwaChunkReload'

function installChunkReloadHandler(): void {
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault()
    let alreadyTried = false
    try {
      alreadyTried = sessionStorage.getItem(CHUNK_RELOAD_FLAG) === '1'
    } catch {
      /* private mode: can't dedupe, but a single stray reload is harmless */
    }
    if (alreadyTried) {
      console.error('[pwa] dynamic import failed again after a reload; not retrying', event)
      return
    }
    try {
      sessionStorage.setItem(CHUNK_RELOAD_FLAG, '1')
    } catch {
      /* private mode */
    }
    window.location.reload()
  })
}

/** Call once the app has actually rendered, so a later stale-chunk failure after a future deploy can still trigger one more reload. */
export function clearChunkReloadFlag(): void {
  try {
    sessionStorage.removeItem(CHUNK_RELOAD_FLAG)
  } catch {
    /* private mode */
  }
}

async function unregisterAndPurge(): Promise<void> {
  const regs = await navigator.serviceWorker.getRegistrations()
  await Promise.all(regs.map((r) => r.unregister()))
  if ('caches' in window) {
    const keys = await caches.keys()
    await Promise.all(keys.filter((k) => k.startsWith('frolicmap-')).map((k) => caches.delete(k)))
  }
}

export async function setupServiceWorker(): Promise<void> {
  installChunkReloadHandler()

  if (!('serviceWorker' in navigator)) return

  if (import.meta.env.VITE_PWA_DISABLED === 'true') {
    await unregisterAndPurge().catch((err) => console.error('[pwa] kill switch cleanup failed', err))
    return
  }

  // `virtual:pwa-register` is vite-plugin-pwa's client module — only real
  // under `vite build` (see the `import.meta.env.PROD` guard in `main.tsx`'s
  // caller); `vite dev` never emits a sw.js to register against.
  const { registerSW } = await import('virtual:pwa-register')
  registerSW({ immediate: true })
}
