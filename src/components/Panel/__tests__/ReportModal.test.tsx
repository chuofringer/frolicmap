import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReportModal } from '../ReportModal'
import { useSessionStore } from '@/stores/useSessionStore'

// /api/report is session-gated on the worker; the modal must attach the
// Authorization header or every report silently 401s.

const fetchSpy = vi.fn(async () => new Response('{"ok":true}', { status: 200 }))

beforeEach(() => {
  vi.stubGlobal('fetch', fetchSpy)
  fetchSpy.mockClear()
  useSessionStore.getState().clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ReportModal', () => {
  it('POSTs the report with the session token attached', async () => {
    useSessionStore.getState().setSession('test-token-abc', 300)
    render(<ReportModal itemId="item-1" onClose={() => {}} />)

    await userEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/api/report')
    const headers = init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer test-token-abc')
    const body = JSON.parse(init.body as string) as { item_id: string; reason: string }
    expect(body.item_id).toBe('item-1')
    expect(body.reason).toBe('closed')
    expect(await screen.findByText(/Thanks/)).toBeTruthy()
  })

  it('still shows the thanks card when no token exists (best-effort post)', async () => {
    render(<ReportModal itemId="item-1" onClose={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>).authorization).toBeUndefined()
    expect(await screen.findByText(/Thanks/)).toBeTruthy()
  })

  it('closes on Escape (previously had no keyboard escape at all)', () => {
    const onClose = vi.fn()
    render(<ReportModal itemId="item-1" onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('is a labelled dialog', () => {
    render(<ReportModal itemId="item-1" onClose={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Report a problem' })).toBeInTheDocument()
  })

  it('wraps Tab from the last focusable element back to the first, instead of walking out behind the modal', async () => {
    const user = userEvent.setup()
    render(<ReportModal itemId="item-1" onClose={() => {}} />)
    const dialog = screen.getByRole('dialog')
    const focusable = dialog.querySelectorAll('button:not([disabled]), select, textarea')
    const first = focusable[0] as HTMLElement
    const last = focusable[focusable.length - 1] as HTMLElement
    last.focus()
    expect(document.activeElement).toBe(last)
    await user.tab()
    expect(document.activeElement).toBe(first)
  })
})
