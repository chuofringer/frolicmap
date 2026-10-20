import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { useMetroDocumentTitle } from '../useMetroDocumentTitle'

const mount = (path: string) =>
  renderHook(
    () => {
      useMetroDocumentTitle()
      return useNavigate()
    },
    { wrapper: ({ children }) => <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter> },
  )

beforeEach(() => { document.title = '' })

describe('useMetroDocumentTitle', () => {
  it('names the city on a city page', () => {
    mount('/cities/seattle')
    expect(document.title).toBe('Things to Do With Kids in Seattle | frolicmap')
  })

  it('follows an in-app switch', () => {
    const { result } = mount('/cities/seattle')
    act(() => result.current('/cities/chicago'))
    expect(document.title).toBe('Things to Do With Kids in Chicago | frolicmap')
  })

  it('uses the generic map title off city pages and for unknown or unpublished slugs', () => {
    const generic = 'Things to Do With Kids Near You | frolicmap'
    mount('/')
    expect(document.title).toBe(generic)
    mount('/cities/atlantis')
    expect(document.title).toBe(generic)
    mount('/cities/detroit')
    expect(document.title).toBe(generic)
  })
})
