import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Tile, SectionCard, BarRow, EmptyState, StatusBadge } from '../ui'

afterEach(() => cleanup())

describe('admin ui primitives', () => {
  it('Tile renders a label and formats a numeric value with separators', () => {
    render(<Tile label="Total" value={1234} />)
    expect(screen.getByText('Total')).toBeInTheDocument()
    expect(screen.getByText('1,234')).toBeInTheDocument()
  })

  it('Tile passes a non-numeric value through untouched', () => {
    render(<Tile label="State" value="—" />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('SectionCard renders its title, hint, and children', () => {
    render(
      <SectionCard title="By metro" hint="demand">
        <p>body</p>
      </SectionCard>,
    )
    expect(screen.getByText('By metro')).toBeInTheDocument()
    expect(screen.getByText('demand')).toBeInTheDocument()
    expect(screen.getByText('body')).toBeInTheDocument()
  })

  it('BarRow shows the label and the formatted value, and clamps bar width to >= 2%', () => {
    render(<BarRow label="Seattle" value={0} max={100} color="#4f46e5" />)
    expect(screen.getByText('Seattle')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
    // Even a zero value keeps a sliver of bar (min 2%) so the row is visible.
    const bar = document.querySelector('[style*="width"]') as HTMLElement
    expect(bar.style.width).toBe('2%')
  })

  it('BarRow scales width proportionally to max', () => {
    render(<BarRow label="X" value={50} max={100} color="#000" />)
    const bar = document.querySelector('[style*="width"]') as HTMLElement
    expect(bar.style.width).toBe('50%')
  })

  it('EmptyState renders inline text and the padded boxed variant', () => {
    const { rerender } = render(<EmptyState>nothing here</EmptyState>)
    expect(screen.getByText('nothing here')).toBeInTheDocument()
    rerender(<EmptyState padded>boxed empty</EmptyState>)
    expect(screen.getByText('boxed empty')).toBeInTheDocument()
  })

  it('StatusBadge renders its label for each tone', () => {
    for (const tone of ['green', 'amber', 'red', 'gray'] as const) {
      const { unmount } = render(<StatusBadge tone={tone}>{tone}</StatusBadge>)
      expect(screen.getByText(tone)).toBeInTheDocument()
      unmount()
    }
  })
})
