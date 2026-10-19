import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'

// Capture the options every listItems call receives so we can assert what the
// queue actually requests on open. The other admin endpoints are stubbed.
const listItems = vi.fn()
const approve = vi.fn()
vi.mock('@/api/admin', () => ({
  adminApi: {
    listItems: (...a: unknown[]) => listItems(...a),
    approve: (...a: unknown[]) => approve(...a), reject: vi.fn(),
  },
}))

import { PendingQueue } from '../PendingQueue'

// All pending rows are national museums — 'bay' is NOT among the region
// facets, exactly the production state that exposed the bug.
const RESPONSE = {
  items: [],
  total: 28,
  limit: 100,
  offset: 0,
  facets: {
    regions: [{ value: 'atlanta', n: 4 }, { value: 'new-york', n: 5 }],
    sourceTypes: [{ value: 'imls', n: 28 }],
  },
}

const renderQueue = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><PendingQueue /></MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => { listItems.mockReset(); listItems.mockResolvedValue(RESPONSE); approve.mockReset() })
afterEach(() => cleanup())

describe('PendingQueue region filter', () => {
  it('requests ALL regions on open — no phantom bay filter', async () => {
    // The bug: defaulting region to 'bay' sent region=bay while the dropdown
    // displayed "All regions", so the entire national pending queue showed
    // nothing. On open the request must carry no region.
    renderQueue()
    await waitFor(() => expect(listItems).toHaveBeenCalled())
    const opts = listItems.mock.calls[0][1]
    expect(opts.region).toBeUndefined()
  })

  it('renders the region select on "All regions" and lists the facet regions', async () => {
    renderQueue()
    await waitFor(() => expect(screen.getByRole('combobox', { name: /region/i })).toBeInTheDocument())
    const select = screen.getByRole('combobox', { name: /region/i }) as HTMLSelectElement
    // The controlled value is '' (All regions) and that option exists, so the
    // select's value matches an option — no silent fallback mismatch.
    expect(select.value).toBe('')
    expect(screen.getByRole('option', { name: /All regions/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /atlanta/ })).toBeInTheDocument()
  })
})

describe('PendingQueue bulk approve', () => {
  const ITEM = {
    id: 'x', type: 'place', name: 'X', category: 'park', lat: 37.7, lng: -122.4,
    source_url: 'https://x', source_type: 'imls', confidence: 'medium', status: 'pending',
    last_verified: '2026-09-06T00:00:00Z', created_at: '2026-09-06T00:00:00Z', updated_at: '2026-09-06T00:00:00Z',
    region: 'atlanta', indoor: 0,
  }

  it('has no server-side approve-all button (approve-all was removed)', async () => {
    listItems.mockResolvedValue({ ...RESPONSE, items: [ITEM], total: 21220 })
    renderQueue()
    await screen.findByRole('button', { name: /Approve this page \(1\)/ })
    expect(screen.queryByRole('button', { name: /Approve all/ })).toBeNull()
  })

  it('approves the visible page one item at a time after confirmation', async () => {
    listItems.mockResolvedValue({ ...RESPONSE, items: [ITEM], total: 1 })
    approve.mockResolvedValue({ ok: true })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderQueue()
    const btn = await screen.findByRole('button', { name: /Approve this page \(1\)/ })
    btn.click()
    await waitFor(() => expect(approve).toHaveBeenCalledWith('x'))
    confirm.mockRestore()
  })

  it('does nothing when the confirm is declined', async () => {
    listItems.mockResolvedValue({ ...RESPONSE, items: [ITEM], total: 1 })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderQueue()
    const btn = await screen.findByRole('button', { name: /Approve this page \(1\)/ })
    btn.click()
    expect(approve).not.toHaveBeenCalled()
    confirm.mockRestore()
  })
})
