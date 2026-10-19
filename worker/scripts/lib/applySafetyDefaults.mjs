// Shared safety defaults for merge-to-D1 scripts (merge-bakf, merge-scraped, …).
// Every script that emits INSERT rows from LLM/agent extractions should route
// its `status` field through `resolveStatus` so the same safety net applies.

/**
 * A dateless event has `type='event'` but no start_time, end_time, or rrule.
 * It can't be filtered by "Today" / "This Weekend" (the time utils skip rows
 * with null timestamps) and can't be archived by `runArchiveExpired` (that
 * requires a past `end_time`), so it would sit on the map forever. Route these
 * to the admin queue instead.
 */
export function isDatelessEvent(row) {
  return row.type === 'event' && !row.start_time && !row.end_time && !row.rrule
}

/**
 * Pick the safe final `status` for a row, defaulting to `defaultStatus` except
 * when `isDatelessEvent` — then forces `pending` so a human dates or rejects it.
 *
 * Extend here (not in individual merge scripts) when a new class of row needs a
 * pending-by-default rule.
 */
export function resolveStatus(row, defaultStatus = 'approved') {
  if (isDatelessEvent(row)) return 'pending'
  return defaultStatus
}
