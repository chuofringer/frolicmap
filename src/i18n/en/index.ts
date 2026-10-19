/**
 * The English resource tree — the single source of truth for both the UI and
 * the key types. `typeof en` is what every other locale is checked against, so
 * a translation that misses a key is a compile error, not a silent English
 * fallback at runtime (see `src/i18n/zh.ts`).
 *
 * Split per domain so that parallel work on different surfaces never edits the
 * same file. Add a namespace here only when you add a domain file.
 */
import { common } from './common'
import { categories } from './categories'
import { detail } from './detail'
import { time } from './time'
import { bar } from './bar'
import { filters } from './filters'
import { list } from './list'
import { search } from './search'
import { legend } from './legend'
import { faq } from './faq'
import { auth } from './auth'
import { calendar } from './calendar'
import { map } from './map'
import { metro } from './metro'
import { signup } from './signup'
import { pages } from './pages'
import { submit } from './submit'

export const en = {
  common,
  categories,
  detail,
  time,
  bar,
  filters,
  list,
  search,
  legend,
  faq,
  auth,
  calendar,
  map,
  metro,
  signup,
  pages,
  submit,
} as const

export type Resources = typeof en

/**
 * The shape every other locale must fill: same keys as English, all the way
 * down, but free to carry different text. `Resources` itself is `as const`, so
 * typing a translation as `Resources` would demand the *English literals* —
 * this widens the leaves back to `string` while keeping the keys exhaustive.
 *
 * A missing key is therefore a compile error rather than a silent fallback,
 * which is the same guarantee `CATEGORY_ORDER`'s `AssertEqual` gives for
 * categories (`src/config/categories.ts`).
 */
export type Translation = {
  [K in keyof Resources]: Resources[K] extends string ? string : {
    [J in keyof Resources[K]]: Resources[K][J] extends string ? string : {
      [L in keyof Resources[K][J]]: string
    }
  }
}
