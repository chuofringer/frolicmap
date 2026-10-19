import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { CitiesPage } from '../CitiesPage'
import { i18next, loadLocale } from '@/i18n'
import { publishedMetros } from '@shared/metros'

/**
 * `/zh/cities` used to fall through to the catch-all and render the Bay Area
 * MAP, because `useMetro`'s regex requires a slug. The route ordering in
 * `main.tsx` is what fixes that, and route ordering is easy to disturb — so
 * this pins the distinction rather than trusting the file's line order.
 */
function routerAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]} basename={path.startsWith('/zh') ? '/zh' : undefined}>
      <Routes>
        <Route path="/cities" element={<CitiesPage />} />
        <Route path="/*" element={<div data-testid="map-catchall" />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => window.history.pushState({}, '', '/'))
afterEach(async () => { await i18next.changeLanguage('en') })

describe('routing', () => {
  it('/cities renders the city index, not the map', () => {
    routerAt('/cities')
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
    expect(screen.queryByTestId('map-catchall')).not.toBeInTheDocument()
  })

  it('/zh/cities renders the city index, not the map', () => {
    routerAt('/zh/cities')
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
    expect(screen.queryByTestId('map-catchall')).not.toBeInTheDocument()
  })

  it('/cities/{slug} still falls through to the map', () => {
    routerAt('/cities/seattle')
    expect(screen.getByTestId('map-catchall')).toBeInTheDocument()
  })
})

describe('content', () => {
  it('lists every published metro', () => {
    routerAt('/cities')
    for (const m of publishedMetros()) {
      expect(screen.getByText(m.label)).toBeInTheDocument()
    }
  })

  it('renders Chinese metro names in Chinese', async () => {
    await loadLocale('zh')
    routerAt('/zh/cities')
    expect(screen.getByText('旧金山湾区')).toBeInTheDocument()
    expect(screen.getByText('西雅图')).toBeInTheDocument()
  })

  it('keeps every link inside the reader’s language', async () => {
    await loadLocale('zh')
    window.history.pushState({}, '', '/zh/cities')
    const { container } = routerAt('/zh/cities')
    const internal = [...container.querySelectorAll('a')]
      .map((a) => a.getAttribute('href') ?? '')
      .filter((h) => h.startsWith('/'))
    expect(internal.length).toBeGreaterThan(publishedMetros().length)
    expect(internal.filter((h) => !h.startsWith('/zh'))).toEqual([])
  })

  it('carries no prefix in English', () => {
    window.history.pushState({}, '', '/cities')
    const { container } = routerAt('/cities')
    const internal = [...container.querySelectorAll('a')]
      .map((a) => a.getAttribute('href') ?? '')
      .filter((h) => h.startsWith('/'))
    expect(internal.filter((h) => h.startsWith('/zh'))).toEqual([])
  })
})
