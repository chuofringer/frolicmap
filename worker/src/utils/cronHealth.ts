// Cron health card classification (issue #197). Kept as a pure module so
// date-dependent branches take `now` as a parameter and are unit-testable:
// `vi.setSystemTime` mocks the vitest process's Date, not the separate
// isolate `SELF.fetch` runs the Worker in.
//
// The only cron is the quarterly OSM ingest, which logs to `ingestion_log`
// under source id `osm`.
//
// Status chip rules:
//   🟢 healthy  — last run within expected cadence × 1 + no errors
//   🟡 late     — past cadence × 1 but within × 2, no errors
//   🔴 failed   — last run has errors, OR past cadence × 2
//   ⚪ unknown  — never run, OR currently out of season (`seasonalMonths`)
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
  // Off-season check (only for a cadence that sets `seasonalMonths`): a run
  // isn't expected outside those months, so an overdue-looking last run is
  // not a real signal. Surface 'unknown' instead of a false late/failed.
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
