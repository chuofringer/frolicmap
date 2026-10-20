import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'
import { getMetroBySlug, publishedMetros } from '@shared/metros'
import { CHIP_ORDER, categoryLabel, getCategoryEmoji } from '@/config/categories'
import { CATEGORY_COLOR } from '@shared/categorySlugs'
import { metroName } from '@/config/metroNames'
import { InAppLink } from '@/components/Layout/InAppLink'
import { storeMetroSlug, storedMetroSlug } from '@/hooks/useHomeMetroRedirect'

/**
 * The city index, rendered by the SPA.
 *
 * On English this route is normally unreachable: `/cities` is a prerendered
 * static file (`build-seo-pages.mjs`) and a static file always wins at the
 * edge. It exists for the locales that have no generated pages — today `/zh`,
 * where `/zh/cities` previously fell through to the catch-all and rendered the
 * Bay Area map instead of a list, which is not what "browse all cities" means
 * in any language.
 *
 * It is deliberately NOT a translation of the static page: no place counts (the
 * SPA has no per-metro totals without a fetch) and no map thumbnails. Names and
 * links only — enough to choose a city, which is the whole job.
 */
export function CitiesPage() {
  const { t } = useTranslation()
  const metros = publishedMetros()
  const { state } = useLocation()

  // Reached in-app (the picker's "Browse all cities" or "/" with no choice):
  // the tab title must stop naming the city we came from.
  useEffect(() => {
    document.title = t('pages.citySeo.indexTitle')
  }, [t])

  // Every link is an `InAppLink`: a real localised `href` for crawlers,
  // middle-click and new tabs, but a plain click navigates inside the running
  // SPA, so the prerendered `/cities/{slug}` crawler fallback never flashes.
  // "Back to map" returns to the city we came from (router state), else the
  // stored choice, else the home map.
  const from = (state as { fromMetro?: unknown } | null)?.fromMetro
  const fromMetro = typeof from === 'string' ? getMetroBySlug(from) : undefined
  const backSlug = fromMetro?.published ? fromMetro.slug : storedMetroSlug()
  const backTo = backSlug ? `/cities/${backSlug}` : '/'

  return (
    <div className="min-h-dvh bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <nav className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          <InAppLink to={backTo} className="hover:underline">{t('pages.cities.backToMap')}</InAppLink>
        </nav>

        <h1 className="text-2xl font-bold mb-2">{t('pages.cities.heading')}</h1>
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-6">{t('pages.cities.lede')}</p>

        {/* The legend vocabulary, verbatim and in order — the same eleven
            entries the map legend shows (zoo folds into "Aquarium/Zoo"), so
            this page and the map agree on what a pin is. Never abbreviated
            into an "& More". */}
        <ul className="flex flex-wrap gap-x-3 gap-y-1.5 mb-8 text-xs text-gray-600 dark:text-gray-300">
          {CHIP_ORDER.map((cat) => (
            <li key={cat} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="w-2.5 h-2.5 rounded-full inline-block"
                style={{ backgroundColor: CATEGORY_COLOR[cat] }}
              />
              <span aria-hidden>{getCategoryEmoji(cat)}</span>
              {categoryLabel(cat)}
            </li>
          ))}
        </ul>

        <ul className="grid gap-2 sm:grid-cols-2">
          {metros.map((m) => (
            <li key={m.id}>
              <InAppLink
                to={`/cities/${m.slug}`}
                // An explicit pick: remember it so `/` opens here next time.
                onClick={() => storeMetroSlug(m.slug)}
                className="flex items-baseline justify-between gap-3 rounded-lg bg-white dark:bg-gray-900 ring-1 ring-black/10 dark:ring-white/10 px-4 py-3 hover:ring-amber-500 transition-colors"
              >
                <span className="font-semibold">{metroName(m)}</span>
                <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">{m.state}</span>
              </InAppLink>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export default CitiesPage
