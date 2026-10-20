import { describe, it, expect } from 'vitest'
import { isHttpUrl } from '../url'

describe('isHttpUrl', () => {
  it('accepts https and http URLs', () => {
    expect(isHttpUrl('https://example.org/park')).toBe(true)
    expect(isHttpUrl('http://example.org')).toBe(true)
    expect(isHttpUrl('HTTPS://EXAMPLE.ORG')).toBe(true)
  })

  it('rejects script, data, phone, mail and file schemes', () => {
    expect(isHttpUrl('javascript:alert(1)')).toBe(false)
    expect(isHttpUrl('  JavaScript:alert(1)')).toBe(false)
    expect(isHttpUrl('data:text/html,<script>alert(1)</script>')).toBe(false)
    expect(isHttpUrl('tel:+15551234567')).toBe(false)
    expect(isHttpUrl('mailto:a@b.org')).toBe(false)
    expect(isHttpUrl('file:///etc/passwd')).toBe(false)
  })

  it('rejects bare text, empty and non-string input', () => {
    expect(isHttpUrl('example.org')).toBe(false)
    expect(isHttpUrl('not a url')).toBe(false)
    expect(isHttpUrl('')).toBe(false)
    expect(isHttpUrl('   ')).toBe(false)
    expect(isHttpUrl(null)).toBe(false)
    expect(isHttpUrl(undefined)).toBe(false)
    expect(isHttpUrl(42)).toBe(false)
  })
})
