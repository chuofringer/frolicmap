import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
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


describe('in-app navigation', () => {
  const Probe = () => <div data-testid="where">{useLocation().pathname}</div>

  function mount(entry: string | { pathname: string; state?: unknown } = '/cities') {
    return render(
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/cities" element={<CitiesPage />} />
          <Route path="/*" element={<Probe />} />
        </Routes>
      </MemoryRouter>,
    )
  }

  beforeEach(() => localStorage.removeItem('frolicmap.metro'))

  it('a plain click on a city card routes inside the SPA and remembers the choice', () => {
    mount()
    const card = screen.getByRole('link', { name: /Seattle/ })
    expect(card.getAttribute('href')).toBe('/cities/seattle') // still a real link
    expect(fireEvent.click(card)).toBe(false) // default (page load) prevented
    expect(screen.getByTestId('where')).toHaveTextContent('/cities/seattle')
    expect(localStorage.getItem('frolicmap.metro')).toBe('seattle')
  })

  it('leaves modified clicks to the browser (new tab)', () => {
    mount()
    const card = screen.getByRole('link', { name: /Seattle/ })
    card.addEventListener('click', (e) => e.preventDefault()) // keep jsdom from "navigating"
    fireEvent.click(card, { metaKey: true })
    fireEvent.click(card, { ctrlKey: true })
    expect(screen.queryByTestId('where')).toBeNull() // still on the list
    expect(localStorage.getItem('frolicmap.metro')).toBe('seattle') // a pick is a pick
  })

  it('"Back to map" returns to the city we came from', () => {
    mount({ pathname: '/cities', state: { fromMetro: 'seattle' } })
    const back = screen.getByRole('link', { name: /Back to the map/ })
    expect(back.getAttribute('href')).toBe('/cities/seattle')
    fireEvent.click(back)
    expect(screen.getByTestId('where')).toHaveTextContent('/cities/seattle')
  })

  it('"Back to map" falls back to the stored city, then to the home map', () => {
    mount()
    expect(screen.getByRole('link', { name: /Back to the map/ }).getAttribute('href')).toBe('/')
    cleanup()
    localStorage.setItem('frolicmap.metro', 'boston')
    mount()
    expect(screen.getByRole('link', { name: /Back to the map/ }).getAttribute('href')).toBe('/cities/boston')
  })

  it('sets the list title', () => {
    mount()
    expect(document.title).toBe('Kids Activities by City | frolicmap')
  })
})
