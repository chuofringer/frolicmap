// Heuristic bot detection, used to skip onboarding affordances and analytics
// for crawlers so we don't trip Google's "intrusive interstitial" mobile
// ranking penalty.
export function isLikelyBot(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return /bot|crawl|spider|slurp|mediapartners|facebookexternalhit|twitterbot|googlebot|bingbot|duckduckbot/i.test(ua)
}

export const WELCOME_KEY = 'frolicmap.welcome-seen'

export function welcomeSeen(): boolean {
  try { return localStorage.getItem(WELCOME_KEY) === '1' } catch { return true }
}

export function dismissWelcome(): void {
  try { localStorage.setItem(WELCOME_KEY, '1') } catch { /* private mode */ }
}
