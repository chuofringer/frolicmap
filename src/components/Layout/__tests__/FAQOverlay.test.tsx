import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { FAQOverlay } from '../FAQOverlay'
import { useAuthStore } from '@/stores/useAuthStore'
import { deleteAccount } from '@/api/auth'

vi.mock('@/api/auth', () => ({ deleteAccount: vi.fn() }))
const deleteAccountMock = vi.mocked(deleteAccount)

// #420: the FAQ renders unchanged in all 15 published metros, so no answer may
// state a Bay-Area-only fact. The guard is a text sweep rather than per-string
// assertions — a new answer that mentions the Bay Area fails here without
// anyone remembering to extend the test.

const renderAt = (path: string) =>
  render(<FAQOverlay onClose={() => {}} />, {
    wrapper: ({ children }) => <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>,
  })

/**
 * Every answer's text. The accordion is single-open, so each question is
 * opened, read, and closed again — expanding them all at once would leave
 * only the last one on screen.
 */
const allAnswers = (): string => {
  const dialog = document.querySelector('[role="dialog"]')!
  let text = ''
  for (const q of screen.getAllByRole('button', { expanded: false })) {
    fireEvent.click(q)
    text += `${dialog.textContent ?? ''}\n`
    fireEvent.click(q)
  }
  return text
}

afterEach(() => cleanup())

describe('FAQOverlay copy (#420)', () => {
  it('names the metro the map is showing', () => {
    renderAt('/cities/seattle')
    expect(screen.getByRole('button', { name: /What is funradar.app/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /What is funradar.app/ }))
    expect(screen.getByText(/currently showing Seattle/)).toBeInTheDocument()
  })

  it('still names the Bay Area on the Bay map', () => {
    renderAt('/')
    fireEvent.click(screen.getByRole('button', { name: /What is funradar.app/ }))
    expect(screen.getByText(/currently showing SF Bay Area/)).toBeInTheDocument()
  })

  it('makes no Bay-Area claim on a national metro', () => {
    renderAt('/cities/seattle')
    const text = allAnswers()
    // Proof the sweep is reading expanded answers, not just the questions.
    expect(text).toMatch(/typical city traffic/)
    expect(text).not.toMatch(/Bay Area|San Francisco/)
  })
})

// #535: the FAQ is the only signed-in surface a parent can find again, so it
// carries sign-out and the self-serve deletion behind the privacy policy's §12
// right. Guests must never see any of it.
describe('FAQOverlay account section (#535)', () => {
  beforeEach(() => {
    deleteAccountMock.mockReset()
    deleteAccountMock.mockResolvedValue({ ok: true })
    useAuthStore.getState().signOut()
  })

  const signIn = () => useAuthStore.getState().signIn('cred-abc', 'parent@example.com')

  it('renders nothing for a guest', () => {
    renderAt('/')
    expect(screen.queryByText('Account')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete account' })).toBeNull()
  })

  it('shows the account block with the signed-in address', () => {
    signIn()
    renderAt('/')
    expect(screen.getByText('Account')).toBeInTheDocument()
    expect(screen.getByText('Signed in as parent@example.com')).toBeInTheDocument()
  })

  it('signs out client-side without calling the delete endpoint', async () => {
    signIn()
    renderAt('/')
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(useAuthStore.getState().signedIn).toBe(false)
    expect(useAuthStore.getState().credential).toBeNull()
    expect(localStorage.getItem('funradar:member')).toBeNull()
    expect(deleteAccountMock).not.toHaveBeenCalled()
    expect(screen.queryByText('Account')).toBeNull()
  })

  it('requires the inline confirm before deleting — the first tap only asks', async () => {
    signIn()
    renderAt('/')
    await userEvent.click(screen.getByRole('button', { name: 'Delete account' }))

    expect(screen.getByText(/This deletes your account and any newsletter subscription/)).toBeInTheDocument()
    expect(deleteAccountMock).not.toHaveBeenCalled()
    expect(useAuthStore.getState().signedIn).toBe(true)
  })

  it('cancel backs out and leaves the account alone', async () => {
    signIn()
    renderAt('/')
    await userEvent.click(screen.getByRole('button', { name: 'Delete account' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByRole('button', { name: 'Delete account' })).toBeInTheDocument()
    expect(deleteAccountMock).not.toHaveBeenCalled()
    expect(useAuthStore.getState().signedIn).toBe(true)
  })

  it('confirming deletes the account and clears the local credential', async () => {
    signIn()
    renderAt('/')
    await userEvent.click(screen.getByRole('button', { name: 'Delete account' }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(deleteAccountMock).toHaveBeenCalledWith('cred-abc')
    expect(useAuthStore.getState().signedIn).toBe(false)
    expect(useAuthStore.getState().credential).toBeNull()
    expect(localStorage.getItem('funradar:member')).toBeNull()
    // The block unmounts with the sign-out.
    expect(screen.queryByText('Account')).toBeNull()
  })

  it('keeps the visitor signed in and shows an error when deletion fails', async () => {
    deleteAccountMock.mockRejectedValueOnce(new Error('rate limit exceeded'))
    signIn()
    renderAt('/')
    await userEvent.click(screen.getByRole('button', { name: 'Delete account' }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/didn’t work/)
    expect(useAuthStore.getState().signedIn).toBe(true)
  })
})
