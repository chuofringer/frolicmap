// Pure sampling and CSV/Markdown helpers for hand-checking a random sample of
// approved rows (#679). No I/O, no imports — unit-tested in
// worker/test/qualitySample.test.ts.

/** FNV-1a 32-bit string hash -> uint32 seed. */
export function hashSeed(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/** mulberry32 PRNG: deterministic float in [0,1) stream from a uint32 seed. */
export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Reproducible sample of up to n rows. Input is sorted by id first so the
 * draw depends only on (set of ids, seed), never on query order.
 */
export function seededSample(rows, n, seed) {
  const sorted = [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const rand = mulberry32(hashSeed(String(seed)))
  for (let i = sorted.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[sorted[i], sorted[j]] = [sorted[j], sorted[i]]
  }
  return sorted.slice(0, n)
}

/** Stratified: up to perSource rows from each source_type (each seeded independently). */
export function stratifiedSample(rows, perSource, seed) {
  const groups = new Map()
  for (const r of rows) {
    const g = groups.get(r.source_type) ?? []
    g.push(r)
    groups.set(r.source_type, g)
  }
  return [...groups.keys()].sort().flatMap((k) => seededSample(groups.get(k), perSource, `${seed}|${k}`))
}

/** ISO week label ("2026-W41") -> [Monday 00:00Z, next Monday 00:00Z) ISO strings. */
export function isoWeekWindow(label) {
  const m = /^(\d{4})-W(\d{2})$/.exec(label)
  if (!m) throw new Error(`bad week label: ${label} (want YYYY-Www)`)
  const year = Number(m[1])
  const week = Number(m[2])
  // Jan 4 is always in ISO week 1.
  const jan4 = Date.UTC(year, 0, 4)
  const dow = (new Date(jan4).getUTCDay() + 6) % 7 // Mon=0
  const week1Mon = jan4 - dow * 86400000
  const start = week1Mon + (week - 1) * 7 * 86400000
  return [new Date(start).toISOString(), new Date(start + 7 * 86400000).toISOString()]
}

/**
 * Render a stored ISO timestamp as venue-local wall clock, e.g.
 * "Sat 2026-10-10 10:30 PDT". Bare dates render as "<date> (all day)".
 * Naive values are already wall clock and render unsuffixed.
 */
export function formatVenueLocal(value, tz) {
  if (value == null || value === '') return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value} (all day)`
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(value)) return `${value.replace('T', ' ').slice(0, 16)} (naive)`
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return `${value} (unparseable)`
  const zone = tz || 'UTC'
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short',
    }).formatToParts(d).map((p) => [p.type, p.value]),
  )
  return `${parts.weekday} ${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} ${parts.timeZoneName}`
}

export const CHECK_COLUMNS = ['date_ok', 'time_ok', 'venue_ok', 'verdict (correct/wrong/unverifiable)', 'notes']

function csvCell(v) {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const BASE_HEADERS = ['#', 'id', 'source_type', 'region', 'name', 'start (venue-local)', 'end (venue-local)', 'venue / address', 'source_url']

export function toCsv(entries) {
  const lines = [[...BASE_HEADERS, ...CHECK_COLUMNS].map(csvCell).join(',')]
  entries.forEach((e, i) => {
    lines.push([i + 1, e.id, e.source_type, e.region, e.name, e.start, e.end, e.venue, e.source_url, '', '', '', '', ''].map(csvCell).join(','))
  })
  return lines.join('\n') + '\n'
}

const mdCell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')

export function toMarkdown(entries, header) {
  const cols = [...BASE_HEADERS, ...CHECK_COLUMNS]
  const out = [header, '', `| ${cols.join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`]
  entries.forEach((e, i) => {
    const link = e.source_url ? `<${e.source_url}>` : ''
    out.push(`| ${[i + 1, `\`${e.id}\``, e.source_type, e.region, e.name, e.start, e.end, e.venue, link, '', '', '', '', ''].map(mdCell).join(' | ')} |`)
  })
  return out.join('\n') + '\n'
}
