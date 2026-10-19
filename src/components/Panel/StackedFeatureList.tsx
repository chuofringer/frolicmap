import { Popup } from 'react-map-gl/maplibre'
import { useTranslation } from 'react-i18next'
import { useMapStore } from '@/stores/useMapStore'
import { useAuthStore } from '@/stores/useAuthStore'
import { useItems } from '@/hooks/useItems'
import { CATEGORIES } from '@/config/categories'
import { EVENTS_GATE_ENABLED } from '@/config/constants'
import { isGatedEventKind } from '@shared/eventsGate'
import { sameNameFuzzy } from '@/utils/sameNameFuzzy'
import { openItemDetail } from '@/utils/openItem'
import { displayTitle } from '@/utils/displayTitle'
import { intlLocale } from '@/i18n'
import { parseEventTime, venueTimezone, wallEndExclusive, wallNow } from '@/utils/venueTime'

// Rendered when a click lands on 2+ pins within a few pixels of each
// other (see FunMap's click handler). Instead of opening whichever pin
// MapLibre happened to list first, we surface a lightweight picker so
// every overlapping feature stays reachable. See TODO.md "Stacked-pin
// mini-list" for the Ardenwood-style cases that motivated this.
export function StackedFeatureList() {
  const { t } = useTranslation()
  const cluster = useMapStore((s) => s.stackedFeatures)
  const setStacked = useMapStore((s) => s.setStackedFeatures)
  const signedIn = useAuthStore((s) => s.signedIn)
  const { data } = useItems()

  if (!cluster) return null

  const itemsById = new Map(data?.items.map((i) => [i.id, i]) ?? [])

  // Collapse undated rows whose name fuzzily matches a dated sibling in
  // the same cluster. Happens when ingesters land a venue-as-event row
  // alongside the actual dated event ("Santa Clara County Fair 2026" +
  // "Santa Clara County Fairgrounds"). `pickEarliestPerSource` already
  // handles exact-name matches; this picks up the near-misses.
  const datedFeatures = cluster.features.filter(
    (f) => itemsById.get(f.id)?.start_time,
  )
  const deduped = cluster.features.filter((f) => {
    const hasDate = !!itemsById.get(f.id)?.start_time
    if (hasDate) return true
    return !datedFeatures.some((d) => sameNameFuzzy(d.name, f.name))
  })

  // Dated events first, chronological; permanent items (parks, libraries)
  // trail at the bottom in alphabetical order. ISO strings sort correctly
  // with localeCompare.
  const rows = [...deduped].sort((a, b) => {
    const ta = itemsById.get(a.id)?.start_time ?? null
    const tb = itemsById.get(b.id)?.start_time ?? null
    if (ta && tb) return ta.localeCompare(tb)
    if (ta) return -1
    if (tb) return 1
    return a.name.localeCompare(b.name)
  })

  return (
    <Popup
      longitude={cluster.lng}
      latitude={cluster.lat}
      anchor="bottom"
      offset={12}
      closeButton={false}
      closeOnClick={false}
      onClose={() => setStacked(null)}
      maxWidth="300px"
      className="funradar-popup"
    >
      <div className="text-gray-900 dark:text-gray-100" style={{ minWidth: '220px', maxWidth: '280px' }}>
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="text-[11px] text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            {t('detail.itemsHere', { count: rows.length })}
          </div>
          <button
            aria-label={t('detail.close')}
            className="text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 text-xl leading-none flex-shrink-0 -mr-1 -mt-1"
            onClick={() => setStacked(null)}
          >×</button>
        </div>
        <ul
          className="divide-y divide-gray-200 dark:divide-gray-700 overflow-y-auto overscroll-contain"
          style={{ maxHeight: '10.5rem' }}
        >
          {rows.map((f) => {
            const meta = CATEGORIES[f.category]
            const item = itemsById.get(f.id)
            const startIso = item?.start_time ?? null
            const endIso = item?.end_time ?? null
            // Month-long events (Apr 1 – Apr 30 on Apr 23) read as expired
            // when the chip only shows the start date. When today is inside
            // the window, show the full range — the "–30" tail signals
            // "still running" without needing a separate icon. Dates render
            // on the VENUE's wall clock so the chip shows the venue's
            // calendar day for every viewer.
            const tz = item ? venueTimezone(item.lat, item.lng) : undefined
            const startParsed = startIso ? parseEventTime(startIso, tz) : null
            const endParsed = endIso ? parseEventTime(endIso, tz) : null
            const start = startParsed?.wall ?? null
            const end = endParsed?.wall ?? null
            const now = wallNow(tz)
            const isMultiDay = !!start && !!end && start.toDateString() !== end.toDateString()
            const isOngoing = isMultiDay && start! <= now && now <= wallEndExclusive(endParsed!)
            const fmtMD = (d: Date) => d.toLocaleDateString(intlLocale(), { month: 'short', day: 'numeric' })
            let date: string | null = null
            if (start) {
              if (isOngoing) {
                const sameMonth =
                  start.getMonth() === end!.getMonth() && start.getFullYear() === end!.getFullYear()
                date = sameMonth
                  ? `${fmtMD(start)}–${end!.getDate()}` // "Apr 1–30"
                  : `${fmtMD(start)} – ${fmtMD(end!)}`  // "Apr 25 – May 5"
              } else {
                date = fmtMD(start)
              }
            }
            // Events sign-in gate: names + dates of gated rows blur (same
            // shared predicate as the detail/list surfaces — operator-found
            // leak: this picker showed full event names + dates to guests).
            // The row stays tappable → the detail's unlock card. The lock
            // glyph marks WHY the row is fuzzy.
            const gated = EVENTS_GATE_ENABLED && !signedIn && isGatedEventKind(item ?? f)
            return (
              <li key={f.id}>
                <button
                  type="button"
                  aria-label={gated ? t('auth.gatedEventAriaLabel') : undefined}
                  className="w-full text-left py-1.5 flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-800 -mx-1 px-1 rounded"
                  onClick={() => {
                    openItemDetail(item ?? f)
                  }}
                >
                  <span aria-hidden={gated || undefined} className={`text-[11px] font-semibold text-amber-700 dark:text-amber-400 tabular-nums min-w-14 whitespace-nowrap flex-shrink-0 text-right ${gated ? 'blur-[4px] select-none' : ''}`}>
                    {date ?? ''}
                  </span>
                  <span className="text-base leading-none">{meta?.emoji ?? '❓'}</span>
                  <span aria-hidden={gated || undefined} className={`text-sm truncate flex-1 text-gray-600 dark:text-gray-300 ${gated ? 'blur-[4px] select-none' : ''}`}>{displayTitle(item ?? f).title}</span>
                  {gated && <span aria-hidden className="text-[11px] flex-shrink-0 opacity-70">🔒</span>}
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </Popup>
  )
}
