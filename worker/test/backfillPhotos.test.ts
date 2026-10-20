import { describe, it, expect } from 'vitest'
import {
  parseOsmItemId, buildOverpassTagsQuery, resolveCommonsTitle, commonsImageInfoUrl,
  stripHtml, parseCommonsPage, buildPhotoUpdateStatement, isImageContentType,
  assertInputRows, chunk, parseAttributesPhotoCandidate, buildGuardedPhotoUpdate,
  // @ts-expect-error — plain-JS script lib, no type declarations by design.
} from '../scripts/lib/backfillPhotos.mjs'

describe('parseOsmItemId', () => {
  it('parses node/way/relation ids', () => {
    expect(parseOsmItemId('osm-node-123')).toEqual({ type: 'node', id: 123 })
    expect(parseOsmItemId('osm-way-456')).toEqual({ type: 'way', id: 456 })
    expect(parseOsmItemId('osm-relation-789')).toEqual({ type: 'relation', id: 789 })
  })

  it('returns null for non-OSM id shapes', () => {
    expect(parseOsmItemId('aggregator-bakf-foo')).toBeNull()
    expect(parseOsmItemId('osm-bogus-1')).toBeNull()
    expect(parseOsmItemId('')).toBeNull()
    expect(parseOsmItemId(null)).toBeNull()
  })
})

describe('buildOverpassTagsQuery', () => {
  it('groups elements by type into one query', () => {
    const q = buildOverpassTagsQuery([
      { type: 'node', id: 1 }, { type: 'node', id: 2 }, { type: 'way', id: 3 },
    ])
    expect(q).toContain('node(id:1,2);')
    expect(q).toContain('way(id:3);')
    expect(q).toContain('out tags;')
  })

  it('returns null for an empty list', () => {
    expect(buildOverpassTagsQuery([])).toBeNull()
  })

  it('omits a type clause entirely when no elements of that type', () => {
    const q = buildOverpassTagsQuery([{ type: 'node', id: 1 }])
    expect(q).not.toContain('way(')
    expect(q).not.toContain('relation(')
  })
})

describe('resolveCommonsTitle', () => {
  it('accepts a wikimedia_commons File: tag directly', () => {
    expect(resolveCommonsTitle({ wikimedia_commons: 'File:Some Park.jpg' }))
      .toEqual({ title: 'File:Some Park.jpg', tagUsed: 'wikimedia_commons' })
  })

  it('skips a wikimedia_commons Category: tag as ambiguous', () => {
    const r = resolveCommonsTitle({ wikimedia_commons: 'Category:Some Park' })
    expect(r.skip).toMatch(/Category/)
  })

  it('skips an unrecognized wikimedia_commons value', () => {
    const r = resolveCommonsTitle({ wikimedia_commons: 'garbage' })
    expect(r.skip).toBeTruthy()
  })

  it('resolves an image= Commons file-page URL', () => {
    const r = resolveCommonsTitle({ image: 'https://commons.wikimedia.org/wiki/File:Some_Park.jpg' })
    expect(r).toEqual({ title: 'File:Some_Park.jpg', tagUsed: 'image' })
  })

  it('resolves an image= raw upload.wikimedia.org URL', () => {
    const r = resolveCommonsTitle({ image: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Some_Park.jpg' })
    expect(r).toEqual({ title: 'File:Some_Park.jpg', tagUsed: 'image' })
  })

  it('skips an image= tag pointing at a non-Commons host — not a license-safe source', () => {
    const r = resolveCommonsTitle({ image: 'https://example.com/photo.jpg' })
    expect(r.skip).toMatch(/not a Wikimedia Commons URL/)
  })

  it('prefers wikimedia_commons over image when both are present', () => {
    const r = resolveCommonsTitle({
      wikimedia_commons: 'File:A.jpg',
      image: 'https://commons.wikimedia.org/wiki/File:B.jpg',
    })
    expect(r.title).toBe('File:A.jpg')
  })

  it('returns null when neither tag is present', () => {
    expect(resolveCommonsTitle({ name: 'Some Park' })).toBeNull()
    expect(resolveCommonsTitle(null)).toBeNull()
  })
})

describe('commonsImageInfoUrl', () => {
  it('builds a Commons API URL requesting url + extmetadata', () => {
    const url = commonsImageInfoUrl('File:Some Park.jpg')
    expect(url).toContain('commons.wikimedia.org/w/api.php')
    expect(url).toContain('action=query')
    expect(url).toContain('titles=File%3ASome+Park.jpg')
    expect(url).toContain('iiprop=url%7Cextmetadata')
  })
})

describe('stripHtml', () => {
  it('strips tags and decodes common entities', () => {
    expect(stripHtml('<a href="x">Jane &amp; Doe</a>')).toBe('Jane & Doe')
  })

  it('collapses whitespace and trims', () => {
    expect(stripHtml('  A   B  ')).toBe('A B')
  })

  it('returns empty string for non-strings', () => {
    expect(stripHtml(null)).toBe('')
    expect(stripHtml(undefined)).toBe('')
  })
})

describe('parseCommonsPage', () => {
  it('builds attribution from artist + license', () => {
    const page = {
      imageinfo: [{
        url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Photo.jpg',
        extmetadata: {
          Artist: { value: '<a href="//example.com">Jane Doe</a>' },
          LicenseShortName: { value: 'CC BY-SA 4.0' },
        },
      }],
    }
    expect(parseCommonsPage(page)).toEqual({
      url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Photo.jpg',
      attribution: 'Jane Doe / Wikimedia Commons (CC BY-SA 4.0)',
    })
  })

  it('appends the Commons file-page URL and licence URL as a parseable suffix (issue #18)', () => {
    const page = {
      title: 'File:Some Park.jpg',
      imageinfo: [{
        url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Some_Park.jpg',
        descriptionurl: 'https://commons.wikimedia.org/wiki/File:Some_Park.jpg',
        extmetadata: {
          Artist: { value: 'Jane Doe' },
          LicenseShortName: { value: 'CC BY-SA 4.0' },
          LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' },
        },
      }],
    }
    expect(parseCommonsPage(page)?.attribution).toBe(
      'Jane Doe / Wikimedia Commons (CC BY-SA 4.0)' +
      ' | https://commons.wikimedia.org/wiki/File:Some_Park.jpg' +
      ' | https://creativecommons.org/licenses/by-sa/4.0',
    )
  })

  it('derives the file page from the page title when descriptionurl is absent', () => {
    const page = {
      title: 'File:Some Park.jpg',
      imageinfo: [{ url: 'https://x/y.jpg', extmetadata: { LicenseShortName: { value: 'Public domain' } } }],
    }
    expect(parseCommonsPage(page)?.attribution).toBe(
      'Wikimedia Commons (Public domain) | https://commons.wikimedia.org/wiki/File:Some_Park.jpg',
    )
  })

  it('drops non-https, off-Commons, or whitespace-bearing URLs rather than storing them', () => {
    const page = {
      title: 'Not a file',
      imageinfo: [{
        url: 'https://x/y.jpg',
        descriptionurl: 'https://evil.example.com/wiki/File:A.jpg',
        extmetadata: { Artist: { value: 'J. Doe' }, LicenseUrl: { value: 'http://creativecommons.org/licenses/by/4.0/' } },
      }],
    }
    expect(parseCommonsPage(page)?.attribution).toBe('J. Doe / Wikimedia Commons')
  })

  it('falls back gracefully when artist or license is missing — never fabricates one', () => {
    const noArtist = { imageinfo: [{ url: 'https://x/y.jpg', extmetadata: { LicenseShortName: { value: 'Public domain' } } }] }
    expect(parseCommonsPage(noArtist)?.attribution).toBe('Wikimedia Commons (Public domain)')

    const noLicense = { imageinfo: [{ url: 'https://x/y.jpg', extmetadata: { Artist: { value: 'J. Doe' } } }] }
    expect(parseCommonsPage(noLicense)?.attribution).toBe('J. Doe / Wikimedia Commons')

    const neither = { imageinfo: [{ url: 'https://x/y.jpg', extmetadata: {} }] }
    expect(parseCommonsPage(neither)?.attribution).toBe('Wikimedia Commons')
  })

  it('returns null for a missing/redlink page', () => {
    expect(parseCommonsPage({ missing: true })).toBeNull()
  })

  it('returns null when there is no imageinfo', () => {
    expect(parseCommonsPage({})).toBeNull()
    expect(parseCommonsPage({ imageinfo: [] })).toBeNull()
  })

  it('returns null when imageinfo has no url', () => {
    expect(parseCommonsPage({ imageinfo: [{ extmetadata: {} }] })).toBeNull()
  })
})

describe('buildPhotoUpdateStatement', () => {
  it('emits an idempotent UPDATE touching only photo_url/photo_attribution/updated_at', () => {
    const sql = buildPhotoUpdateStatement(
      'osm-node-42', 'https://upload.wikimedia.org/x/y.jpg', 'Jane Doe / Wikimedia Commons (CC BY-SA 4.0)',
      '2026-08-22T00:00:00.000Z',
    )
    expect(sql).toBe(
      "UPDATE items SET photo_url='https://upload.wikimedia.org/x/y.jpg', " +
      "photo_attribution='Jane Doe / Wikimedia Commons (CC BY-SA 4.0)', " +
      "updated_at='2026-08-22T00:00:00.000Z' WHERE id='osm-node-42' AND photo_url IS NULL;",
    )
  })

  it('carries the idempotent WHERE guard', () => {
    expect(buildPhotoUpdateStatement('id-1', 'X', 'Y', 'T')).toContain('AND photo_url IS NULL')
  })

  it('escapes single quotes in the attribution and id', () => {
    const sql = buildPhotoUpdateStatement("weird'id", 'https://x/y.jpg', "O'Brien", 'T')
    expect(sql).toContain("photo_attribution='O''Brien'")
    expect(sql).toContain("WHERE id='weird''id'")
  })
})

describe('buildGuardedPhotoUpdate (isAllowedPhotoUrl gate)', () => {
  it('builds the UPDATE for an https Wikimedia URL', () => {
    const r = buildGuardedPhotoUpdate('osm-node-1', 'https://upload.wikimedia.org/wikipedia/commons/a/ab/P.jpg', 'A / Wikimedia Commons', 'T')
    expect(r.skip).toBeUndefined()
    expect(r.statement).toContain("UPDATE items SET photo_url='https://upload.wikimedia.org/wikipedia/commons/a/ab/P.jpg'")
  })

  it('skips (with a reason, no statement) for a non-allow-listed host, http, or non-URL', () => {
    for (const url of ['https://evil.example/x.jpg', 'http://upload.wikimedia.org/x.jpg', 'javascript:alert(1)', 'not a url', '', undefined]) {
      const r = buildGuardedPhotoUpdate('osm-node-1', url, 'A', 'T')
      expect(r.statement).toBeUndefined()
      expect(r.skip).toMatch(/allow-list/)
    }
  })
})

describe('isImageContentType', () => {
  it('accepts any image/* content-type', () => {
    expect(isImageContentType('image/jpeg')).toBe(true)
    expect(isImageContentType('image/jpeg; charset=binary')).toBe(true)
    expect(isImageContentType('IMAGE/PNG')).toBe(true)
  })

  it('rejects non-image content-types', () => {
    expect(isImageContentType('text/html')).toBe(false)
    expect(isImageContentType(null)).toBe(false)
    expect(isImageContentType(undefined)).toBe(false)
  })
})

describe('assertInputRows', () => {
  it('accepts well-formed osm rows with no photo yet', () => {
    const rows = [{ id: 'osm-node-1', source_type: 'osm', photo_url: null }]
    expect(assertInputRows(rows)).toBe(rows)
  })

  it('rejects a non-osm source_type', () => {
    expect(() => assertInputRows([{ id: 'x', source_type: 'manual', photo_url: null }]))
      .toThrow(/OSM-tag-only/)
  })

  it('refuses to overwrite a row that already has a photo', () => {
    expect(() => assertInputRows([{ id: 'x', source_type: 'osm', photo_url: 'https://x/y.jpg' }]))
      .toThrow(/already has a photo_url/)
  })

  it('rejects rows missing an id', () => {
    expect(() => assertInputRows([{ source_type: 'osm', photo_url: null }])).toThrow(/id/)
  })

  it('rejects a non-array input', () => {
    expect(() => assertInputRows({} as never)).toThrow(/array/)
  })
})

describe('parseAttributesPhotoCandidate (#299 ingest pass-through)', () => {
  it('reads a commons candidate from a JSON-string attributes column', () => {
    const json = JSON.stringify({ photo_candidate: { kind: 'commons', title: 'File:Some Park.jpg' } })
    expect(parseAttributesPhotoCandidate(json)).toEqual({ title: 'File:Some Park.jpg', tagUsed: 'attributes' })
  })

  it('reads a commons candidate from an already-parsed object', () => {
    const obj = { photo_candidate: { kind: 'commons', title: 'File:Some Park.jpg' } }
    expect(parseAttributesPhotoCandidate(obj)).toEqual({ title: 'File:Some Park.jpg', tagUsed: 'attributes' })
  })

  it('returns null for absent/empty attributes', () => {
    expect(parseAttributesPhotoCandidate(null)).toBeNull()
    expect(parseAttributesPhotoCandidate(undefined)).toBeNull()
    expect(parseAttributesPhotoCandidate('')).toBeNull()
  })

  it('returns null for attributes with no photo_candidate key (other importers use this column too)', () => {
    expect(parseAttributesPhotoCandidate(JSON.stringify({ fenced: true }))).toBeNull()
  })

  it('returns null for a malformed JSON string', () => {
    expect(parseAttributesPhotoCandidate('{not json')).toBeNull()
  })

  it('returns null for a non-commons kind or a title that is not a Commons File:', () => {
    expect(parseAttributesPhotoCandidate({ photo_candidate: { kind: 'other', title: 'File:X.jpg' } })).toBeNull()
    expect(parseAttributesPhotoCandidate({ photo_candidate: { kind: 'commons', title: 'not-a-file-title' } })).toBeNull()
  })
})

describe('chunk', () => {
  it('splits into fixed-size batches with a possibly-short tail', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })
  it('returns [] for an empty array', () => {
    expect(chunk([], 500)).toEqual([])
  })
  it('rejects a non-positive size', () => {
    expect(() => chunk([1], 0)).toThrow()
  })
})
