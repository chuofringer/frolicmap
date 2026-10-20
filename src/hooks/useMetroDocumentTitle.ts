import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { getMetroBySlug } from '@shared/metros'
import { i18next } from '@/i18n'
import { metroName } from '@/config/metroNames'

/**
 * Keep `document.title` in step with the city on screen.
 *
 * A direct load of `/cities/{slug}` is served with a per-city title already;
 * the problem is an in-app switch (picker, city list, home redirect), where the
 * page is not reloaded and the tab would keep naming the previous city. The
 * strings are the same ones the prerender uses (`pages.citySeo.cityTitle`),
 * so a switched tab and a freshly loaded one read identically. Everything that
 * isn't a published city page gets the generic map title.
 */
export function useMetroDocumentTitle(): void {
  const { pathname } = useLocation()
  useEffect(() => {
    const slug = /^\/cities\/([a-z0-9-]+)\/?$/.exec(pathname)?.[1]
    const metro = slug ? getMetroBySlug(slug) : undefined
    document.title = metro?.published
      ? i18next.t('pages.citySeo.cityTitle', { city: metroName(metro) })
      : i18next.t('map.documentTitle')
  }, [pathname])
}
