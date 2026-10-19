/**
 * Events sign-in gate + accounts (PR #511): WelcomeGate, EventUnlockCard,
 * AuthOptions, GoogleSignInButton fallback button, SignInToast, the sign-in
 * nudge variant of WaitlistSlideIn, and the chip/legend lock glyphs.
 *
 * Owned by one workstream — keep additions inside this file so parallel work
 * never collides. Values are the exact English text that was previously
 * hardcoded in the components listed above.
 */
export const auth = {
  signInWithGoogle: 'Sign in with Google',
  signInToUnlock: 'Sign in to unlock',
  gatedEventAriaLabel: 'Event — sign in to unlock',
  signingIn: 'Signing you in…',
  newsletterOptInLabel: 'Email me the weekly events roundup — coming soon',
  googleUnavailable: 'Google sign-in couldn’t load here. Please try again on funradar.app.',
  googleFailed: 'Google sign-in didn’t complete. Please try again.',
  // WelcomeGate
  welcomeAriaLabel: 'Welcome to funradar',
  welcomePitch: 'A free map of kid-friendly places near you — playgrounds, parks, museums and more.',
  welcomeUnlockLead: 'Sign in with Google to unlock our',
  welcomeUnlockHighlight: 'hand-curated weekly events list',
  welcomeUnlockTail: ' — free, one tap.',
  continueAsGuest: 'Continue as guest',
  guestFootnote: 'Guests see the whole map — events stay locked',
  guestFootnoteTail: 'until you sign in.',
  // EventUnlockCard
  // #645: frame the unlock as the trip ask — what signing in GETS the parent
  // (the time + directions), not what it is (an account).
  unlockEventTitle: 'Sign in to get the time and directions',
  unlockEventBody: 'Our hand-curated weekly events are free for signed-in members — one tap shows when it starts and how to get there.',
  noThanks: 'No thanks',
  // SignInToast
  signedInAs: 'You’re signed in as {{email}}.',
  signedIn: 'You’re signed in.',
  eventsUnlocked: 'Weekly events are unlocked.',
  dismiss: 'Dismiss',
  // Sign-in nudge (WaitlistSlideIn variant)
  nudgeAriaLabel: 'Sign in to unlock events',
  nudgeDismissLabel: 'Dismiss sign-in reminder',
  nudgeTitle: 'Unlock this week’s events',
  nudgeBody: 'Our hand-curated weekly events list is free with a quick Google sign-in.',
  // Popup signup CTA (ItemPopupSignupCTA, issue #251)
  popupCtaAriaLabel: 'Sign in for the weekly digest',
  popupCtaText: 'Get a weekly digest of picks like this — sign in',
  popupCtaDismissLabel: 'Dismiss weekly digest reminder',
} as const
