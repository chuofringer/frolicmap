import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMapStore } from '@/stores/useMapStore'
import { use3DToggle } from '@/hooks/use3DToggle'

export function MapControls() {
  const { t } = useTranslation()
  const mapRef = useMapStore((s) => s.mapInstance)
  // Shift the zoom/3D controls clear of an open detail panel on md+ (matches
  // IconBar / LegendButton). On mobile the top offset is 168px so these controls
  // clear IconBar's standalone top-right column — the Buy Me a Coffee button
  // plus the language toggle stacked below the ⋯ (bottom of the column =
  // 160px, post-2026-08-09 envelope removal); desktop keeps the tighter 68px.
  const detailOpen = useMapStore((s) => s.selectedId !== null)
  const [bearing, setBearing] = useState(0)
  const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 768
  const { is3D, supports3D, toggle3D } = use3DToggle()

  useEffect(() => {
    if (!mapRef) return
    const map = mapRef.getMap()
    const onRotate = () => setBearing(map.getBearing())
    map.on('rotate', onRotate)
    return () => { map.off('rotate', onRotate) }
  }, [mapRef])

  const btn = 'backdrop-blur-md bg-white/90 dark:bg-gray-900/90 text-gray-700 dark:text-gray-200 rounded-lg shadow-lg ring-1 ring-black/20 dark:ring-white/10 w-11 h-11 flex items-center justify-center hover:bg-white dark:hover:bg-gray-900 transition-colors'
  const btnActive = 'backdrop-blur-md bg-amber-500 text-white rounded-lg shadow-lg ring-1 ring-black/20 dark:ring-white/10 w-11 h-11 flex items-center justify-center hover:bg-amber-600 transition-colors'

  const resetNorth = () => mapRef?.getMap().easeTo({ bearing: 0, duration: 300 })
  const zoomIn = () => mapRef?.getMap().zoomIn({ duration: 200 })
  const zoomOut = () => mapRef?.getMap().zoomOut({ duration: 200 })

  const isRotated = Math.abs(bearing) > 0.5

  return (
    <div className={`absolute top-[168px] md:top-[68px] right-3 z-20 flex flex-col gap-2 transition-transform duration-200 ${detailOpen ? 'md:-translate-x-[392px]' : ''}`}>
      {isRotated && (
        <button onClick={resetNorth} aria-label={t('map.resetBearingAriaLabel')} title={t('map.resetNorthTitle')} className={btn}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ transform: `rotate(${-bearing}deg)`, transition: 'transform 0.1s ease-out' }}>
            <path d="M12 2 L18 20 L12 16 L6 20 Z" fill="currentColor" />
          </svg>
        </button>
      )}
      {isDesktop && (
        <>
          <button onClick={zoomIn} aria-label={t('map.zoomInLabel')} title={t('map.zoomInLabel')} className={`${btn} font-bold text-xl leading-none`}>+</button>
          <button onClick={zoomOut} aria-label={t('map.zoomOutLabel')} title={t('map.zoomOutLabel')} className={`${btn} font-bold text-xl leading-none`}>−</button>
        </>
      )}
      {/* 3D lives in the mobile ⋯ expander row (revision 4); here it's desktop-only. */}
      <div className="hidden md:block">
        <button
          onClick={toggle3D}
          aria-pressed={is3D}
          title={supports3D ? t('map.toggle3DTitleSupported') : t('map.toggle3DTitleUnsupported')}
          aria-label={t('map.toggle3DAriaLabel')}
          className={`${is3D ? btnActive : btn} font-bold text-sm leading-none tracking-tight`}
        >
          {t('map.threeDLabel')}
        </button>
      </div>
    </div>
  )
}
