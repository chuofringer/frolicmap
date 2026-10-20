import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, fireEvent, cleanup, act } from '@testing-library/react'
import { useRef, useState } from 'react'
import { useFocusTrap } from '../useFocusTrap'

function Dialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [count, setCount] = useState(0)
  // A fresh arrow function per render, like every real caller.
  useFocusTrap(ref, true, () => onClose())
  return (
    <div ref={ref} tabIndex={-1} data-testid="dialog">
      <button data-testid="first" onClick={() => setCount(count + 1)}>first</button>
      <button data-testid="last">last</button>
    </div>
  )
}

afterEach(cleanup)

describe('useFocusTrap', () => {
  it('focuses the dialog container on open', () => {
    const { getByTestId } = render(<Dialog onClose={() => {}} />)
    expect(document.activeElement).toBe(getByTestId('dialog'))
  })

  it('does not yank focus back to the container when a re-render passes a new onClose', () => {
    const { getByTestId } = render(<Dialog onClose={() => {}} />)
    const first = getByTestId('first')
    act(() => first.focus())
    // Clicking triggers a state update → re-render → new onClose identity.
    fireEvent.click(first)
    expect(document.activeElement).toBe(first)
  })

  it('Shift+Tab from the just-opened container wraps to the LAST focusable instead of escaping', () => {
    const { getByTestId } = render(<Dialog onClose={() => {}} />)
    expect(document.activeElement).toBe(getByTestId('dialog'))
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(getByTestId('last'))
  })

  it('Tab from the last focusable wraps to the first', () => {
    const { getByTestId } = render(<Dialog onClose={() => {}} />)
    act(() => getByTestId('last').focus())
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(getByTestId('first'))
  })

  it('Escape calls the LATEST onClose', () => {
    const early = vi.fn()
    const late = vi.fn()
    const { rerender } = render(<Dialog onClose={early} />)
    rerender(<Dialog onClose={late} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(early).not.toHaveBeenCalled()
    expect(late).toHaveBeenCalledOnce()
  })
})
