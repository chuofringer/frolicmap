import { FunMap } from '@/components/Map/FunMap'
import { Brand } from '@/components/Layout/Brand'
import { IconBar } from '@/components/Layout/IconBar'
import { MapControls } from '@/components/Layout/MapControls'
import { MetroPicker } from '@/components/Layout/MetroPicker'
import { LegendButton } from '@/components/Layout/LegendButton'
import { SearchFilterBar } from '@/components/Bar/SearchFilterBar'
import { NetworkErrorBanner } from '@/components/Layout/NetworkErrorBanner'
import { DetailOverlay } from '@/components/Panel/DetailOverlay'
import { ListPanel } from '@/components/List/ListPanel'
import { useUrlItem } from '@/hooks/useUrlItem'
import { useUrlCategory } from '@/hooks/useUrlCategory'
import { useUrlView } from '@/hooks/useUrlView'
import { useSession } from '@/hooks/useSession'
import { useHomeMetroRedirect } from '@/hooks/useHomeMetroRedirect'
import { trackSessionStart } from '@/utils/analytics'
import { useEffect } from 'react'

export function App() {
  // Mint + auto-refresh a session token for data-protection Phase 2c.
  // Detail popup fetches attach `Authorization: Bearer <token>`; without
  // the hook, every detail fetch 401s and ItemPopup's error-fallback
  // renders "Details unavailable."
  useSession()
  useUrlItem()
  useUrlCategory()
  useUrlView()
  // `/` only: open the visitor's metro (stored choice, else the edge's approximate
  // city), or the city list. No-op on /cities/{slug} and for crawlers.
  useHomeMetroRedirect()
  // Once per browser session; sessionStorage-deduped and bot-guarded inside
  // trackSessionStart, so the empty dep array is belt-and-braces.
  useEffect(() => {
    trackSessionStart()
  }, [])
  return (
    <div className="fixed inset-0 overflow-hidden">
      <FunMap />
      {/*
        Top-left cluster: the brand box and the city-picker trigger share a
        single fit-content container so the trigger renders at EXACTLY the
        brand box's width (flex-col stretch), no magic numbers. z-30 keeps the
        picker's fixed dialog/backdrop above the z-20 map controls, as before.
      */}
      <div className="absolute top-3 left-3 z-30 flex flex-col gap-2 w-fit">
        <Brand />
        <MetroPicker />
      </div>
      <IconBar />
      <MapControls />
      <SearchFilterBar />
      <ListPanel />
      <LegendButton />
      <DetailOverlay />
      <NetworkErrorBanner />
    </div>
  )
}

export default App
