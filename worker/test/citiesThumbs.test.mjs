// Node-only tests for the /cities thumbnail script (fs, tmpdir and `new Function`
// crash inside the Workers vitest pool, so these run via `npm run test:mjs`).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  findMaplibreChunk, renderThumbsScript, THUMBS_SCRIPT_PATH,
} from '../scripts/lib/citiesThumbs.mjs'

test('findMaplibreChunk returns the hashed chunk path and fails loudly when missing', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'thumbs-'))
  assert.throws(() => findMaplibreChunk(path.join(dir, 'assets')), /maplibre-gl-\*\.js/)
  mkdirSync(path.join(dir, 'assets'))
  writeFileSync(path.join(dir, 'assets', 'index-abc.js'), '')
  assert.throws(() => findMaplibreChunk(path.join(dir, 'assets')), /npm run build/)
  writeFileSync(path.join(dir, 'assets', 'maplibre-gl-DlgaGnrI.js'), '')
  assert.equal(findMaplibreChunk(path.join(dir, 'assets')), '/assets/maplibre-gl-DlgaGnrI.js')
})

test('the generator writes cities-thumbs.js using the discovered MapLibre chunk', () => {
  const src = readFileSync(new URL('../scripts/build-seo-pages.mjs', import.meta.url), 'utf8')
  assert.equal(THUMBS_SCRIPT_PATH, '/cities-thumbs.js')
  assert.ok(src.includes("findMaplibreChunk(path.join(args.out, 'assets'))"))
  assert.ok(src.includes('renderThumbsScript({ maplibreChunk })'))
  assert.ok(src.includes('THUMBS_SCRIPT_PATH'))
})

const mkEl = (dataset = {}) => {
  const el = {
    className: '', dataset, children: [], style: {}, setAttribute() {},
    appendChild(c) { c.parent = el; el.children.push(c) },
    remove() { el.removed = true; if (el.parent) el.parent.children = el.parent.children.filter((x) => x !== el) },
  }
  return el
}

async function run({ failStyle = false } = {}) {
  const js = renderThumbsScript({ maplibreChunk: '/assets/maplibre-gl-XYZ.js' })
    .replace('import(CHUNK)', 'Promise.resolve({ default: maplibregl })')
    .replace('start().catch(() => {})', 'return start()')
  const thumbs = Array.from({ length: 4 }, () => mkEl({ bbox: '-1,1,1,3', points: '[[0,2,"#fff"]]' }))
  let live = 0, maxLive = 0, created = 0, preserve = false
  class FakeMap {
    constructor(opts) {
      live++; created++; maxLive = Math.max(maxLive, live); preserve = opts.preserveDrawingBuffer
      this.handlers = {}
      queueMicrotask(() => { if (!failStyle) this.handlers.load?.() })
    }
    on(ev, cb) { this.handlers[ev] = cb }
    once(_ev, cb) { setTimeout(cb, 0) }
    addSource() {}
    addLayer() {}
    getCanvas() { return { toDataURL: () => 'data:image/png;base64,AAAA' } }
    remove() { live-- }
  }
  let cb = () => {}
  class FakeIO {
    constructor(c) { cb = c }
    observe() {}
    unobserve() {}
  }
  const doc = {
    querySelectorAll: () => thumbs,
    createElement: (tag) => {
      const e = mkEl()
      if (tag === 'canvas') e.getContext = () => ({ getExtension: () => null })
      return e
    },
  }
  const maplibregl = { Map: FakeMap }
  // Strip `export`-free module code into an async function we can call.
  const fn = new Function('document', 'window', 'IntersectionObserver', 'maplibregl', 'setTimeout', `return (async () => { ${js} })()`)
  // Unref timers so the script's 15s/6s safety timeouts don't hold the test process open.
  const st = (f, ms) => { const t = setTimeout(f, ms); t.unref?.(); return t }
  await fn(doc, { IntersectionObserver: FakeIO }, FakeIO, maplibregl, st)
  cb(thumbs.map((target) => ({ isIntersecting: true, target })))
  await new Promise((r) => setTimeout(r, 80))
  return { thumbs, maxLive, created, live, preserve }
}

test('script is valid code and snapshots each card with at most one live map', async () => {
  const { thumbs, maxLive, created, live, preserve } = await run()
  assert.equal(created, 4)
  assert.equal(maxLive, 1)
  assert.equal(live, 0)
  assert.equal(preserve, true)
  for (const t of thumbs) {
    assert.equal(t.children.length, 1)
    assert.equal(t.children[0].className, 'thumb-img')
    assert.match(t.children[0].src, /^data:image\/png/)
  }
})

test('a map whose style never loads leaves the fallback in place and frees nothing visible', async () => {
  // load never fires; the 15s timeout is long, so only assert nothing was replaced yet.
  const { thumbs, created } = await run({ failStyle: true })
  assert.equal(created, 1)
  for (const t of thumbs) assert.ok(!t.children.some((c) => c.className === 'thumb-img'))
})
