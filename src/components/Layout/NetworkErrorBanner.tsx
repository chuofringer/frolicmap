import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSessionStore } from '@/stores/useSessionStore'
import { useItems } from '@/hooks/useItems'

// Show only after the failure has persisted past one retry window, so
// transient flakes don't flash a scary banner. `useSession()` retries at
// 5s / 20s / 60s, so 2s is short enough that a real block is visible
// quickly but long enough to avoid the first-attempt flicker.
const SHOW_DELAY_MS = 2000

// Surfaced when session-mint fails. Most common real-world cause is a
// corporate firewall (Zscaler, Netskope, etc.) blocking the CORS preflight
// to api.frolicmap.app — from the user's POV the basemap paints but no pins
// ever appear and nothing explains why. This banner turns that silent
// failure into an actionable message.
export function NetworkErrorBanner() {
  const { t } = useTranslation()
  const status = useSessionStore((s) => s.status)
  // The catalog fetch is the OTHER way the map can end up empty while looking
  // healthy. When /api/items.json fails (its own 10/min/IP limiter trips on a
  // shared NAT, say) `data` is undefined, the MapLibre layer filter collapses
  // to `['in', id, []]` and matches nothing — yet vector tiles keep loading on
  // their own endpoint, so the basemap paints normally. The user sees a
  // perfect, pinless map and no explanation. This banner exists precisely to
  // eliminate that class of silent failure, so it has to watch both signals.
  const itemsFailed = useItems().isError
  const [hasFailed, setHasFailed] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  const broken = status === 'failed' || status === 'unavailable' || itemsFailed
  const recovered = status === 'ready' && !itemsFailed

  // Reset on recovery. Done as a render-time state adjustment keyed on the
  // `recovered` transition (React's "storing information from previous
  // renders" pattern) rather than a setState inside the effect below — same
  // semantics (only a ready session AND a healthy catalog clear the banner;
  // an in-flight retry keeps it), one fewer cascading render.
  const [wasRecovered, setWasRecovered] = useState(recovered)
  if (recovered !== wasRecovered) {
    setWasRecovered(recovered)
    if (recovered) {
      setHasFailed(false)
      setDismissed(false)
    }
  }

  useEffect(() => {
    if (!broken) return
    const t = setTimeout(() => setHasFailed(true), SHOW_DELAY_MS)
    return () => clearTimeout(t)
  }, [broken])

  if (!hasFailed || dismissed) return null

  const isConfig = status === 'unavailable'
  // Session minted fine but the catalog didn't: a different cause and a
  // different remedy, so say so rather than blaming the network.
  const isCatalog = !isConfig && status !== 'failed' && itemsFailed

  return (
    <div
      role="alert"
      className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[min(92vw,28rem)] bg-white dark:bg-gray-900 rounded-xl shadow-2xl ring-1 ring-black/20 dark:ring-white/10 p-5"
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">
          {t('map.networkErrorHeading')}
        </h2>
        <button
          aria-label={t('map.networkErrorDismissAriaLabel')}
          onClick={() => setDismissed(true)}
          className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none -mt-1 -mr-1"
        >
          ×
        </button>
      </div>
      {isCatalog ? (
        <div className="text-sm text-gray-600 dark:text-gray-300 space-y-2">
          <p>{t('map.networkErrorCatalogBody')}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">{t('map.networkErrorCatalogHint')}</p>
        </div>
      ) : isConfig ? (
        <p className="text-sm text-gray-600 dark:text-gray-300">{t('map.networkErrorConfigBody')}</p>
      ) : (
        <div className="text-sm text-gray-600 dark:text-gray-300 space-y-2">
          <p>
            {t('map.networkErrorReachPrefix')}{' '}
            <span className="font-mono text-xs bg-gray-100 dark:bg-gray-800 rounded px-1 py-0.5">
              api.frolicmap.app
            </span>
            {t('map.networkErrorReachSuffix')}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t('map.networkErrorAllowlistPrefix')} <span className="font-mono">frolicmap.app</span> {t('map.networkErrorAllowlistAnd')}{' '}
            <span className="font-mono">api.frolicmap.app</span>{t('map.networkErrorAllowlistSuffix')}
          </p>
        </div>
      )}
    </div>
  )
}
