#!/usr/bin/env node

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'
import * as fontkit from 'fontkit'
import { METROS } from '../shared/metros.ts'
import {
  HOME_SOCIAL_IMAGE_PATH,
  SOCIAL_IMAGE_HEIGHT,
  SOCIAL_IMAGE_WIDTH,
  metroSocialImagePath,
} from '../worker/scripts/lib/socialImages.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC = path.join(ROOT, 'public')
const OUT = path.join(PUBLIC, 'og')
const require = createRequire(import.meta.url)
const FONT_REGULAR_PATH = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf')
const FONT_BOLD_PATH = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf')
const FONT_REGULAR = fontkit.openSync(FONT_REGULAR_PATH)
const FONT_BOLD = fontkit.openSync(FONT_BOLD_PATH)

const CANVAS = { x: 0, y: 0, width: SOCIAL_IMAGE_WIDTH, height: SOCIAL_IMAGE_HEIGHT }
// The centered 630×600 area survives the practical square and 2:1 crops
// documented in docs/social-share-images.md. Every text element is constrained
// to it; the outer 285px on each side contains decoration only.
const SAFE_AREA = { x: 285, y: 15, width: 630, height: 600 }
const PANEL_COLOR = '#fffaf0'
const MAX_IMAGE_BYTES = 300_000
const validationTotals = { cards: 0, textBoxes: 0, pills: 0 }

const esc = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')

function hash(value) {
  let result = 2166136261
  for (const char of value) {
    result ^= char.charCodeAt(0)
    result = Math.imul(result, 16777619)
  }
  return result >>> 0
}

function measureText(text, font, size) {
  return (font.layout(text).advanceWidth / font.unitsPerEm) * size
}

function fitText(text, font, maxSize, maxWidth, minSize = 38) {
  const natural = measureText(text, font, maxSize)
  return natural <= maxWidth ? maxSize : Math.max(minSize, maxSize * maxWidth / natural)
}

function textBounds({ text, font, size, x, baseline, anchor = 'middle' }) {
  const width = measureText(text, font, size)
  const left = anchor === 'middle' ? x - width / 2 : x
  return {
    x: left,
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

function relativeLuminance(hex) {
  const channels = hex.slice(1).match(/.{2}/g).map((part) => {
    const value = Number.parseInt(part, 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function contrastRatio(a, b) {
  const lighter = Math.max(relativeLuminance(a), relativeLuminance(b))
  const darker = Math.min(relativeLuminance(a), relativeLuminance(b))
  return (lighter + 0.05) / (darker + 0.05)
}

function assertLayout(name, texts, containers) {
  for (const text of texts) {
    if (!contains(CANVAS, text.bounds)) {
      throw new Error(`${name}: text "${text.id}" extends past the 1200×630 canvas`)
    }
    const parent = containers[text.parent]
    if (!parent || !contains(parent, text.bounds)) {
      throw new Error(`${name}: text "${text.id}" extends past its ${text.parent} container`)
    }
    const ratio = contrastRatio(text.fill, text.background)
    if (ratio < 4.5) {
      throw new Error(`${name}: text "${text.id}" contrast ${ratio.toFixed(2)}:1 is below 4.5:1`)
    }
  }
  for (const [id, box] of Object.entries(containers)) {
    if (!contains(CANVAS, box)) throw new Error(`${name}: container "${id}" extends past the canvas`)
  }
  validationTotals.cards += 1
  validationTotals.textBoxes += texts.length
  validationTotals.pills += Object.keys(containers).filter((id) => id.endsWith('Pill')).length
}

function decoration(seed) {
  const hues = ['#ea580c', '#0f766e', '#2563eb', '#7c3aed', '#ca8a04']
  const pins = Array.from({ length: 18 }, (_, index) => {
    const side = index % 2 === 0 ? 1 : -1
    const x = side > 0
      ? 950 + ((seed >>> (index % 16)) + index * 47) % 210
      : 40 + ((seed >>> ((index + 3) % 16)) + index * 61) % 210
    const y = 55 + ((seed >>> ((index + 5) % 16)) + index * 83) % 515
    const color = hues[(seed + index) % hues.length]
    const size = index % 4 === 0 ? 17 : 11
    return `<circle cx="${x}" cy="${y}" r="${size}" fill="${color}" stroke="#fffaf0" stroke-width="5"/>`
  }).join('')

  return `
    <g opacity=".17" fill="none" stroke="#334155" stroke-width="5" stroke-linecap="round">
      <path d="M-30 177 C173 54 290 232 467 126 S856 178 1230 72"/>
      <path d="M-40 492 C180 360 386 528 583 418 S954 516 1240 326"/>
      <path d="M105 0 C163 203 67 326 220 650"/>
      <path d="M1028-20 C945 194 1166 323 1028 650"/>
    </g>
    <path d="M-30 550 C169 439 267 302 441 332 C650 369 804 238 1230 106"
      fill="none" stroke="#fb923c" stroke-width="10" stroke-linecap="round" stroke-dasharray="2 26"/>
    ${pins}
  `
}

function imageSvg({ city = null, name }) {
  const texts = []
  const containers = { canvas: CANVAS, safeArea: SAFE_AREA }
  const text = ({
    id, value, font = FONT_BOLD, weight = 700, size, x = 600, baseline,
    anchor = 'middle', fill = '#24323a', parent = 'safeArea', background = PANEL_COLOR,
  }) => {
    const bounds = textBounds({ text: value, font, size, x, baseline, anchor })
    texts.push({ id, bounds, fill, background, parent })
    return `<text x="${x}" y="${baseline}" text-anchor="${anchor}" fill="${fill}" ` +
      `font-size="${size}" font-weight="${weight}">${esc(value)}</text>`
  }

  const brandSize = 42
  const frolicWidth = measureText('frolic', FONT_BOLD, brandSize)
  const mapWidth = measureText('map', FONT_BOLD, brandSize)
  const brandStart = 600 - (frolicWidth + mapWidth) / 2
  const brand = text({
    id: 'brand-frolic', value: 'frolic', size: brandSize, x: brandStart,
    baseline: 94, anchor: 'start', fill: '#9a3412',
  }) + text({
    id: 'brand-map', value: 'map', size: brandSize, x: brandStart + frolicWidth,
    baseline: 94, anchor: 'start',
  })

  const descriptor = 'FAMILY WEB APP'
  const descriptorSize = 18
  const descriptorPaddingX = 28
  const descriptorWidth = measureText(descriptor, FONT_BOLD, descriptorSize)
  const pill = {
    x: 600 - descriptorWidth / 2 - descriptorPaddingX,
    y: 119,
    width: descriptorWidth + descriptorPaddingX * 2,
    height: 43,
  }
  containers.descriptorPill = pill
  const descriptorMarkup =
    `<rect x="${pill.x}" y="${pill.y}" width="${pill.width}" height="${pill.height}" ` +
    `rx="${pill.height / 2}" fill="${PANEL_COLOR}" stroke="#c2410c" stroke-width="2"/>` +
    text({
      id: 'web-app-label', value: descriptor, size: descriptorSize, baseline: 147,
      fill: '#9a3412', parent: 'descriptorPill',
    })

  const titleLines = city ? [city] : ['Family adventures,', 'mapped']
  const titleMaxSize = city ? 84 : 82
  const titleSize = Math.min(...titleLines.map((line) =>
    fitText(line, FONT_BOLD, titleMaxSize, 560),
  ))
  const titleBaselines = city ? [306] : [280, 369]
  const titleMarkup = titleLines.map((line, index) => text({
    id: `headline-${index + 1}`, value: line, size: titleSize,
    baseline: titleBaselines[index],
  })).join('')

  const subtitle = city ? 'family adventures, mapped' : 'kid-friendly places on one map'
  const subtitleMarkup = text({
    id: 'subtitle', value: subtitle, font: FONT_REGULAR, weight: 400,
    size: 27, baseline: city ? 378 : 429, fill: '#334155',
  })

  const seed = hash(city ?? 'home')
  const markerY = city ? 485 : 515
  const marker = `<g transform="translate(600 ${markerY})">
    <path d="M0-45 C-30-45-50-24-50 4 C-50 42 0 82 0 82 S50 42 50 4 C50-24 30-45 0-45Z"
      fill="#ea580c" stroke="#fffaf0" stroke-width="9"/>
    <circle cy="2" r="17" fill="#fffaf0"/>
    <path d="M-7 3 L-1 10 L13-7" fill="none" stroke="#0f766e" stroke-width="7"
      stroke-linecap="round" stroke-linejoin="round"/>
  </g>`

  assertLayout(name, texts, containers)

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SOCIAL_IMAGE_WIDTH}" height="${SOCIAL_IMAGE_HEIGHT}" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff8e8"/>
      <stop offset=".5" stop-color="#ffedd5"/>
      <stop offset="1" stop-color="#dff7ef"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="14" stdDeviation="20" flood-color="#9a6c43" flood-opacity=".16"/>
    </filter>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <circle cx="1115" cy="42" r="172" fill="#fed7aa" opacity=".62"/>
  <circle cx="724" cy="626" r="174" fill="#bfdbfe" opacity=".48"/>
  <circle cx="75" cy="585" r="105" fill="#fbcfe8" opacity=".42"/>
  ${decoration(seed)}

  <g filter="url(#shadow)">
    <rect x="265" y="35" width="670" height="560" rx="46" fill="${PANEL_COLOR}" stroke="#fff" stroke-width="5"/>
  </g>
  <g font-family="DejaVu Sans">
    ${brand}
    ${descriptorMarkup}
    ${titleMarkup}
    ${subtitleMarkup}
    ${marker}
  </g>
</svg>`
}

function render(destination, options) {
  const svg = imageSvg({ ...options, name: path.basename(destination) })
  const png = new Resvg(svg, {
    fitTo: { mode: 'width', value: SOCIAL_IMAGE_WIDTH },
    font: {
      fontFiles: [FONT_REGULAR_PATH, FONT_BOLD_PATH],
      loadSystemFonts: false,
      defaultFontFamily: 'DejaVu Sans',
    },
  }).render().asPng()
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  if (width !== SOCIAL_IMAGE_WIDTH || height !== SOCIAL_IMAGE_HEIGHT) {
    throw new Error(`${path.basename(destination)} rendered at ${width}×${height}, expected 1200×630`)
  }
  if (png.byteLength >= MAX_IMAGE_BYTES) {
    throw new Error(
      `${path.basename(destination)} is ${png.byteLength} bytes; social cards must stay under ${MAX_IMAGE_BYTES}`,
    )
  }
  writeFileSync(destination, png)
  return png.byteLength
}

mkdirSync(OUT, { recursive: true })
for (const file of readdirSync(OUT)) {
  if (file.endsWith('.png')) rmSync(path.join(OUT, file))
}
rmSync(path.join(PUBLIC, 'og-image.png'), { force: true })

const published = METROS.filter((metro) => metro.published)
const generated = []
const homePath = path.join(PUBLIC, HOME_SOCIAL_IMAGE_PATH)
generated.push([path.basename(homePath), render(homePath, {})])
for (const metro of published) {
  const destination = path.join(PUBLIC, metroSocialImagePath(metro))
  generated.push([path.basename(destination), render(destination, { city: metro.label })])
}

console.log(`Generated 1 home image and ${published.length} metro images in public/og/`)
console.log(
  `Validated ${validationTotals.textBoxes} text boxes and ${validationTotals.pills} measured pills ` +
  `across ${validationTotals.cards} cards`,
)
for (const [file, bytes] of generated) console.log(`${file}\t${bytes} bytes`)
