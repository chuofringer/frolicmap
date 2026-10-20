import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { FAQOverlay } from '../FAQOverlay'
// The FAQ renders unchanged in every published metro, so no answer may
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

describe('FAQOverlay copy', () => {
  it('names the metro the map is showing', () => {
    renderAt('/cities/seattle')
    expect(screen.getByRole('button', { name: /What is frolicmap\?/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /What is frolicmap\?/ }))
    expect(screen.getByText(/currently showing Seattle/)).toBeInTheDocument()
  })

  it('still names the Bay Area on the Bay map', () => {
    renderAt('/')
    fireEvent.click(screen.getByRole('button', { name: /What is frolicmap\?/ }))
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

describe('FAQOverlay content', () => {
  it('has no account, newsletter, affiliate, coffee or AI-extraction copy', () => {
    renderAt('/')
    const text = allAnswers()
    expect(text).not.toMatch(/sign in|signing in|account section|delete account|newsletter signup|affiliate|coffee/i)
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete account' })).toBeNull()
  })

  it('shows the frolicmap contact email', () => {
    renderAt('/')
    expect(screen.getByText('frolicmap.official@gmail.com')).toBeInTheDocument()
  })
})
