import { useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { BASEMAPS, basemapLabel } from '@/config/mapStyle'
import { useMapStore } from '@/stores/useMapStore'

interface Props {
  open: boolean
  onToggle: () => void
  onClose: () => void
}

export function BasemapButton({ open, onToggle, onClose }: Props) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const basemap = useMapStore((s) => s.basemap)
  const setBasemap = useMapStore((s) => s.setBasemap)

  useEffect(() => {
    if (!open) return
    const click = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', click)
    return () => document.removeEventListener('mousedown', click)
  }, [open, onClose])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={onToggle}
        aria-pressed={open}
       
        className={`backdrop-blur-md ${open ? 'bg-white dark:bg-gray-900' : 'bg-white/90 dark:bg-gray-900/90'} text-gray-700 dark:text-gray-200 rounded-lg shadow-lg ring-1 ring-black/20 dark:ring-white/10 w-11 h-11 flex items-center justify-center hover:bg-white dark:hover:bg-gray-900 transition-colors`}
        title={t('map.changeBasemapLabel')}
        aria-label={t('map.changeBasemapLabel')}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 2L2 7l10 5 10-5-10-5z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2 17l10 5 10-5" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2 12l10 5 10-5" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 backdrop-blur-md bg-white/95 dark:bg-gray-900/95 rounded-lg shadow-lg ring-1 ring-black/20 dark:ring-white/10 overflow-hidden min-w-[160px] text-gray-700 dark:text-gray-200">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 px-3 py-1.5 border-b border-gray-100 dark:border-gray-800">{t('map.basemapHeading')}</div>
          {BASEMAPS.map((b) => (
            <button
              key={b.id}
              onClick={() => { setBasemap(b.id); onClose() }}
              className="w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <span>{basemapLabel(b.id)}</span>
              {basemap === b.id && (
                <svg className="w-4 h-4 flex-shrink-0" style={{ color: '#f59e0b' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
