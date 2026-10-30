const SITE = 'https://frolicmap.app'

export const SOCIAL_IMAGE_WIDTH = 1200
export const SOCIAL_IMAGE_HEIGHT = 630

export const HOME_SOCIAL_IMAGE_PATH = '/og/frolicmap-home.png'
export const HOME_SOCIAL_IMAGE_URL = `${SITE}${HOME_SOCIAL_IMAGE_PATH}`
export const HOME_SOCIAL_IMAGE_ALT =
  'frolicmap, a family-friendly web app for finding kid-friendly places'

export function metroSocialImagePath(metro) {
  return `/og/frolicmap-${metro.slug}.png`
}

export function metroSocialImageUrl(metro) {
  return `${SITE}${metroSocialImagePath(metro)}`
}

export function metroSocialImageAlt(metro) {
  return `frolicmap, a family-friendly web app for finding kid-friendly places in ${metro.label}`
}
