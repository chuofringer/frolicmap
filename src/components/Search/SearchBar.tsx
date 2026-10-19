import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { categoryLabel } from '@/config/categories'
import { useItems } from '@/hooks/useItems'
import { matchesActivity } from '@/utils/searchMatch'
import { useGeocodeQuery } from '@/hooks/useGeocode'
import { useMapStore } from '@/stores/useMapStore'
import { useFiltersStore } from '@/stores/useFiltersStore'

export function SearchBar() {
  const { t } = useTranslation()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const { data: itemsData } = useItems()
  // Item-name matches filter the in-memory list and can track every
  // keystroke; the geocode query hits Nominatim, whose usage policy
  // prohibits autocomplete — it runs only for a query submitted with Enter.
  const [submittedQ, setSubmittedQ] = useState('')
  const { data: geo } = useGeocodeQuery(submittedQ)
  const { setFlyTo, setSelectedId, setSearchMarker } = useMapStore()
  const setNearby = useFiltersStore((s) => s.setNearby)

  // Issue #212: name match OR category/type/synonym keyword match ("trampoline",
  // "storytime", "free indoor"…) — see src/utils/searchMatch.ts.
  const itemMatches = (itemsData?.items ?? [])
    .filter((i) => q.length >= 2 && (i.name.toLowerCase().includes(q.toLowerCase()) || matchesActivity(i, q, categoryLabel)))
    .slice(0, 5)

  const geoShown = submittedQ === q.trim() ? (geo ?? []) : []

  return (
    <div className="w-44">
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          className="w-full pl-9 pr-2 py-2 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 text-base md:text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-500 backdrop-blur-md outline-none ring-1 ring-black/20 dark:ring-white/10 focus:ring-1 focus:ring-amber-400"
          placeholder={t('search.placeholder')}
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) setSubmittedQ(q.trim()) }}
        />
        {open && q.length >= 2 && (itemMatches.length || geoShown.length > 0) && (
          <div className="absolute bottom-full mb-1 w-64 max-w-[calc(100vw-24px)] bg-white dark:bg-gray-900 rounded-lg shadow-lg ring-1 ring-black/20 dark:ring-white/10 max-h-72 overflow-auto text-sm">
            {itemMatches.map((i) => (
              <button
                key={i.id}
                className="block w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-900 dark:text-gray-100"
                onMouseDown={() => {
                  setFlyTo({ longitude: i.lng, latitude: i.lat, zoom: 15 })
                  setSelectedId(i.id)
                  setSearchMarker(null)
                  setOpen(false)
                }}
              >📍 {i.name}</button>
            ))}
            {geoShown.map((g, idx) => (
              <button
                key={idx}
                className="block w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200"
                onMouseDown={() => {
                  setFlyTo({ longitude: g.lng, latitude: g.lat, zoom: 14 })
                  setSearchMarker([g.lng, g.lat])
                  setNearby(null)
                  setOpen(false)
                }}
              >🏠 {g.label}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
