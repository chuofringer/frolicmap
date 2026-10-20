import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useFiltersStore } from '@/stores/useFiltersStore'
import { ComingSoonChip } from '../ComingSoonChip'

describe('ComingSoonChip', () => {
  beforeEach(() => {
    useFiltersStore.getState().reset()
  })

  it('renders the Events label and the Coming soon badge', () => {
    render(<ComingSoonChip />)
    expect(screen.getByText('Events')).toBeInTheDocument()
    expect(screen.getByText('Coming soon')).toBeInTheDocument()
  })

  it('is a disabled button with an explanatory title', () => {
    render(<ComingSoonChip />)
    const btn = screen.getByRole('button')
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('aria-disabled', 'true')
    expect(btn).toHaveAttribute('title', 'Events are coming soon — for now frolicmap maps places only.')
  })

  it('does not change the category filter when clicked', () => {
    const before = useFiltersStore.getState().categories
    render(<ComingSoonChip variant="inline" />)
    fireEvent.click(screen.getByRole('button'))
    expect(useFiltersStore.getState().categories).toBe(before)
  })
})
