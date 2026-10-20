// Guards migration filenames: wrangler tracks applied migrations by filename,
// so every file needs a unique 4-digit prefix. There are no grandfathered
// duplicates in this repo (the schema was collapsed into 0001_init.sql), so
// any duplicate number fails.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations')

test('migration numbers are unique and well-formed', () => {
  const byNum = new Map()
  for (const f of readdirSync(DIR).filter((n) => n.endsWith('.sql'))) {
    const m = f.match(/^(\d{4})_/)
    assert.ok(m, `${f} must start with a 4-digit number and underscore`)
    byNum.set(m[1], [...(byNum.get(m[1]) ?? []), f].sort())
  }
  for (const [num, files] of byNum) {
    assert.equal(files.length, 1, `duplicate migration number ${num}: ${files.join(', ')}`)
  }
})
