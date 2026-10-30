#!/usr/bin/env node

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'
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

function cityTitleSize(title) {
  if (title.length > 25) return 48
  if (title.length > 20) return 54
  if (title.length > 15) return 62
  if (title.length > 11) return 68
  return 76
}

function illustration(seed) {
  const hues = ['#f97316', '#14b8a6', '#3b82f6', '#8b5cf6', '#eab308']
  const pins = Array.from({ length: 12 }, (_, index) => {
    const x = 835 + ((seed >>> (index % 16)) + index * 73) % 280
    const y = 117 + ((seed >>> ((index + 5) % 16)) + index * 91) % 385
    const color = hues[(seed + index) % hues.length]
    const size = index % 4 === 0 ? 18 : 13
    return `<circle cx="${x}" cy="${y}" r="${size}" fill="${color}" stroke="#fffdf8" stroke-width="6"/>`
  }).join('')

  return `
    <g opacity=".2" fill="none" stroke="#334155" stroke-width="5" stroke-linecap="round">
      <path d="M785 174 C875 102 950 231 1140 139"/>
      <path d="M812 484 C900 397 1014 489 1146 356"/>
      <path d="M876 82 C909 210 1041 245 1082 537"/>
      <path d="M774 323 C887 286 997 357 1166 275"/>
    </g>
    <path d="M789 500 C854 411 877 318 959 279 C1036 242 1059 177 1134 113"
      fill="none" stroke="#fb923c" stroke-width="12" stroke-linecap="round" stroke-dasharray="3 28"/>
    ${pins}
    <g transform="translate(979 391)">
      <path d="M0-56 C-36-56-60-31-60 2 C-60 47 0 96 0 96 S60 47 60 2 C60-31 36-56 0-56Z"
        fill="#f97316" stroke="#fffdf8" stroke-width="10"/>
      <circle cy="1" r="20" fill="#fffdf8"/>
      <path d="M-7 5 L-1 12 L14-7" fill="none" stroke="#14b8a6" stroke-width="8"
        stroke-linecap="round" stroke-linejoin="round"/>
    </g>`
}

function imageSvg({ city = null }) {
  const title = city ?? 'family adventures,\nmapped'
  const titleLines = title.split('\n')
  const titleSize = city ? cityTitleSize(city) : 72
  const titleMarkup = titleLines.map((line, index) =>
    `<tspan x="76" dy="${index === 0 ? 0 : titleSize + 4}">${esc(line)}</tspan>`,
  ).join('')
  const seed = hash(city ?? 'home')
  const eyebrow = city ? 'EXPLORE WITH KIDS IN' : 'FIND YOUR NEXT OUTING'

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SOCIAL_IMAGE_WIDTH}" height="${SOCIAL_IMAGE_HEIGHT}" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff8e8"/>
      <stop offset=".5" stop-color="#ffedd5"/>
      <stop offset="1" stop-color="#dff7ef"/>
    </linearGradient>
    <linearGradient id="card" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="#fffdf8"/>
      <stop offset="1" stop-color="#ecfdf5"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#9a6c43" flood-opacity=".18"/>
    </filter>
  </defs>
  <rect width="1200" height="630" rx="0" fill="url(#bg)"/>
  <circle cx="1115" cy="42" r="172" fill="#fed7aa" opacity=".62"/>
  <circle cx="700" cy="600" r="164" fill="#bfdbfe" opacity=".45"/>
  <circle cx="75" cy="585" r="105" fill="#fbcfe8" opacity=".42"/>

  <g font-family="Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif">
    <text x="76" y="92" font-size="38" font-weight="800" letter-spacing="-.8">
      <tspan fill="#f97316">frolic</tspan><tspan fill="#263238">map</tspan>
    </text>
    <rect x="76" y="120" width="230" height="36" rx="18" fill="#fffdf8" stroke="#fdba74" stroke-width="2"/>
    <text x="96" y="144" fill="#9a3412" font-size="17" font-weight="700" letter-spacing=".4">FREE FAMILY WEB APP</text>
    <text x="76" y="211" fill="#0f766e" font-size="18" font-weight="800" letter-spacing="2.2">${eyebrow}</text>
    <text x="76" y="${city ? 292 : 286}" fill="#263238" font-size="${titleSize}" font-weight="850" letter-spacing="-2.2">${titleMarkup}</text>
    <text x="76" y="${city ? 373 : 458}" fill="#475569" font-size="25" font-weight="500">Playgrounds • parks • libraries • museums</text>
    <text x="76" y="${city ? 411 : 496}" fill="#475569" font-size="25" font-weight="500">beaches • water play • trails • campgrounds</text>
    <g transform="translate(76 ${city ? 471 : 544})">
      <rect width="285" height="50" rx="25" fill="#263238"/>
      <text x="27" y="33" fill="#fffdf8" font-size="21" font-weight="750">open the map →</text>
    </g>

    <g filter="url(#shadow)">
      <rect x="755" y="70" width="390" height="500" rx="38" fill="url(#card)" stroke="#fff" stroke-width="5"/>
      ${illustration(seed)}
      <rect x="790" y="91" width="154" height="41" rx="20.5" fill="#fffdf8" stroke="#cbd5e1" stroke-width="2"/>
      <circle cx="816" cy="111.5" r="7" fill="#14b8a6"/>
      <text x="833" y="118" fill="#334155" font-size="18" font-weight="700">places nearby</text>
      <rect x="790" y="515" width="320" height="34" rx="17" fill="#fffdf8" opacity=".94"/>
      <text x="810" y="538" fill="#475569" font-size="16" font-weight="650">one clean map • no account needed</text>
    </g>
  </g>
</svg>`
}

function render(destination, options) {
  const svg = imageSvg(options)
  const png = new Resvg(svg, {
    fitTo: { mode: 'width', value: SOCIAL_IMAGE_WIDTH },
    font: { loadSystemFonts: true, defaultFontFamily: 'sans-serif' },
  }).render().asPng()
  writeFileSync(destination, png)
}

mkdirSync(OUT, { recursive: true })
for (const file of readdirSync(OUT)) {
  if (file.endsWith('.png')) rmSync(path.join(OUT, file))
}
rmSync(path.join(PUBLIC, 'og-image.png'), { force: true })

const published = METROS.filter((metro) => metro.published)
render(path.join(PUBLIC, HOME_SOCIAL_IMAGE_PATH), {})
for (const metro of published) {
  render(path.join(PUBLIC, metroSocialImagePath(metro)), { city: metro.label })
}

console.log(`Generated 1 home image and ${published.length} metro images in public/og/`)
