import { useEffect, useState } from 'react'
import { useMapStore } from '@/stores/useMapStore'
import { basemapSupports3D } from '@/config/mapStyle'

/**
 * Shared 3D-tilt toggle state + handler, extracted from MapControls so the
 * desktop control and the mobile ⋯ expander row (revision 4) drive the same
 * behavior. `is3D` reflects the live map pitch (aria-pressed source of truth);
 * `toggle3D` eases between flat and 60° pitch.
 */
export function use3DToggle() {
  const mapRef = useMapStore((s) => s.mapInstance)
  const basemap = useMapStore((s) => s.basemap)
  const [pitch, setPitch] = useState(0)

  useEffect(() => {
    if (!mapRef) return
    const map = mapRef.getMap()
    const onPitch = () => setPitch(map.getPitch())
    map.on('pitch', onPitch)
    return () => { map.off('pitch', onPitch) }
  }, [mapRef])

  const toggle3D = () => {
    const m = mapRef?.getMap()
    if (!m) return
    const isFlat = m.getPitch() < 5
    m.easeTo({ pitch: isFlat ? 60 : 0, duration: 400 })
  }

  return { is3D: pitch > 5, supports3D: basemapSupports3D(basemap), toggle3D }
}
