import { FunMap } from '@/components/Map/FunMap'
import { Brand } from '@/components/Layout/Brand'
import { IconBar } from '@/components/Layout/IconBar'
import { MapControls } from '@/components/Layout/MapControls'
import { MetroPicker } from '@/components/Layout/MetroPicker'
import { LegendButton } from '@/components/Layout/LegendButton'
import { SearchFilterBar } from '@/components/Bar/SearchFilterBar'
import { WelcomeGate } from '@/components/Auth/WelcomeGate'
import { WaitlistSlideIn } from '@/components/Layout/WaitlistSlideIn'
import { RainyDayBanner } from '@/components/Layout/RainyDayBanner'
import { SignInToast } from '@/components/Layout/SignInToast'
import { NetworkErrorBanner } from '@/components/Layout/NetworkErrorBanner'
import { DetailOverlay } from '@/components/Panel/DetailOverlay'
import { ListPanel } from '@/components/List/ListPanel'
import { CalendarPanel } from '@/components/Calendar/CalendarPanel'
import { useUrlItem } from '@/hooks/useUrlItem'
import { useUrlCategory } from '@/hooks/useUrlCategory'
import { useUrlView } from '@/hooks/useUrlView'
import { useSession } from '@/hooks/useSession'
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
  // Sessions denominator for the /admin/behavior funnels: once per browser
  // session, site-wide (map/list/calendar, any metro), never on /admin —
  // App only renders for the map app. Runs AFTER FunMap's child effect has
  // called setAnalyticsRegion (child effects fire first), so the beacon
  // carries the metro on screen. sessionStorage-deduped + bot-guarded
  // inside trackSessionStart, so the empty dep array is belt-and-braces.
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
      <CalendarPanel />
      <LegendButton />
      <DetailOverlay />
      <WaitlistSlideIn />
      <RainyDayBanner />
      <NetworkErrorBanner />
      {/* First-visit sign-in overlay — z-50, above every other surface. (The
          old WelcomeBanner + quick tour were removed 2026-07-31: the gate is
          the one first-visit surface now.) */}
      <WelcomeGate />
      {/* Post-sign-in confirmation toast (fires on the auth-store flip from
          any sign-in surface, incl. cross-tab). */}
      <SignInToast />
    </div>
  )
}

export default App
