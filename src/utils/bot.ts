// Heuristic bot detection — used to skip onboarding affordances for crawlers
// so we don't trip Google's "intrusive interstitial" mobile ranking penalty.
export function isLikelyBot(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return /bot|crawl|spider|slurp|mediapartners|facebookexternalhit|twitterbot|googlebot|bingbot|duckduckbot/i.test(ua)
}

export const WELCOME_KEY = 'funradar.welcome-seen'

export function welcomeSeen(): boolean {
  try { return localStorage.getItem(WELCOME_KEY) === '1' } catch { return true }
}

export function dismissWelcome(): void {
  try { localStorage.setItem(WELCOME_KEY, '1') } catch { /* private mode */ }
}

// Waitlist slide-in (issue #244). Two flags: a 30-day dismissal expiry
// and a permanent submitted marker. Storage key style matches the issue
// spec (`funradar:` colon prefix) — intentionally distinct from the
// dot-prefixed `WELCOME_KEY` above so the two surfaces stay independent.
export const WAITLIST_DISMISSED_KEY = 'funradar:waitlist-dismissed-until'
export const WAITLIST_SUBMITTED_KEY = 'funradar:waitlist-submitted'
const WAITLIST_DISMISS_DAYS = 30

export function waitlistDismissed(now: number = Date.now()): boolean {
  try {
    const v = localStorage.getItem(WAITLIST_DISMISSED_KEY)
    if (!v) return false
    const until = Number(v)
    if (!Number.isFinite(until)) return false
    return now < until
  } catch { return true }
}

export function dismissWaitlist(now: number = Date.now()): void {
  try {
    const until = now + WAITLIST_DISMISS_DAYS * 24 * 60 * 60 * 1000
    localStorage.setItem(WAITLIST_DISMISSED_KEY, String(until))
  } catch { /* private mode */ }
}

// First-visit welcome sign-in overlay (2026-07-26). Once per device — a
// returning guest already made the guest/sign-in choice; re-asking every
// visit is how apps get deleted. Private mode (storage throws) counts as
// seen: an overlay that reappears on every load is worse than one that
// never shows, and the per-event gate still catches those visitors.
export const WELCOME_GATE_KEY = 'funradar:welcome-gate-seen'

export function welcomeGateSeen(): boolean {
  try { return localStorage.getItem(WELCOME_GATE_KEY) === '1' } catch { return true }
}

export function markWelcomeGateSeen(): void {
  try { localStorage.setItem(WELCOME_GATE_KEY, '1') } catch { /* private mode */ }
}

// One email ask per session (2026-07-26 UX review). The waitlist slide-in's
// 20s timer runs WHILE the welcome gate is open, so a guest who read the
// sign-in pitch and declined could get the newsletter box seconds later —
// two email asks back to back. sessionStorage (not localStorage): the
// suppression covers only the session where the gate showed; on the next
// visit the gate never shows again and the slide-in gets its normal turn.
export const WELCOME_GATE_SESSION_KEY = 'funradar:welcome-gate-session'

export function welcomeGateShownThisSession(): boolean {
  try { return sessionStorage.getItem(WELCOME_GATE_SESSION_KEY) === '1' } catch { return false }
}

export function markWelcomeGateShownThisSession(): void {
  try { sessionStorage.setItem(WELCOME_GATE_SESSION_KEY, '1') } catch { /* private mode */ }
}

export function waitlistSubmitted(): boolean {
  try { return localStorage.getItem(WAITLIST_SUBMITTED_KEY) === '1' } catch { return true }
}

export function markWaitlistSubmitted(): void {
  try { localStorage.setItem(WAITLIST_SUBMITTED_KEY, '1') } catch { /* private mode */ }
}

// Popup signup CTA dismiss flag (issue #251, third conversion surface). A
// 7-day expiry — shorter than the slide-in's 30 days — because this surface
// only shows to visitors who've already opened ≥2 popups this session: a
// power user is more likely to return within the week, and cumulative
// annoyance across many popup views per session is the real risk here, not
// a single 30-day silence. Same expiry-timestamp pattern as
// `waitlistDismissed`/`dismissWaitlist` above.
export const POPUP_CTA_DISMISSED_KEY = 'funradar:popup-cta-dismissed-until'
const POPUP_CTA_DISMISS_DAYS = 7

export function popupCtaDismissed(now: number = Date.now()): boolean {
  try {
    const v = localStorage.getItem(POPUP_CTA_DISMISSED_KEY)
    if (!v) return false
    const until = Number(v)
    if (!Number.isFinite(until)) return false
    return now < until
  } catch { return true }
}

export function dismissPopupCta(now: number = Date.now()): void {
  try {
    const until = now + POPUP_CTA_DISMISS_DAYS * 24 * 60 * 60 * 1000
    localStorage.setItem(POPUP_CTA_DISMISSED_KEY, String(until))
  } catch { /* private mode */ }
}

// Cross-surface "one passive ask per session" flag (issue #213, rainy-day
// banner), extending the WelcomeGate-vs-WaitlistSlideIn coordination above
// (`WELCOME_GATE_SESSION_KEY`) to a THIRD passive surface. Whichever of
// WelcomeGate / WaitlistSlideIn / RainyDayBanner actually renders first in a
// session marks this; the others treat that as "someone already asked" and
// stay quiet for the rest of the session. A separate key from
// `WELCOME_GATE_SESSION_KEY` on purpose — that one stays load-bearing on its
// own for the gate's existing tests/behavior; this is additive, and the gate
// sets both.
export const PASSIVE_ASK_SESSION_KEY = 'funradar:passive-ask-shown-session'

export function passiveAskShownThisSession(): boolean {
  try { return sessionStorage.getItem(PASSIVE_ASK_SESSION_KEY) === '1' } catch { return false }
}

export function markPassiveAskShownThisSession(): void {
  try { sessionStorage.setItem(PASSIVE_ASK_SESSION_KEY, '1') } catch { /* private mode */ }
}

// Rainy-day banner (issue #213). Dismissal is time-boxed rather than
// permanent like `WELCOME_KEY`/`WAITLIST_SUBMITTED_KEY`: the whole point is
// to resurface on the NEXT rainy day, not vanish forever after one dismiss.
// 6 hours comfortably covers "the rest of today's rain" without also
// covering tomorrow's, so a multi-day storm still re-prompts once daily.
export const RAINY_DISMISSED_KEY = 'funradar:rainy-dismissed-until'
const RAINY_DISMISS_HOURS = 6

export function rainyDismissed(now: number = Date.now()): boolean {
  try {
    const v = localStorage.getItem(RAINY_DISMISSED_KEY)
    if (!v) return false
    const until = Number(v)
    if (!Number.isFinite(until)) return false
    return now < until
  } catch { return true }
}

export function dismissRainy(now: number = Date.now()): void {
  try {
    const until = now + RAINY_DISMISS_HOURS * 60 * 60 * 1000
    localStorage.setItem(RAINY_DISMISSED_KEY, String(until))
  } catch { /* private mode */ }
}
