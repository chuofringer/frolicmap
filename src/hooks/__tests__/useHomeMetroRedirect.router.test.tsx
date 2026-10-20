import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation, useNavigationType } from 'react-router-dom'
import { useHomeMetroRedirect, METRO_STORAGE_KEY } from '../useHomeMetroRedirect'
import { AppRoute } from '../../AppRoute'

// App itself is huge (map, stores, session); the redirect hook is all that
// matters here, so stand it in with a component that mounts just the hook.
vi.mock('@/App', () => ({
  App: () => {
    useHomeMetroRedirect()
    return <div data-testid="app" />
  },
}))

const Where = () => {
  const loc = useLocation()
  const type = useNavigationType()
  return <div data-testid="where" data-nav={type}>{loc.pathname + loc.search}</div>
}

const mountAt = (path: string, basename?: string) =>
  render(
    <MemoryRouter initialEntries={[path]} basename={basename}>
      <Where />
      <Routes>
        <Route path="/*" element={<AppRoute />} />
      </Routes>
    </MemoryRouter>,
  )

const pathOf = () => screen.getByTestId('where').textContent

const stubWhere = (body: unknown) =>
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => body }))

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('/ with a stored metro (router-level redirect)', () => {
  it('replaces / with the stored city without calling the edge', () => {
    localStorage.setItem(METRO_STORAGE_KEY, 'boston')
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    mountAt('/')
    expect(pathOf()).toBe('/cities/boston')
    expect(screen.getByTestId('where').dataset.nav).toBe('REPLACE')
    expect(f).not.toHaveBeenCalled()
  })

  it('works under the /zh basename without doubling the prefix', () => {
    localStorage.setItem(METRO_STORAGE_KEY, 'boston')
    mountAt('/zh/', '/zh')
    expect(pathOf()).toBe('/cities/boston') // MemoryRouter reports basename-relative paths
  })

  it('leaves deep links and city pages alone', () => {
    localStorage.setItem(METRO_STORAGE_KEY, 'boston')
    window.history.replaceState(null, '', '/?item=abc')
    mountAt('/?item=abc')
    expect(screen.getByTestId('app')).toBeInTheDocument()
    cleanup()
    window.history.replaceState(null, '', '/cities/seattle')
    mountAt('/cities/seattle')
    expect(screen.getByTestId('app')).toBeInTheDocument()
    expect(pathOf()).toBe('/cities/seattle')
  })
})

describe('/ without a stored metro (useHomeMetroRedirect)', () => {
  it('navigates with replace to the metro the edge reports, and stores it', async () => {
    stubWhere({ lat: 47.6, lng: -122.33 })
    mountAt('/')
    expect(screen.getByTestId('app')).toBeInTheDocument()
    await waitFor(() => expect(pathOf()).toBe('/cities/seattle'))
    expect(localStorage.getItem(METRO_STORAGE_KEY)).toBe('seattle')
    expect(screen.getByTestId('where').dataset.nav).toBe('REPLACE')
  })

  it('falls back to /cities when the edge has no match', async () => {
    stubWhere({ lat: null, lng: null })
    mountAt('/')
    await waitFor(() => expect(pathOf()).toBe('/cities'))
  })

  it('does not mutate the browser URL with a full-page navigation', async () => {
    // jsdom location is only touched by history.pushState/replaceState from the
    // router (MemoryRouter never does), so it must still be at '/'.
    stubWhere({ lat: 47.6, lng: -122.33 })
    mountAt('/')
    await waitFor(() => expect(pathOf()).toBe('/cities/seattle'))
    expect(window.location.pathname).toBe('/')
  })
})
