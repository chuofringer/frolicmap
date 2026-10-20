/**
 * Minimal RFC 4180 CSV parser.
 *
 * The IMLS files are ~17K (libraries) and ~30K (museums) rows with quoted
 * fields containing commas — a `split(',')` would silently corrupt every
 * institution whose name has a comma in it, which is a lot of them
 * ("Smith Library, Main Branch"). No dependency is added for this; the
 * format is small enough to parse correctly in 40 lines.
 *
 * Handles: quoted fields, embedded commas, escaped quotes (`""`), embedded
 * newlines inside quotes, CRLF, and a UTF-8 BOM.
 */

export function parseCsv(text) {
  // Strip a UTF-8 BOM — IMLS files ship with one, and it would otherwise
  // become part of the first header name ("﻿STABR").
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)

  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  let i = 0

  while (i < text.length) {
    const c = text[i]

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue }
        inQuotes = false
        i++
        continue
      }
      field += c
      i++
      continue
    }

    if (c === '"') { inQuotes = true; i++; continue }
    if (c === ',') { row.push(field); field = ''; i++; continue }
    if (c === '\r') { i++; continue }
    if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
      continue
    }
    field += c
    i++
  }

  // Trailing field/row (file not ending in a newline).
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }

  if (!rows.length) return { headers: [], rows: [] }

  const headers = rows[0].map((h) => h.trim())
  const body = rows.slice(1)
    // Skip blank trailing lines rather than emitting a row of empty strings.
    .filter((r) => r.length > 1 || (r[0] ?? '').trim() !== '')
    .map((r) => {
      const obj = {}
      for (let c = 0; c < headers.length; c++) obj[headers[c]] = (r[c] ?? '').trim()
      return obj
    })

  return { headers, rows: body }
}
