/**
 * User submissions — "Suggest a place or event" (#226): the IconBar entry
 * button, the SubmitModal (guest sign-in prompt + the member form), and its
 * success/error states.
 *
 * Owned by one workstream — keep additions inside this file so parallel work
 * never collides.
 */
export const submit = {
  openButtonLabel: 'Suggest a place or event',
  dialogAriaLabel: 'Suggest a place or event',
  closeAriaLabel: 'Close',
  heading: 'Suggest a place or event',
  signInPrompt: 'Sign in to suggest a place',
  typeLabel: 'What is it?',
  typePlace: 'Place',
  typeEvent: 'Event',
  nameLabel: 'Name',
  namePlaceholder: 'e.g. Willow Glen Park playground',
  categoryLabel: 'Category',
  addressLabel: 'Address',
  addressPlaceholder: 'Street address (optional but helpful)',
  useMapCenterButton: 'Use map center',
  coordinatesHint: 'Location: {{lat}}, {{lng}}',
  websiteLabel: 'Website',
  websitePlaceholder: 'https://…',
  descriptionLabel: 'Description',
  descriptionPlaceholder: "What makes this worth adding? What's it like?",
  startTimeLabel: 'Starts',
  endTimeLabel: 'Ends',
  costLabel: 'Cost',
  costFree: 'Free',
  costPaid: 'Paid',
  costUnspecified: 'Not sure',
  submitButton: 'Submit for review',
  submittingButton: 'Submitting…',
  successMessage: 'Thanks — a curator will review it.',
  genericError: 'Something went wrong. Please try again.',
  nameRequiredError: 'Please enter a name.',
  locationRequiredError: 'Please set a location.',
  outsideMetroError: "That location is outside any city we cover yet.",
  rateLimitError: 'Too many attempts — please wait a minute and try again.',
  tooManyPendingError: "You have several suggestions still awaiting review. Please wait for those before submitting more.",
  signInExpiredError: 'Your sign-in has expired. Please sign in again to submit.',
} as const
