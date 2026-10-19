import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { Item } from '@shared/types'

// The admin edit/approve/reject mutations are stubbed; this suite only
// exercises the photo fields added for #299 ("Add pictures for locations").
const getItem = vi.fn()
const edit = vi.fn()
vi.mock('@/api/admin', () => ({
  adminApi: {
    getItem: (...a: unknown[]) => getItem(...a),
    edit: (...a: unknown[]) => edit(...a),
    approve: vi.fn(),
    reject: vi.fn(),
  },
}))

import { ItemEditor } from '../ItemEditor'

const ITEM: Partial<Item> = {
  id: 'x',
  type: 'place',
  name: 'Dolores Park',
  category: 'park',
  lat: 37.7,
  lng: -122.4,
  source_url: 'https://x',
  source_type: 'osm',
  confidence: 'high',
  status: 'pending',
  last_verified: '2026-09-06T00:00:00Z',
  created_at: '2026-09-06T00:00:00Z',
  updated_at: '2026-09-06T00:00:00Z',
  region: 'bay',
  indoor: 0,
  photo_url: null,
  photo_attribution: null,
}

const renderEditor = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/admin/items/x']}>
        <Routes>
          <Route path="/admin/items/:id" element={<ItemEditor />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  getItem.mockReset()
  getItem.mockResolvedValue({ item: ITEM })
  edit.mockReset()
})
afterEach(() => cleanup())

describe('ItemEditor photo fields (#299)', () => {
  it('renders the Photo URL and attribution fields with no Clear button when empty', async () => {
    renderEditor()
    await waitFor(() => expect(screen.getByText('Dolores Park')).toBeInTheDocument())
    expect(screen.getByPlaceholderText(/upload\.wikimedia\.org/)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Wikimedia Commons/)).toBeInTheDocument()
    expect(screen.getByText(/Required for Wikimedia Commons/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull()
  })

  it('shows a validation error for a non-https URL and disables Save', async () => {
    renderEditor()
    await waitFor(() => expect(screen.getByText('Dolores Park')).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText(/upload\.wikimedia\.org/), {
      target: { value: 'http://example.com/x.jpg' },
    })
    expect(screen.getByText(/must be an https:\/\/ URL/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save & Approve' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save (keep pending)' })).toBeDisabled()
  })

  it('rejects a javascript: URL the same way', async () => {
    renderEditor()
    await waitFor(() => expect(screen.getByText('Dolores Park')).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText(/upload\.wikimedia\.org/), {
      target: { value: 'javascript:alert(1)' },
    })
    expect(screen.getByText(/must be an https:\/\/ URL/)).toBeInTheDocument()
  })

  it('rejects an https URL on a non-allow-listed host (host allow-list, not just scheme)', async () => {
    renderEditor()
    await waitFor(() => expect(screen.getByText('Dolores Park')).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText(/upload\.wikimedia\.org/), {
      target: { value: 'https://evil.example/tracker.jpg' },
    })
    expect(screen.getByText(/must be an https:\/\/ URL/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save & Approve' })).toBeDisabled()
  })

  it('shows a live preview thumbnail for a valid https URL, no error, Save enabled', async () => {
    const { container } = renderEditor()
    await waitFor(() => expect(screen.getByText('Dolores Park')).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText(/upload\.wikimedia\.org/), {
      target: { value: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Some_Park.jpg' },
    })
    expect(screen.queryByText(/must be an https:\/\/ URL/)).toBeNull()
    const img = container.querySelector('img[loading="lazy"]')
    expect(img).not.toBeNull()
    expect(img).toHaveAttribute('src', 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Some_Park.jpg')
    expect(screen.getByRole('button', { name: 'Save & Approve' })).not.toBeDisabled()
  })

  it('replaces the thumbnail with "Image failed to load" on an onError', async () => {
    const { container } = renderEditor()
    await waitFor(() => expect(screen.getByText('Dolores Park')).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText(/upload\.wikimedia\.org/), {
      target: { value: 'https://upload.wikimedia.org/broken.jpg' },
    })
    const img = container.querySelector('img[loading="lazy"]')!
    fireEvent.error(img)
    expect(screen.getByText('Image failed to load')).toBeInTheDocument()
    expect(container.querySelector('img[loading="lazy"]')).toBeNull()
  })

  it('a Clear button appears once a photo URL is set and blanks both fields', async () => {
    renderEditor()
    await waitFor(() => expect(screen.getByText('Dolores Park')).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText(/upload\.wikimedia\.org/), {
      target: { value: 'https://upload.wikimedia.org/x.jpg' },
    })
    fireEvent.change(screen.getByPlaceholderText(/Wikimedia Commons/), {
      target: { value: 'Jane Doe / Wikimedia Commons (CC BY-SA 4.0)' },
    })
    const clearBtn = screen.getByRole('button', { name: 'Clear' })
    fireEvent.click(clearBtn)
    expect(screen.getByPlaceholderText(/upload\.wikimedia\.org/)).toHaveValue('')
    expect(screen.getByPlaceholderText(/Wikimedia Commons/)).toHaveValue('')
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull()
  })

  it('sends the photo fields on Save', async () => {
    edit.mockResolvedValue({ item: ITEM })
    renderEditor()
    await waitFor(() => expect(screen.getByText('Dolores Park')).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText(/upload\.wikimedia\.org/), {
      target: { value: 'https://upload.wikimedia.org/x.jpg' },
    })
    fireEvent.change(screen.getByPlaceholderText(/Wikimedia Commons/), {
      target: { value: 'Jane Doe / Wikimedia Commons (CC BY-SA 4.0)' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save (keep pending)' }))
    await waitFor(() =>
      expect(edit).toHaveBeenCalledWith(
        'x',
        expect.objectContaining({
          photo_url: 'https://upload.wikimedia.org/x.jpg',
          photo_attribution: 'Jane Doe / Wikimedia Commons (CC BY-SA 4.0)',
        }),
      ),
    )
  })
})
