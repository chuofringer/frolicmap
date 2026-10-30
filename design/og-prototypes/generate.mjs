#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { simulate } from '@bjornlu/colorblind'
import * as fontkit from 'fontkit'
import { chromium } from 'playwright-core'
import sharp from 'sharp'
import { publishedMetros } from '../../shared/metros.ts'

const require = createRequire(import.meta.url)
const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, 'renders')
const THUMBS = path.join(OUT, 'thumbs')
const PIN_OUT = path.join(OUT, 'pins')
const PIN_THUMBS = path.join(PIN_OUT, 'thumbs')
const TMP = path.join(HERE, '.tmp')
const DATA_DIR = path.join(HERE, '.data')
const PLACES_CSV = path.join(DATA_DIR, 'frolicmap-og-places.csv')
const WIDTH = 1200
const HEIGHT = 630
const SAFE = { x: 285, y: 15, width: 630, height: 600 }
const CANVAS = { x: 0, y: 0, width: WIDTH, height: HEIGHT }
const MAX_BYTES = 300_000
const MAPLIBRE_DIST = path.join(path.dirname(require.resolve('maplibre-gl/package.json')), 'dist')
const REGULAR_PATH = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf')
const BOLD_PATH = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf')
const REGULAR = fontkit.openSync(REGULAR_PATH)
const BOLD = fontkit.openSync(BOLD_PATH)
const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron'
const ATTRIBUTION =
  'OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors · openstreetmap.org/copyright (ODbL)'
let RENDER_PAGE_URL

const CITIES = [
  {
    id: 'new-york',
    region: 'new-york',
    name: 'New York City',
    a: { center: [-73.9857, 40.7484], zoom: 10.8 },
    b: { center: [-73.975, 40.735], zoom: 9.7 },
    c: { center: [-74.015, 40.72], zoom: 10.15 },
  },
  {
    id: 'bay-area',
    region: 'bay',
    name: 'San Francisco Bay Area',
    a: { center: [-122.33, 37.72], zoom: 9.1 },
    b: { center: [-122.28, 37.72], zoom: 8.4 },
    c: { center: [-122.42, 37.82], zoom: 9.15 },
  },
  {
    id: 'seattle',
    region: 'seattle',
    name: 'Seattle',
    a: { center: [-122.335, 47.606], zoom: 10.7 },
    b: { center: [-122.335, 47.61], zoom: 9.7 },
    c: { center: [-122.37, 47.58], zoom: 10.45 },
  },
]

const PALETTE = {
  cream: '#fff8eb',
  ink: '#24323a',
  orange: '#9a3412',
  teal: '#0f5f5b',
  waterA: '#9fc6c6',
  waterB: '#78afb2',
  parkA: '#c7d3ae',
  parkB: '#b6c995',
  landA: '#f4e5d1',
  landB: '#f1d8b8',
  road: '#fff8eb',
  roadCasing: '#bd9a78',
}

// Paul Tol's color-blind-safe qualitative palette. Every pair remains at
// least 72 RGB units apart under the generator's protanopia/deuteranopia
// simulation check; the dark outline also separates pale dots from the map.
const PIN_COLORS = {
  park: '#117733',
  playground: '#DDCC77',
  library: '#332288',
  museum: '#CC6677',
  more: '#88CCEE',
}
const PIN_LABELS = {
  park: 'Park',
  playground: 'Play',
  library: 'Library',
  museum: 'Museum',
  more: 'More',
}

function clone(value) {
  return structuredClone(value)
}

function setPaint(layer, property, value) {
  layer.paint ??= {}
  layer.paint[property] = value
}

function styleA(base, { home = false, points = [] } = {}) {
  const style = clone(base)
  const allowed = new Set([
    'background', 'park', 'water', 'landcover_wood', 'landuse_residential',
    'waterway', 'building',
    'highway_minor', 'highway_major_casing', 'highway_major_inner',
    'highway_motorway_casing', 'highway_motorway_inner',
    'highway_motorway_bridge_casing', 'highway_motorway_bridge_inner',
    'boundary_3', 'boundary_2',
    'waterway_line_label', 'water_name_point_label', 'water_name_line_label',
    'highway-name-major', 'label_town', 'label_state', 'label_city', 'label_city_capital',
    'label_country_2', 'label_country_1',
  ])
  style.layers = style.layers.filter((layer) => allowed.has(layer.id))

  for (const layer of style.layers) {
    if (layer.type === 'background') setPaint(layer, 'background-color', PALETTE.landA)
    if (layer.id === 'water') setPaint(layer, 'fill-color', PALETTE.waterA)
    if (layer.id === 'park') setPaint(layer, 'fill-color', PALETTE.parkA)
    if (layer.id === 'landcover_wood') setPaint(layer, 'fill-color', '#d2d8b8')
    if (layer.id === 'landuse_residential') setPaint(layer, 'fill-color', '#ead7c1')
    if (layer.id === 'building') setPaint(layer, 'fill-color', '#d8bea3')
    if (layer.id === 'waterway') setPaint(layer, 'line-color', '#78aaad')
    if (layer.type === 'line' && layer.id.includes('casing')) {
      setPaint(layer, 'line-color', PALETTE.roadCasing)
    }
    if (layer.type === 'line' && (
      layer.id.includes('inner') || layer.id === 'highway_minor'
    )) {
      setPaint(layer, 'line-color', PALETTE.road)
    }
    if (layer.type === 'line' && layer.id.startsWith('boundary')) {
      setPaint(layer, 'line-color', '#a07e67')
    }
    if (layer.type === 'symbol') {
      setPaint(layer, 'text-color', '#4b433a')
      setPaint(layer, 'text-halo-color', '#fff8eb')
      setPaint(layer, 'text-halo-width', 2)
    }
  }

  if (home) {
    style.layers = style.layers.filter((layer) =>
      !['building', 'highway_minor', 'highway-name-major', 'waterway_line_label'].includes(layer.id),
    )
    style.sources['frolicmap-metros'] = {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: points.map(([lng, lat]) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [lng, lat] },
          properties: {},
        })),
      },
    }
    style.layers.push({
      id: 'frolicmap-metro-halo',
      type: 'circle',
      source: 'frolicmap-metros',
      paint: { 'circle-radius': 12, 'circle-color': '#fff8eb', 'circle-opacity': 0.95 },
    }, {
      id: 'frolicmap-metro-dot',
      type: 'circle',
      source: 'frolicmap-metros',
      paint: {
        'circle-radius': 7,
        'circle-color': '#ea580c',
        'circle-stroke-color': '#9a3412',
        'circle-stroke-width': 1.5,
      },
    })
  }
  return style
}

function styleB(base) {
  const style = clone(base)
  const allowed = new Set([
    'background', 'park', 'water', 'landcover_wood', 'waterway', 'boundary_3', 'boundary_2',
  ])
  style.layers = style.layers.filter((layer) => allowed.has(layer.id))
  for (const layer of style.layers) {
    if (layer.type === 'background') setPaint(layer, 'background-color', PALETTE.landB)
    if (layer.id === 'water') setPaint(layer, 'fill-color', PALETTE.waterB)
    if (layer.id === 'park') setPaint(layer, 'fill-color', PALETTE.parkB)
    if (layer.id === 'landcover_wood') setPaint(layer, 'fill-color', '#c4d1a7')
    if (layer.id === 'waterway') {
      setPaint(layer, 'line-color', '#62999e')
      setPaint(layer, 'line-width', 2)
    }
    if (layer.id.startsWith('boundary')) {
      setPaint(layer, 'line-color', '#bd9270')
      setPaint(layer, 'line-opacity', 0.42)
    }
  }
  return style
}

function stylePins(base, pins) {
  const style = styleA(base)
  for (const layer of style.layers) {
    if (layer.type === 'background') setPaint(layer, 'background-color', '#f8dfbf')
    if (layer.id === 'water') setPaint(layer, 'fill-color', '#86c4c2')
    if (layer.id === 'park') setPaint(layer, 'fill-color', '#b8d58f')
    if (layer.id === 'landcover_wood') setPaint(layer, 'fill-color', '#c6d9a1')
    if (layer.id === 'landuse_residential') setPaint(layer, 'fill-color', '#f1cfad')
    if (layer.id === 'building') setPaint(layer, 'fill-color', '#dfb791')
    if (layer.id === 'waterway') setPaint(layer, 'line-color', '#5faaa9')
    if (layer.type === 'line' && layer.id.includes('casing')) {
      setPaint(layer, 'line-color', '#bf8964')
    }
    if (layer.type === 'line' && (
      layer.id.includes('inner') || layer.id === 'highway_minor'
    )) {
      setPaint(layer, 'line-color', '#fff1d8')
    }
  }
  style.sources['frolicmap-places'] = {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: pins.map((pin) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [pin.lng, pin.lat] },
        properties: { group: pin.group },
      })),
    },
  }
  style.layers.push({
    id: 'frolicmap-place-halo',
    type: 'circle',
    source: 'frolicmap-places',
    paint: {
      'circle-radius': 6.4,
      'circle-color': '#fffaf0',
      'circle-opacity': 0.92,
    },
  }, {
    id: 'frolicmap-place-dot',
    type: 'circle',
    source: 'frolicmap-places',
    paint: {
      'circle-radius': 4.2,
      'circle-color': [
        'match', ['get', 'group'],
        'park', PIN_COLORS.park,
        'playground', PIN_COLORS.playground,
        'library', PIN_COLORS.library,
        'museum', PIN_COLORS.museum,
        PIN_COLORS.more,
      ],
      'circle-stroke-color': '#24323a',
      'circle-stroke-width': 0.8,
    },
  })
  return style
}

function styleHomePins(base, metros) {
  const style = styleA(base)
  // No basemap labels: the prototype draws every metro label itself with a
  // leader line, so no true-position marker can cover a city name.
  style.layers = style.layers.filter((layer) => layer.type !== 'symbol')
  style.sources['frolicmap-metros'] = {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: metros.map((metro, index) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [metro.initialView.longitude, metro.initialView.latitude],
        },
        properties: { color: Object.values(PIN_COLORS)[index % Object.keys(PIN_COLORS).length] },
      })),
    },
  }
  style.layers.push({
    id: 'frolicmap-metro-halo',
    type: 'circle',
    source: 'frolicmap-metros',
    paint: { 'circle-radius': 8, 'circle-color': '#fffaf0', 'circle-opacity': 0.96 },
  }, {
    id: 'frolicmap-metro-dot',
    type: 'circle',
    source: 'frolicmap-metros',
    paint: {
      'circle-radius': 5.5,
      'circle-color': ['get', 'color'],
      'circle-stroke-color': '#24323a',
      'circle-stroke-width': 0.9,
    },
  })
  return style
}

function parsePlacesCsv(file) {
  const lines = readFileSync(file, 'utf8').trim().split(/\r?\n/)
  if (lines.shift() !== 'region,category,lat,lng,source_type') {
    throw new Error('unexpected place-export CSV header')
  }
  return lines.map((line, index) => {
    const [region, category, latText, lngText, sourceType] = line.split(',')
    const lat = Number(latText)
    const lng = Number(lngText)
    if (!region || !category || !Number.isFinite(lat) || !Number.isFinite(lng) || !sourceType) {
      throw new Error(`invalid place-export row ${index + 2}`)
    }
    return { region, category, lat, lng, sourceType, row: index + 2 }
  })
}

function categoryGroup(category) {
  return ['park', 'playground', 'library', 'museum'].includes(category) ? category : 'more'
}

function mercator(lng, lat) {
  const x = (lng + 180) / 360
  const sin = Math.sin(lat * Math.PI / 180)
  const y = 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)
  return { x, y }
}

function project(view, lng, lat, width = WIDTH, height = HEIGHT) {
  const center = mercator(view.center[0], view.center[1])
  const point = mercator(lng, lat)
  const scale = 512 * 2 ** view.zoom
  return {
    x: (point.x - center.x) * scale + width / 2,
    y: (point.y - center.y) * scale + height / 2,
  }
}

function stableHash(value) {
  let result = 2166136261
  for (const char of value) {
    result ^= char.charCodeAt(0)
    result = Math.imul(result, 16777619)
  }
  return result >>> 0
}

function thinVisiblePins(rows, view, cellSize = 16) {
  const visible = rows
    .map((row) => ({ ...row, group: categoryGroup(row.category), point: project(view, row.lng, row.lat) }))
    .filter(({ point }) => point.x >= 0 && point.x <= WIDTH && point.y >= 0 && point.y <= HEIGHT)
  const groups = Object.keys(PIN_COLORS).map((group) =>
    visible
      .filter((row) => row.group === group)
      .sort((a, b) =>
        stableHash(`${a.region},${a.category},${a.lat},${a.lng},${a.sourceType}`) -
        stableHash(`${b.region},${b.category},${b.lat},${b.lng},${b.sourceType}`),
      ),
  )
  const selected = []
  const occupied = new Set()
  let remaining = true
  for (let index = 0; remaining; index++) {
    remaining = false
    for (const group of groups) {
      const row = group[index]
      if (!row) continue
      remaining = true
      const cell = `${Math.floor(row.point.x / cellSize)},${Math.floor(row.point.y / cellSize)}`
      if (occupied.has(cell)) continue
      occupied.add(cell)
      selected.push(row)
    }
  }
  return { visible: visible.length, selected }
}

function hexRgb(hex) {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  }
}

function assertColorBlindPalette() {
  const entries = Object.entries(PIN_COLORS)
  const minima = {}
  for (const deficiency of ['protanopia', 'deuteranopia']) {
    const simulated = entries.map(([name, color]) => [name, simulate(hexRgb(color), deficiency)])
    minima[deficiency] = Number.POSITIVE_INFINITY
    for (let i = 0; i < simulated.length; i++) {
      for (let j = i + 1; j < simulated.length; j++) {
        const a = simulated[i][1]
        const b = simulated[j][1]
        const distance = Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b)
        minima[deficiency] = Math.min(minima[deficiency], distance)
        if (distance < 70) {
          throw new Error(
            `${simulated[i][0]}/${simulated[j][0]} are too similar under ${deficiency}: ${distance.toFixed(1)}`,
          )
        }
      }
    }
  }
  return minima
}

function browserPath() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH
  for (const candidate of [
    '/usr/local/bin/google-chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ]) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error('Chrome not found; set CHROME_PATH to a Chromium-compatible executable')
}

async function renderMap(browser, style, view, destination, width = WIDTH, height = HEIGHT) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(`[map console] ${message.text()}`)
  })
  page.on('response', (response) => {
    if (response.status() >= 400) console.error(`[map HTTP ${response.status()}] ${response.url()}`)
  })
  await page.goto(RENDER_PAGE_URL)
  await page.waitForFunction(() => !!window.maplibregl)
  await page.evaluate(
    ({ style, view }) => new Promise((resolve, reject) => {
      const map = new window.maplibregl.Map({
        container: 'map',
        style,
        center: view.center,
        zoom: view.zoom,
        attributionControl: false,
        interactive: false,
        fadeDuration: 0,
      })
      const timer = setTimeout(() => reject(new Error('map render timed out')), 45_000)
      map.once('idle', () => {
        clearTimeout(timer)
        resolve()
      })
      map.on('error', (event) => {
        const message = event?.error?.message ?? ''
        if (message.includes('Failed to load')) reject(event.error)
      })
    }),
    { style, view },
  )
  await page.screenshot({ path: destination, type: 'png' })
  await page.close()
}

async function startRenderServer() {
  const server = createServer((request, response) => {
    if (request.url === '/favicon.ico') {
      response.statusCode = 204
      response.end()
      return
    }
    if (request.url === '/') {
      response.setHeader('content-type', 'text/html')
      response.end(`<!doctype html>
        <style>html,body,#map{margin:0;width:100%;height:100%;overflow:hidden}</style>
        <div id="map"></div>
        <script type="module">
          import { Map } from '/maplibre/maplibre-gl.mjs'
          window.maplibregl = { Map }
        </script>`)
      return
    }
    if (request.url?.startsWith('/maplibre/')) {
      const file = path.basename(new URL(request.url, 'http://localhost').pathname)
      const full = path.join(MAPLIBRE_DIST, file)
      if (!full.startsWith(MAPLIBRE_DIST) || !existsSync(full)) {
        response.statusCode = 404
        response.end('not found')
        return
      }
      response.setHeader('content-type', file.endsWith('.map') ? 'application/json' : 'text/javascript')
      response.end(readFileSync(full))
      return
    }
    response.statusCode = 404
    response.end('not found')
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  return {
    server,
    url: `http://127.0.0.1:${address.port}/`,
  }
}

function measure(text, font, size) {
  return (font.layout(text).advanceWidth / font.unitsPerEm) * size
}

function fit(text, font, maxSize, maxWidth, minSize = 34) {
  return Math.max(minSize, Math.min(maxSize, maxSize * maxWidth / measure(text, font, maxSize)))
}

function bounds({ text, font, size, x, baseline, anchor = 'middle' }) {
  const width = measure(text, font, size)
  return {
    x: anchor === 'middle' ? x - width / 2 : x,
    y: baseline - (font.ascent / font.unitsPerEm) * size,
    width,
    height: ((font.ascent - font.descent) / font.unitsPerEm) * size,
  }
}

function contains(parent, child, epsilon = 0.01) {
  return child.x >= parent.x - epsilon &&
    child.y >= parent.y - epsilon &&
    child.x + child.width <= parent.x + parent.width + epsilon &&
    child.y + child.height <= parent.y + parent.height + epsilon
}

function luminance(hex) {
  const channels = hex.slice(1).match(/.{2}/g).map((part) => {
    const value = Number.parseInt(part, 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function contrast(a, b) {
  const one = luminance(a)
  const two = luminance(b)
  return (Math.max(one, two) + 0.05) / (Math.min(one, two) + 0.05)
}

function assertText(name, entries, parents) {
  for (const entry of entries) {
    if (!contains(CANVAS, entry.box)) throw new Error(`${name}: ${entry.id} leaves canvas`)
    if (!contains(parents[entry.parent], entry.box)) {
      throw new Error(`${name}: ${entry.id} leaves ${entry.parent}`)
    }
    if (contrast(entry.fill, entry.background) < 4.5) {
      throw new Error(`${name}: ${entry.id} contrast is below 4.5:1`)
    }
  }
}

function overlaySvg({ name, title, subtitle = 'family web app', home = false }) {
  const texts = []
  const panel = home
    ? { x: 330, y: 30, width: 540, height: 175 }
    : { x: 300, y: 30, width: 600, height: 175 }
  const attributionPanel = { x: 175, y: 588, width: 850, height: 31 }
  const parents = { safe: SAFE, panel, attributionPanel }
  const text = ({
    id, value, size, x = 600, baseline, font = BOLD, weight = 700,
    fill = PALETTE.ink, parent = 'panel', background = PALETTE.cream,
  }) => {
    texts.push({
      id,
      box: bounds({ text: value, font, size, x, baseline }),
      fill,
      background,
      parent,
    })
    return `<text x="${x}" y="${baseline}" text-anchor="middle" fill="${fill}" ` +
      `font-family="DejaVu Sans" font-size="${size}" font-weight="${weight}">${escapeXml(value)}</text>`
  }
  const brand = text({ id: 'brand', value: 'frolicmap', size: 30, baseline: 70, fill: PALETTE.orange })
  const titleSize = fit(title, BOLD, home ? 51 : 66, panel.width - 50)
  const heading = text({ id: 'title', value: title, size: titleSize, baseline: 137 })
  const descriptor = text({
    id: 'descriptor', value: subtitle, size: 18, baseline: 180,
    font: REGULAR, weight: 400, fill: '#3f4d52',
  })
  const credit = text({
    id: 'attribution', value: ATTRIBUTION, size: 14, baseline: 609,
    font: REGULAR, weight: 400, fill: '#29383d', parent: 'attributionPanel',
  })
  assertText(name, texts, parents)

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
    <rect x="${panel.x}" y="${panel.y}" width="${panel.width}" height="${panel.height}"
      rx="30" fill="${PALETTE.cream}" fill-opacity=".92" stroke="#fff" stroke-opacity=".9" stroke-width="3"/>
    ${brand}${heading}${descriptor}
    <rect x="${attributionPanel.x}" y="${attributionPanel.y}" width="${attributionPanel.width}"
      height="${attributionPanel.height}" rx="15.5" fill="${PALETTE.cream}" fill-opacity=".96"/>
    ${credit}
  </svg>`
}

function pinOverlaySvg({ name, title, pinCount }) {
  const texts = []
  const panel = { x: 315, y: 392, width: 570, height: 174 }
  const attributionPanel = { x: 175, y: 588, width: 850, height: 31 }
  const parents = { safe: SAFE, panel, attributionPanel }
  const text = ({
    id, value, size, x = 600, baseline, anchor = 'middle', font = BOLD, weight = 700,
    fill = PALETTE.ink, parent = 'panel', background = PALETTE.cream,
  }) => {
    texts.push({
      id,
      box: bounds({ text: value, font, size, x, baseline, anchor }),
      fill,
      background,
      parent,
    })
    return `<text x="${x}" y="${baseline}" text-anchor="${anchor}" fill="${fill}" ` +
      `font-family="DejaVu Sans" font-size="${size}" font-weight="${weight}">${escapeXml(value)}</text>`
  }
  const brand = text({ id: 'brand', value: 'frolicmap', size: 24, baseline: 422, fill: PALETTE.orange })
  const titleSize = fit(title, BOLD, 56, panel.width - 46)
  const heading = text({ id: 'title', value: title, size: titleSize, baseline: 474 })
  const descriptor = text({
    id: 'descriptor', value: `family web app · ${pinCount} real places shown`,
    size: 15, baseline: 505, font: REGULAR, weight: 400, fill: '#3f4d52',
  })

  const legendEntries = Object.keys(PIN_COLORS).map((group) => ({
    group,
    label: PIN_LABELS[group],
    width: 12 + 7 + measure(PIN_LABELS[group], REGULAR, 15),
  }))
  const gap = 15
  const legendWidth =
    legendEntries.reduce((sum, entry) => sum + entry.width, 0) + gap * (legendEntries.length - 1)
  let cursor = 600 - legendWidth / 2
  const legend = legendEntries.map((entry) => {
    const dotX = cursor + 6
    const labelX = cursor + 19
    const markup = `<circle cx="${dotX}" cy="542" r="6" fill="${PIN_COLORS[entry.group]}"
      stroke="#24323a" stroke-width="1"/>` + text({
      id: `legend-${entry.group}`,
      value: entry.label,
      size: 15,
      x: labelX,
      baseline: 547,
      anchor: 'start',
      font: REGULAR,
      weight: 400,
    })
    cursor += entry.width + gap
    return markup
  }).join('')
  const credit = text({
    id: 'attribution', value: ATTRIBUTION, size: 14, baseline: 609,
    font: REGULAR, weight: 400, fill: '#29383d', parent: 'attributionPanel',
  })
  assertText(name, texts, parents)

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
    <rect x="${panel.x}" y="${panel.y}" width="${panel.width}" height="${panel.height}"
      rx="28" fill="${PALETTE.cream}" fill-opacity=".93" stroke="#fff" stroke-opacity=".92" stroke-width="3"/>
    ${brand}${heading}${descriptor}${legend}
    <rect x="${attributionPanel.x}" y="${attributionPanel.y}" width="${attributionPanel.width}"
      height="${attributionPanel.height}" rx="15.5" fill="${PALETTE.cream}" fill-opacity=".97"/>
    ${credit}
  </svg>`
}

const HOME_LABEL_LAYOUT = {
  bay: { label: 'SF', dx: 13, dy: -9 },
  'new-york': { label: 'NYC', dx: 14, dy: 8 },
  'los-angeles': { label: 'LA', dx: 13, dy: 15 },
  chicago: { label: 'CHI', dx: -20, dy: -12 },
  dallas: { label: 'DFW', dx: 14, dy: -12 },
  houston: { label: 'HOU', dx: 14, dy: 16 },
  washington: { label: 'DC', dx: -22, dy: 19 },
  atlanta: { label: 'ATL', dx: -21, dy: 15 },
  philadelphia: { label: 'PHL', dx: -24, dy: -4 },
  boston: { label: 'BOS', dx: 13, dy: -13 },
  miami: { label: 'MIA', dx: 13, dy: 15 },
  phoenix: { label: 'PHX', dx: 13, dy: -10 },
  seattle: { label: 'SEA', dx: 13, dy: -9 },
  orlando: { label: 'ORL', dx: 14, dy: -8 },
  austin: { label: 'AUS', dx: -25, dy: 15 },
}

function homePinsOverlaySvg({ metros, view, mapBox }) {
  const texts = []
  const titlePanel = { x: 325, y: 24, width: 550, height: 137 }
  const attributionPanel = { x: 175, y: 588, width: 850, height: 31 }
  const parents = { safe: SAFE, titlePanel, mapBox, attributionPanel }
  const text = ({
    id, value, size, x, baseline, anchor = 'middle', font = BOLD, weight = 700,
    fill = PALETTE.ink, parent, background = PALETTE.cream,
  }) => {
    texts.push({
      id,
      box: bounds({ text: value, font, size, x, baseline, anchor }),
      fill,
      background,
      parent,
    })
    return `<text x="${x}" y="${baseline}" text-anchor="${anchor}" fill="${fill}"
      font-family="DejaVu Sans" font-size="${size}" font-weight="${weight}">${escapeXml(value)}</text>`
  }
  const brand = text({
    id: 'brand', value: 'frolicmap', size: 28, x: 600, baseline: 62,
    fill: PALETTE.orange, parent: 'titlePanel',
  })
  const heading = text({
    id: 'title', value: '15 metros, one map', size: 43, x: 600, baseline: 111,
    parent: 'titlePanel',
  })
  const descriptor = text({
    id: 'descriptor', value: 'family web app', size: 17, x: 600, baseline: 143,
    font: REGULAR, weight: 400, fill: '#3f4d52', parent: 'titlePanel',
  })

  const labels = metros.map((metro) => {
    const layout = HOME_LABEL_LAYOUT[metro.id]
    if (!layout) throw new Error(`no home label layout for ${metro.id}`)
    const local = project(
      view,
      metro.initialView.longitude,
      metro.initialView.latitude,
      mapBox.width,
      mapBox.height,
    )
    const markerX = mapBox.x + local.x
    const markerY = mapBox.y + local.y
    const x = markerX + layout.dx
    const baseline = markerY + layout.dy
    const fontSize = 13
    const labelWidth = measure(layout.label, BOLD, fontSize)
    const labelBox = {
      x: x - labelWidth / 2 - 4,
      y: baseline - 14,
      width: labelWidth + 8,
      height: 18,
    }
    if (!contains(mapBox, labelBox)) throw new Error(`home label ${layout.label} leaves map safe area`)
    return `<line x1="${markerX}" y1="${markerY}" x2="${x}" y2="${baseline - 5}"
      stroke="#5d5044" stroke-width="1.2" opacity=".75"/>
      <rect x="${labelBox.x}" y="${labelBox.y}" width="${labelBox.width}" height="${labelBox.height}"
        rx="7" fill="${PALETTE.cream}" fill-opacity=".94"/>
      ${text({
        id: `metro-${metro.id}`, value: layout.label, size: fontSize, x, baseline,
        parent: 'mapBox', background: PALETTE.cream,
      })}`
  }).join('')
  const credit = text({
    id: 'attribution', value: ATTRIBUTION, size: 14, x: 600, baseline: 609,
    font: REGULAR, weight: 400, fill: '#29383d', parent: 'attributionPanel',
  })
  assertText('home-real-map-pins.png', texts, parents)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
    <rect x="${titlePanel.x}" y="${titlePanel.y}" width="${titlePanel.width}" height="${titlePanel.height}"
      rx="28" fill="${PALETTE.cream}" fill-opacity=".96" stroke="#fff" stroke-width="3"/>
    ${brand}${heading}${descriptor}${labels}
    <rect x="${attributionPanel.x}" y="${attributionPanel.y}" width="${attributionPanel.width}"
      height="${attributionPanel.height}" rx="15.5" fill="${PALETTE.cream}" fill-opacity=".97"/>
    ${credit}
  </svg>`
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

async function finishCard(basePath, outputPath, overlay, thumbDir = THUMBS) {
  let png = await sharp(basePath)
    .composite([{ input: Buffer.from(overlay) }])
    .png({ compressionLevel: 9, palette: true, colours: 96, effort: 10 })
    .toBuffer()
  if (png.byteLength >= MAX_BYTES) {
    png = await sharp(basePath)
      .composite([{ input: Buffer.from(overlay) }])
      .png({ compressionLevel: 9, palette: true, colours: 64, effort: 10 })
      .toBuffer()
  }
  assertPng(outputPath, png)
  writeFileSync(outputPath, png)
  const thumbPath = path.join(thumbDir, path.basename(outputPath))
  const thumb = await sharp(png)
    .resize({ width: 400 })
    .png({ compressionLevel: 9, palette: true, colours: 64, effort: 10 })
    .toBuffer()
  writeFileSync(thumbPath, thumb)
  return { bytes: png.byteLength, thumbBytes: thumb.byteLength }
}

function assertPng(file, png) {
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  if (width !== WIDTH || height !== HEIGHT) {
    throw new Error(`${path.basename(file)} is ${width}×${height}; expected ${WIDTH}×${HEIGHT}`)
  }
  if (png.byteLength >= MAX_BYTES) {
    throw new Error(`${path.basename(file)} is ${png.byteLength} bytes; must be under ${MAX_BYTES}`)
  }
}

async function circleImage(input, size = 190) {
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 3}" fill="white"/></svg>`,
  )
  return sharp(input)
    .resize(size, size, { fit: 'cover' })
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer()
}

async function homeB(baseMaps, outputPath) {
  const bg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
    <defs><linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop stop-color="#fff3dd"/><stop offset=".55" stop-color="#f9ddc7"/><stop offset="1" stop-color="#d9eee4"/>
    </linearGradient></defs>
    <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
    <circle cx="98" cy="85" r="135" fill="#ffd3a6" opacity=".55"/>
    <circle cx="1110" cy="560" r="170" fill="#b9ded5" opacity=".55"/>
  </svg>`)
  const mapCircles = await Promise.all(baseMaps.map((file) => circleImage(file)))
  const xs = [290, 505, 720]
  const labels = ['New York City', 'Bay Area', 'Seattle']
  const texts = []
  const labelMarkup = labels.map((label, index) => {
    const x = xs[index] + 95
    const size = fit(label, BOLD, 20, 180, 15)
    const box = bounds({ text: label, font: BOLD, size, x, baseline: 493 })
    texts.push({
      id: `label-${index}`,
      box,
      fill: PALETTE.ink,
      background: PALETTE.cream,
      parent: 'safe',
    })
    return `<rect x="${x - 91}" y="463" width="182" height="40" rx="20" fill="${PALETTE.cream}"/>
      <text x="${x}" y="493" text-anchor="middle" fill="${PALETTE.ink}"
        font-family="DejaVu Sans" font-size="${size}" font-weight="700">${escapeXml(label)}</text>`
  }).join('')
  assertText('home-b-silhouettes.png', texts, { safe: SAFE })
  const collageOverlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
    ${labelMarkup}
  </svg>`)
  const basePath = path.join(TMP, 'home-b-base.png')
  await sharp(bg)
    .composite([
      ...mapCircles.map((input, index) => ({ input, left: xs[index], top: 265 })),
      { input: collageOverlay },
    ])
    .png()
    .toFile(basePath)
  return finishCard(
    basePath,
    outputPath,
    overlaySvg({
      name: 'home-b-silhouettes.png',
      title: 'family adventures, mapped',
      subtitle: 'frolicmap family web app',
      home: true,
    }),
  )
}

mkdirSync(OUT, { recursive: true })
mkdirSync(THUMBS, { recursive: true })
mkdirSync(PIN_OUT, { recursive: true })
mkdirSync(PIN_THUMBS, { recursive: true })
mkdirSync(DATA_DIR, { recursive: true })
if (process.env.FROLICMAP_OG_PLACES_CSV) {
  const source = path.resolve(process.env.FROLICMAP_OG_PLACES_CSV)
  if (!existsSync(source)) throw new Error(`place export not found: ${source}`)
  if (source !== PLACES_CSV) copyFileSync(source, PLACES_CSV)
}
if (!existsSync(PLACES_CSV)) {
  throw new Error(
    `missing private place export at ${PLACES_CSV}; ` +
    'set FROLICMAP_OG_PLACES_CSV once to import a read-only export',
  )
}
const placeRows = parsePlacesCsv(PLACES_CSV)
if (placeRows.length !== 8410) {
  throw new Error(`expected 8,410 approved place rows, found ${placeRows.length}`)
}
if (placeRows.some((row) =>
  !['new-york', 'bay', 'seattle'].includes(row.region) ||
  !['osm', 'imls', 'nps'].includes(row.sourceType)
)) {
  throw new Error('place export contains an unexpected region or source type')
}
const colorBlindDistances = assertColorBlindPalette()
rmSync(TMP, { recursive: true, force: true })
mkdirSync(TMP, { recursive: true })

const baseStyle = await (await fetch(STYLE_URL)).json()
const renderServer = await startRenderServer()
RENDER_PAGE_URL = renderServer.url
const browser = await chromium.launch({
  executablePath: browserPath(),
  headless: true,
  args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const generated = []
const silhouetteBases = []

try {
  for (const city of CITIES) {
    const aBase = path.join(TMP, `${city.id}-a.png`)
    const aOut = path.join(OUT, `${city.id}-a-real-map.png`)
    await renderMap(browser, styleA(baseStyle), city.a, aBase)
    generated.push([
      path.basename(aOut),
      await finishCard(
        aBase,
        aOut,
        overlaySvg({ name: path.basename(aOut), title: city.name }),
      ),
    ])

    const bBase = path.join(TMP, `${city.id}-b.png`)
    const bOut = path.join(OUT, `${city.id}-b-silhouette.png`)
    await renderMap(browser, styleB(baseStyle), city.b, bBase)
    silhouetteBases.push(bBase)
    generated.push([
      path.basename(bOut),
      await finishCard(
        bBase,
        bOut,
        overlaySvg({ name: path.basename(bOut), title: city.name }),
      ),
    ])

    const { visible, selected } = thinVisiblePins(
      placeRows.filter((row) => row.region === city.region),
      city.c,
    )
    const pinBase = path.join(TMP, `${city.id}-pins.png`)
    const pinOut = path.join(PIN_OUT, `${city.id}-real-map-pins.png`)
    await renderMap(browser, stylePins(baseStyle, selected), city.c, pinBase)
    generated.push([
      path.basename(pinOut),
      await finishCard(
        pinBase,
        pinOut,
        pinOverlaySvg({ name: path.basename(pinOut), title: city.name, pinCount: selected.length }),
        PIN_THUMBS,
      ),
      `${selected.length} drawn from ${visible} visible rows (16px cell cap)`,
    ])
  }

  const homeABase = path.join(TMP, 'home-a.png')
  const homeAOut = path.join(OUT, 'home-a-real-map.png')
  const metroPoints = publishedMetros().map((metro) => [
    metro.initialView.longitude,
    metro.initialView.latitude,
  ])
  await renderMap(
    browser,
    styleA(baseStyle, { home: true, points: metroPoints }),
    { center: [-98.5, 38.5], zoom: 3.25 },
    homeABase,
  )
  generated.push([
    path.basename(homeAOut),
    await finishCard(
      homeABase,
      homeAOut,
      overlaySvg({
        name: path.basename(homeAOut),
        title: '15 metros, one map',
        subtitle: 'frolicmap family web app',
        home: true,
      }),
    ),
  ])

  const homeBOut = path.join(OUT, 'home-b-silhouettes.png')
  generated.push([path.basename(homeBOut), await homeB(silhouetteBases, homeBOut)])

  const homeMetros = [...publishedMetros()]
  const homeView = { center: [-98.5, 38.5], zoom: 2.35 }
  const homeMapBox = { x: 285, y: 190, width: 630, height: 360 }
  const homePinMap = path.join(TMP, 'home-pins-map.png')
  await renderMap(
    browser,
    styleHomePins(baseStyle, homeMetros),
    homeView,
    homePinMap,
    homeMapBox.width,
    homeMapBox.height,
  )
  const roundedMap = await sharp(homePinMap)
    .composite([{
      input: Buffer.from(
        `<svg width="${homeMapBox.width}" height="${homeMapBox.height}">
          <rect width="${homeMapBox.width}" height="${homeMapBox.height}" rx="30" fill="white"/>
        </svg>`,
      ),
      blend: 'dest-in',
    }])
    .png()
    .toBuffer()
  const homeBackground = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
    <defs><linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop stop-color="#fff0d7"/><stop offset=".55" stop-color="#f7d5bd"/><stop offset="1" stop-color="#cce9dc"/>
    </linearGradient></defs>
    <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
    <circle cx="120" cy="100" r="160" fill="#ffc98f" opacity=".5"/>
    <circle cx="1090" cy="535" r="180" fill="#a9d8c9" opacity=".55"/>
  </svg>`)
  const homePinBase = path.join(TMP, 'home-pins-base.png')
  await sharp(homeBackground)
    .composite([{ input: roundedMap, left: homeMapBox.x, top: homeMapBox.y }])
    .png()
    .toFile(homePinBase)
  const homePinOut = path.join(PIN_OUT, 'home-real-map-pins.png')
  generated.push([
    path.basename(homePinOut),
    await finishCard(
      homePinBase,
      homePinOut,
      homePinsOverlaySvg({ metros: homeMetros, view: homeView, mapBox: homeMapBox }),
      PIN_THUMBS,
    ),
    '15 true metro-center markers',
  ])
} finally {
  await browser.close()
  await new Promise((resolve, reject) => {
    renderServer.server.close((error) => error ? reject(error) : resolve())
  })
  rmSync(TMP, { recursive: true, force: true })
}

generated.sort(([a], [b]) => a.localeCompare(b))
for (const [file, sizes, detail = ''] of generated) {
  console.log(
    `${file}\t${sizes.bytes} bytes\tthumbnail ${sizes.thumbBytes} bytes` +
    (detail ? `\t${detail}` : ''),
  )
}
console.log(
  `pin palette check: protanopia minimum ${colorBlindDistances.protanopia.toFixed(1)}, ` +
  `deuteranopia minimum ${colorBlindDistances.deuteranopia.toFixed(1)} RGB units`,
)
