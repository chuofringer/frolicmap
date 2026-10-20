#!/usr/bin/env node
/**
 * ODbL export — issue #19.
 *
 * Our OpenStreetMap-derived rows are a Derived Database under the Open
 * Database Licence 1.0, which requires making the derived data available under
 * the same licence. This script reads D1 and writes that extract as CSV plus a
 * README.txt carrying the licence notice. It only reads D1 and only writes
 * files; it never writes to any database.
 *
 * Output (relative to the repo root, git-ignored via /data/):
 *   data/export/items-osm.csv   every status='approved' row with source_type='osm'
 *   data/export/README.txt      licence + attribution notice
 *
 * HOW TO RUN
 *   1. Local D1 (default):
 *        node worker/scripts/export-odbl.mjs
 *   2. Production D1 (read-only query):
 *        node worker/scripts/export-odbl.mjs --remote
 *   3. Publish data/export/ wherever the ODbL notice should live (the README.txt
 *      travels with the CSV).
 *
 * Columns: id,name,category,lat,lng,address,website,source_url,region,last_verified
 *
 * Needs `npx wrangler` available under worker/. Plain Node, no TypeScript.
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatWranglerError, withRetry } from './lib/wranglerExec.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../..')
const WORKER_DIR = path.join(REPO_ROOT, 'worker')
const OUT_DIR = path.join(REPO_ROOT, 'data', 'export')

export const COLUMNS = ['id', 'name', 'category', 'lat', 'lng', 'address', 'website', 'source_url', 'region', 'last_verified']

export const SELECT_SQL =
  `SELECT ${COLUMNS.join(', ')} FROM items WHERE status = 'approved' AND source_type = 'osm' ORDER BY id`

export const README_TEXT = `frolicmap.app: OpenStreetMap-derived places (items-osm.csv)

This file is a Derived Database of OpenStreetMap data, made available under the
Open Database License (ODbL) 1.0: https://opendatacommons.org/licenses/odbl/1-0/

Attribution: © OpenStreetMap contributors
OpenStreetMap copyright and licence: https://www.openstreetmap.org/copyright

If you use, adapt or redistribute this data you must keep the attribution above
and share any Derived Database you publish under the same licence (ODbL 1.0).

Contents: every approved place on frolicmap.app that was imported from
OpenStreetMap (source_type = 'osm'). Columns:
${COLUMNS.join(',')}
Empty cells mean the value is unknown. last_verified is an ISO 8601 timestamp.
Rows from other sources (with their own licences) are not included.
Cells whose text starts with =, +, - or @ (other than plain numbers such as lat/lng) carry a leading apostrophe for spreadsheet safety.
`

const FORMULA_TRIGGER = /^[=+\-@]/
const PLAIN_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/

/**
 * One CSV field (RFC 4180): null/undefined -> empty; values containing a comma,
 * double quote, CR or LF are wrapped in double quotes with inner quotes doubled.
 * Numbers are written as-is. Spreadsheet formula injection is neutralised: a
 * text cell that, trimmed, starts with `=`, `+`, `-` or `@` gets a leading
 * single quote, unless it is a plain number (so `-122.4` longitudes stay numeric).
 */
export function csvField(value) {
  if (value === null || value === undefined) return ''
  let s = String(value)
  const t = s.trim()
  if (typeof value !== 'number' && FORMULA_TRIGGER.test(t) && !PLAIN_NUMBER.test(t)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Header line plus one line per row, CRLF-terminated. Rows are objects keyed by COLUMNS. */
export function toCsv(rows) {
  const lines = [COLUMNS.join(',')]
  for (const row of rows) lines.push(COLUMNS.map((c) => csvField(row[c])).join(','))
  return lines.join('\r\n') + '\r\n'
}

function parseArgs(argv) {
  const args = { remote: false }
  for (const a of argv) {
    if (a === '--remote') args.remote = true
    else if (a === '--local') args.remote = false
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node worker/scripts/export-odbl.mjs [--local | --remote]\n  --local   read the local D1 (default)\n  --remote  read the remote D1 (read-only query)')
      process.exit(0)
    } else {
      console.error(`unknown flag: ${a}`)
      process.exit(1)
    }
  }
  return args
}

function d1(sql, remote) {
  const res = withRetry(
    () => {
      const r = spawnSync(
        'npx',
        ['wrangler', 'd1', 'execute', 'frolicmap-prod', remote ? '--remote' : '--local', '--json', '--command', sql],
        { cwd: WORKER_DIR, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, shell: false },
      )
      if (r.status !== 0) throw new Error(formatWranglerError(r.stderr, r.status))
      return r
    },
    { attempts: 4, baseMs: 2000 },
  )
  const start = res.stdout.indexOf('[')
  if (start < 0) throw new Error('no JSON in wrangler output')
  return JSON.parse(res.stdout.slice(start))[0]?.results ?? []
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const rows = d1(SELECT_SQL, args.remote)
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(path.join(OUT_DIR, 'items-osm.csv'), toCsv(rows))
  writeFileSync(path.join(OUT_DIR, 'README.txt'), README_TEXT)
  console.log(`Wrote ${rows.length} rows to ${path.relative(REPO_ROOT, OUT_DIR)}/items-osm.csv (+ README.txt) from ${args.remote ? 'remote' : 'local'} D1.`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
