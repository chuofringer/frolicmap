import { describe, it, expect } from 'vitest'
import { parsePhotoCredit, splitLicence } from '../photoCredit'

const FILE = 'https://commons.wikimedia.org/wiki/File:Some_Park.jpg'
const LIC = 'https://creativecommons.org/licenses/by-sa/4.0/'

describe('parsePhotoCredit', () => {
  it('reads the old plain form as text only', () => {
    expect(parsePhotoCredit('Jane Doe / Wikimedia Commons (CC BY-SA 4.0)')).toEqual({
      text: 'Jane Doe / Wikimedia Commons (CC BY-SA 4.0)',
    })
  })

  it('reads the new form with file page and licence URLs', () => {
    expect(parsePhotoCredit(`Jane Doe / Wikimedia Commons (CC BY-SA 4.0) | ${FILE} | ${LIC}`)).toEqual({
      text: 'Jane Doe / Wikimedia Commons (CC BY-SA 4.0)',
      sourceUrl: FILE,
      licenceUrl: LIC,
    })
  })

  it('accepts either URL alone, in either order', () => {
    expect(parsePhotoCredit(`Wikimedia Commons | ${FILE}`)).toEqual({ text: 'Wikimedia Commons', sourceUrl: FILE })
    expect(parsePhotoCredit(`Wikimedia Commons | ${LIC}`)).toEqual({ text: 'Wikimedia Commons', licenceUrl: LIC })
    expect(parsePhotoCredit(`Wikimedia Commons | ${LIC} | ${FILE}`)).toEqual({
      text: 'Wikimedia Commons', sourceUrl: FILE, licenceUrl: LIC,
    })
  })

  it('keeps a " | " inside the artist name in the text', () => {
    expect(parsePhotoCredit(`A | B / Wikimedia Commons | ${FILE}`)).toEqual({
      text: 'A | B / Wikimedia Commons',
      sourceUrl: FILE,
    })
  })

  it('never links a URL on a host that is neither a photo host nor a licence host', () => {
    const r = parsePhotoCredit('X / Wikimedia Commons | https://evil.example.com/File:A.jpg')
    expect(r).toEqual({ text: 'X / Wikimedia Commons' })
  })

  it('drops non-https and script URLs instead of showing or linking them', () => {
    expect(parsePhotoCredit('X | http://creativecommons.org/licenses/by/4.0/')).toEqual({ text: 'X' })
    expect(parsePhotoCredit('X | javascript:alert(1)')).toEqual({ text: 'X' })
    expect(parsePhotoCredit(`X | data://text/html,hi | ${FILE}`)).toEqual({ text: 'X', sourceUrl: FILE })
  })

  it('tolerates malformed input', () => {
    expect(parsePhotoCredit('')).toEqual({ text: '' })
    expect(parsePhotoCredit('X | not a url')).toEqual({ text: 'X | not a url' })
    expect(parsePhotoCredit('X | https://')).toEqual({ text: 'X' })
    expect(parsePhotoCredit(`${FILE}`)).toEqual({ text: FILE })
  })
})

describe('splitLicence', () => {
  it('splits a trailing parenthetical', () => {
    expect(splitLicence('Jane / Wikimedia Commons (CC BY-SA 4.0)')).toEqual({
      before: 'Jane / Wikimedia Commons', licence: 'CC BY-SA 4.0',
    })
  })
  it('returns null licence when absent', () => {
    expect(splitLicence('Wikimedia Commons')).toEqual({ before: 'Wikimedia Commons', licence: null })
  })
})
