/**
 * Date, time and recurrence phrasing used by detailHelpers — day names, RRULE grammar, relative labels, units.
 *
 * Owned by one workstream — keep additions inside this file so parallel
 * extraction work never collides. Values are the exact English text that was
 * previously hardcoded in the components listed above.
 *
 * `recurrence` is split into a plain variant and an `…At` variant (rather than
 * one template with an optional `{{time}}`) so each locale can place the time
 * phrase wherever its own grammar wants it — English appends " at {{time}}",
 * but that suffix pattern isn't a given in every language.
 */
export const time = {
  days: {
    sunday: 'Sundays',
    monday: 'Mondays',
    tuesday: 'Tuesdays',
    wednesday: 'Wednesdays',
    thursday: 'Thursdays',
    friday: 'Fridays',
    saturday: 'Saturdays',
  },
  ordinal: {
    last: 'last',
    // "{{ordinal}}" is itself the recursively-computed ordinal() output —
    // e.g. ordinal(-2) interpolates ordinal(2) = '2nd' to make '2nd-to-last'.
    toLast: '{{ordinal}}-to-last',
    first: '1st',
    second: '2nd',
    third: '3rd',
    nth: '{{n}}th',
  },
  bydaySeparator: ', ',
  bydayWithOrdinal: '{{ordinal}} {{day}}',
  recurrence: {
    weekly: 'Every {{days}}',
    weeklyAt: 'Every {{days}} at {{time}}',
    weeklyEveryOther: 'Every other {{days}}',
    weeklyEveryOtherAt: 'Every other {{days}} at {{time}}',
    weeklyEveryN: 'Every {{n}} weeks on {{days}}',
    weeklyEveryNAt: 'Every {{n}} weeks on {{days}} at {{time}}',
    monthly: 'Monthly on {{days}}',
    monthlyAt: 'Monthly on {{days}} at {{time}}',
    recurring: 'Recurring',
    recurringAt: 'Recurring at {{time}}',
    recurringWithDays: 'Recurring ({{days}})',
    recurringWithDaysAt: 'Recurring ({{days}}) at {{time}}',
  },
  ongoing: 'Ongoing',
} as const
