import { describe, it, expect } from 'vitest'
import { ALLOWED_PHOTO_HOSTS, isAllowedPhotoHost, isAllowedPhotoUrl } from '../photoHost'

describe('isAllowedPhotoHost', () => {
  it('accepts every host on the allow-list', () => {
    for (const host of ALLOWED_PHOTO_HOSTS) expect(isAllowedPhotoHost(host)).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isAllowedPhotoHost('Upload.Wikimedia.Org')).toBe(true)
  })

  it('rejects an arbitrary host', () => {
    expect(isAllowedPhotoHost('evil.example')).toBe(false)
  })

  it('does not wildcard subdomains — a lookalike host is rejected', () => {
    expect(isAllowedPhotoHost('upload.wikimedia.org.evil.example')).toBe(false)
    expect(isAllowedPhotoHost('notupload.wikimedia.org')).toBe(false)
  })
})

describe('isAllowedPhotoUrl', () => {
  it('accepts an https URL on an allow-listed host', () => {
    expect(isAllowedPhotoUrl('https://upload.wikimedia.org/wikipedia/commons/a/ab/Some_Park.jpg')).toBe(true)
    expect(isAllowedPhotoUrl('https://commons.wikimedia.org/wiki/File:Some_Park.jpg')).toBe(true)
  })

  it('rejects an https URL on a non-allow-listed host', () => {
    expect(isAllowedPhotoUrl('https://evil.example/tracker.jpg')).toBe(false)
    expect(isAllowedPhotoUrl('https://flickr.com/photo.jpg')).toBe(false)
  })

  it('rejects plain http:// even on an allow-listed host', () => {
    expect(isAllowedPhotoUrl('http://upload.wikimedia.org/x.jpg')).toBe(false)
  })

  it('rejects non-http(s) schemes', () => {
    expect(isAllowedPhotoUrl('javascript:alert(1)')).toBe(false)
    expect(isAllowedPhotoUrl('data:image/png;base64,abcd')).toBe(false)
  })

  it('rejects a malformed/non-URL string without throwing', () => {
    expect(isAllowedPhotoUrl('not a url')).toBe(false)
    expect(isAllowedPhotoUrl('')).toBe(false)
  })
})
