/**
 * Simplified Chinese (zh-Hans) — #208.
 *
 * Loaded as its own chunk by `loadLocale()`, so the English bundle never ships
 * a translation it will not use. Split per domain to mirror `src/i18n/en/`.
 *
 * Each slice is typed as `Translation['<domain>']`, so adding an English string
 * without translating it here fails `tsc`. That is deliberate — a silent
 * English fallback inside a Chinese UI is exactly what this guard prevents.
 *
 * Item data (name / description / address) is NOT translated and renders in
 * English inside this UI, by design.
 */
import type { Translation } from '../en'
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

export const zh: Translation = {
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
}
