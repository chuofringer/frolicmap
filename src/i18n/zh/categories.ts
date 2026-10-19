import type { Translation } from '../en'

/**
 * The legend vocabulary in Simplified Chinese — same entries as English,
 * hardcoded and verbatim, identical for every city. Never derived from the
 * data, never abbreviated into an "& More". (`zoo` folds into the combined
 * aquarium chip, same as English — see src/i18n/en/categories.ts.)
 * data, never abbreviated into an "& More".
 *
 * Category slugs stay English (`?cat=playground`); only these labels change.
 */
export const categories: Translation['categories'] = {
  playground: '儿童游乐场',
  museum: '博物馆',
  library: '图书馆',
  park: '公园',
  aquarium: '水族馆/动物园',
  zoo: '动物园',
  beach: '海滩',
  waterplay: '戏水乐园',
  hiking: '徒步路线',
  campground: '露营地',
}
