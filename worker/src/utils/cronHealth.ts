// Cron health card classification (issue #197, extended #273). Pulled out
// of routes/admin.ts into a pure module so the seasonal-pause branch (upick
// only runs Apr–Oct) can be unit-tested with an injected `nowMs` instead of
// mocking Date inside a Miniflare-dispatched request — `vi.setSystemTime`
// mocks the vitest process's Date, not the separate isolate `SELF.fetch`
// runs the Worker in, so date-dependent branches here must take `now` as a
// parameter to be testable at all.
//
// Covers 3 Worker crons + 2 Claude Code Desktop routines (aggregators,
// upick) — all 5 log to `ingestion_log`. (The triage routine, formerly a
// 6th leg, was retired 2026-07-18 — PR #364 — before it ever wrote to D1, so
// it's out of scope.) The routines' `logRun`-equivalent rows are emitted as
// an `INSERT INTO ingestion_log` statement inside the SQL the GH Action
// merge workflow applies to D1 (`worker/scripts/merge-aggregators.mjs` /
// `worker/scripts/merge-upick.mjs`) — there's no live Worker code path for a
// routine run, so the merge script is the only place that knows the run
// happened.
//
// Status chip rules:
//   🟢 healthy  — last run within expected cadence × 1 + no errors
//   🟡 late     — past cadence × 1 but within × 2, no errors
//   🔴 failed   — last run has errors, OR past cadence × 2
//   ⚪ unknown  — never run, OR (routines only) currently out of season
export interface CadenceConfig {
  schedule: string
  cadence: string
  cadenceDays: number
  seasonalMonths?: number[]
}

export const CRON_CADENCES: Record<string, CadenceConfig> = {
  osm: {
    schedule: '0 3 1 */3 *',
    cadence: 'quarterly',
    cadenceDays: 91, // ~3 months
  },
  'structured-feeds': {
    schedule: '0 4 * * MON',
    cadence: 'weekly',
    cadenceDays: 7,
  },
  'archive-expired': {
    schedule: '0 8 * * *',
    cadence: 'daily',
    cadenceDays: 1,
  },
  // Claude Code Desktop routines (not Worker crons — see CLAUDE.md "Claude
  // Code routine pattern"). Both PR-merge-triggered via a GH Action; no
  // `/api/admin/run/*` manual-trigger handler exists for either.
  aggregators: {
    schedule: 'Tue 21:00 PT (weekly Claude Code routine)',
    cadence: 'weekly',
    cadenceDays: 7,
  },
  upick: {
    schedule: 'Mon 21:00 PT (weekly Apr–Oct Claude Code routine)',
    cadence: 'weekly, Apr–Oct',
    cadenceDays: 7,
    // U-Pick pauses Nov–Mar (no farms in season, so no routine run is
    // expected). Outside these months the card shows 'unknown' instead of
    // flagging a real cron as late/failed for an intentional pause.
    seasonalMonths: [4, 5, 6, 7, 8, 9, 10],
  },
}

export interface CronLogRow {
  started_at: string
  fetched: number
  inserted: number
  updated: number
  errors: string | null
}

export interface CronHealth {
  source_id: string
  schedule: string
  cadence: string
  last_run_at: string | null
  last_inserted: number | null
  last_updated: number | null
  last_errors: string[] | null
  days_since: number | null
  status: 'healthy' | 'late' | 'failed' | 'unknown'
}

export function classifyCron(
  id: string,
  cadence: CadenceConfig,
  last: CronLogRow | undefined,
  nowMs: number
): CronHealth {
  if (!last) {
    return {
      source_id: id,
      schedule: cadence.schedule,
      cadence: cadence.cadence,
      last_run_at: null,
      last_inserted: null,
      last_updated: null,
      last_errors: null,
      days_since: null,
      status: 'unknown',
    }
  }
  const startedMs = Date.parse(last.started_at)
  const daysSince = Number.isFinite(startedMs) ? (nowMs - startedMs) / 86400000 : null
  let errorList: string[] | null = null
  if (last.errors) {
    try {
      const parsed = JSON.parse(last.errors)
      errorList = Array.isArray(parsed) ? parsed : null
    } catch {
      errorList = [last.errors]
    }
  }
  const hasErrors = (errorList?.length ?? 0) > 0
  // Off-season check (upick only): the routine isn't expected to run
  // outside Apr–Oct, so an overdue-looking last run there is not a real
  // signal — surface 'unknown' instead of a false late/failed.
  const nowMonth = new Date(nowMs).getUTCMonth() + 1 // 1-12
  const inSeason = !cadence.seasonalMonths || cadence.seasonalMonths.includes(nowMonth)
  let status: CronHealth['status'] = 'healthy'
  if (hasErrors) {
    status = 'failed'
  } else if (!inSeason) {
    status = 'unknown'
  } else if (daysSince !== null) {
    if (daysSince > cadence.cadenceDays * 2) status = 'failed'
    else if (daysSince > cadence.cadenceDays) status = 'late'
  }
  return {
    source_id: id,
    schedule: cadence.schedule,
    cadence: cadence.cadence,
    last_run_at: last.started_at,
    last_inserted: last.inserted,
    last_updated: last.updated,
    last_errors: errorList,
    days_since: daysSince,
    status,
  }
}
