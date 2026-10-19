/**
 * Waitlist and support surfaces: WaitlistSlideIn (the coming-soon newsletter
 * form + its submitted state) and CoffeeButton. (SignupPage and the
 * SignupEnvelopeButton were retired 2026-08-09 — the newsletter surface is
 * now the opt-in checkbox on the sign-in gates, copy in `auth.ts`.)
 *
 * Owned by one workstream — keep additions inside this file so parallel
 * extraction work never collides.
 */
export const signup = {
  waitlistDialogAriaLabel: 'Newsletter waitlist signup',
  submittedHeadline: 'You’re on the list.',
  submittedBody: 'Check your inbox for a welcome note.',
  heading: 'Newsletter launching soon',
  dismissAriaLabel: 'Dismiss waitlist signup',
  body: 'A weekly roundup of the best kids activities in your city. Drop your email, pick your city, and we’ll let you know when it’s live.',
  chooseYourCityAriaLabel: 'Choose your city',
  chooseYourCityPlaceholder: 'Choose your city…',
  emailPlaceholder: 'you@example.com',
  emailAriaLabel: 'Email address',
  joinButton: 'Join',
  submittingEllipsis: '…',
  genericError: 'Try again.',
  coffeeButtonLabel: 'Support funradar — Buy Me a Coffee',
} as const
