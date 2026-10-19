import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { FiltersDrawer } from '../FiltersDrawer'

// Mock useItems — FiltersDrawer only reads it to decide whether to show the
// U-Pick section header; we don't want real network in this test.
vi.mock('@/hooks/useItems', () => ({
  useItems: vi.fn(() => ({ data: { items: [] } })),
}))

function renderDrawer(onClose: () => void = () => {}) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <FiltersDrawer onClose={onClose} />
    </MemoryRouter>,
  )
}

describe('FiltersDrawer', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('is a labelled dialog', () => {
    renderDrawer()
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeInTheDocument()
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    renderDrawer(onClose)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('wraps Tab from the last focusable element back to the first, instead of walking out to the map behind it', async () => {
    const user = userEvent.setup()
    renderDrawer()
    const dialog = screen.getByRole('dialog')
    const focusable = dialog.querySelectorAll('a[href], button:not([disabled]), input:not([disabled])')
    expect(focusable.length).toBeGreaterThan(1)
    const first = focusable[0] as HTMLElement
    const last = focusable[focusable.length - 1] as HTMLElement
    last.focus()
    expect(document.activeElement).toBe(last)
    await user.tab()
    expect(document.activeElement).toBe(first)
  })

  it('wraps Shift+Tab from the first focusable element back to the last', async () => {
    const user = userEvent.setup()
    renderDrawer()
    const dialog = screen.getByRole('dialog')
    const focusable = dialog.querySelectorAll('a[href], button:not([disabled]), input:not([disabled])')
    const first = focusable[0] as HTMLElement
    const last = focusable[focusable.length - 1] as HTMLElement
    first.focus()
    expect(document.activeElement).toBe(first)
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(last)
  })
})
