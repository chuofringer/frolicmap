import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '@/api/admin'
import { Tile, SectionCard, StatusBadge, EmptyState, type StatusTone } from './ui'

type CronSource = 'osm'

const CRONS: { id: CronSource; label: string; schedule: string; note: string }[] = [
  {
    id: 'osm',
    label: 'OSM (Overpass)',
    schedule: 'quarterly 03:00 UTC (Jan/Apr/Jul/Oct)',
    note: 'Places: playgrounds, parks, libraries, museums, aquariums, zoos, beaches, water play, hiking, campgrounds',
  },
]

type RunState = {
  status: 'idle' | 'running' | 'ok' | 'error'
  started?: number
  result?: { fetched?: number; inserted?: number; updated?: number; errors?: string[]; error?: string }
}

// Cron health string → status-badge tone + human label.
const HEALTH: Record<string, { tone: StatusTone; label: string }> = {
  healthy: { tone: 'green', label: 'healthy' },
  late: { tone: 'amber', label: 'late' },
  failed: { tone: 'red', label: 'failed' },
  unknown: { tone: 'gray', label: 'unknown' },
}
function health(status: string) {
  return HEALTH[status] ?? HEALTH.unknown
}

function formatDaysAgo(days: number | null): string {
  if (days === null) return '—'
  if (days < 1) {
    const hours = Math.floor(days * 24)
    return hours <= 1 ? 'just now' : `${hours}h ago`
  }
  return `${Math.floor(days)}d ago`
}

function formatLastRun(iso: string | null): string {
  if (!iso) return 'never'
  // Trim to 'YYYY-MM-DD HH:MM' for readability.
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/)
  return m ? `${m[1]} ${m[2]} UTC` : iso
}

export function IngestionDashboard() {
  const { data: logData } = useQuery({
    queryKey: ['admin', 'ingestion-log'],
    queryFn: () => adminApi.ingestionLog(),
  })
  const { data: obs } = useQuery({
    queryKey: ['admin', 'observability'],
    queryFn: () => adminApi.observability(),
    // Refresh on tab focus + every 60s — operator monitoring use.
    refetchInterval: 60000,
  })
  const rows = logData?.log ?? []
  const qc = useQueryClient()
  const [runStates, setRunStates] = useState<Record<CronSource, RunState>>({
    osm: { status: 'idle' },
  })

  const trigger = async (source: CronSource) => {
    setRunStates((s) => ({ ...s, [source]: { status: 'running', started: Date.now() } }))
    try {
      const result = await adminApi.runCron(source)
      const isOk = !result.error && (!result.errors || result.errors.length === 0)
      setRunStates((s) => ({
        ...s,
        [source]: { status: isOk ? 'ok' : 'error', result },
      }))
      await qc.invalidateQueries({ queryKey: ['admin', 'ingestion-log'] })
      await qc.invalidateQueries({ queryKey: ['admin', 'observability'] })
    } catch (err) {
      setRunStates((s) => ({
        ...s,
        [source]: {
          status: 'error',
          result: { error: err instanceof Error ? err.message : String(err) },
        },
      }))
    }
  }

  const crons = obs?.crons ?? []
  const healthy = crons.filter((c) => c.status === 'healthy').length
  const late = crons.filter((c) => c.status === 'late').length
  const failed = crons.filter((c) => c.status === 'failed').length
  const rowsAdded = crons.reduce((sum, c) => sum + (c.last_inserted ?? 0), 0)

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold">Cron health</h2>
          <p className="text-sm text-gray-500 mt-1">
            At-a-glance status of the quarterly OSM ingest.{' '}
            <span className="text-gray-400">green = within cadence, no errors</span> ·{' '}
            <span className="text-gray-400">amber = past expected cadence</span> ·{' '}
            <span className="text-gray-400">red = errors or past 2× cadence</span> ·{' '}
            <span className="text-gray-400">gray = never run</span>.
            Repeated failures are logged by the Worker.
          </p>
        </div>

        {obs && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Tile label="Healthy" value={healthy} />
            <Tile label="Late" value={late} accent={late > 0} />
            <Tile label="Failed" value={failed} />
            <Tile label="Rows added" value={rowsAdded} hint="latest run per job" />
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {crons.map((c) => {
            const h = health(c.status)
            return (
              <div key={c.source_id} className="border rounded-lg p-4 bg-white">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className="font-semibold text-sm text-gray-800 truncate" title={c.source_id}>
                    {c.source_id}
                  </span>
                  <StatusBadge tone={h.tone}>{h.label}</StatusBadge>
                </div>
                <div className="text-xs text-gray-500 mb-3">
                  {c.cadence} · <code className="text-[10px]">{c.schedule}</code>
                </div>
                <div className="flex items-baseline justify-between text-xs">
                  <span className="text-gray-500">Last run</span>
                  <span className="text-gray-800 font-medium tabular-nums">
                    {formatDaysAgo(c.days_since)}
                  </span>
                </div>
                <div className="text-[11px] text-gray-400 text-right">{formatLastRun(c.last_run_at)}</div>
                {c.last_run_at && (
                  <div className="text-xs text-gray-500 mt-2 flex gap-3">
                    <span>inserted <b className="text-gray-700 tabular-nums">{c.last_inserted ?? 0}</b></span>
                    <span>updated <b className="text-gray-700 tabular-nums">{c.last_updated ?? 0}</b></span>
                  </div>
                )}
                {c.last_errors && c.last_errors.length > 0 && (
                  <div
                    className="text-red-700 text-xs mt-2 truncate"
                    title={c.last_errors.join('\n')}
                  >
                    {c.last_errors.length} error{c.last_errors.length > 1 ? 's' : ''}: {c.last_errors[0]}
                  </div>
                )}
              </div>
            )
          })}
          {!obs && <div className="col-span-full text-sm text-gray-500">Loading cron health…</div>}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold">Trigger ingest manually</h2>
          <p className="text-sm text-gray-500 mt-1">
            Runs the handler immediately in production and writes an ingestion_log row. Useful to
            verify fixes without waiting for the next quarterly run.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {CRONS.map((cron) => {
            const s = runStates[cron.id]
            const running = s.status === 'running'
            const r = s.result
            return (
              <div key={cron.id} className="border rounded-lg p-4 bg-white flex flex-col">
                <div className="flex-1">
                  <div className="font-semibold text-sm text-gray-800">{cron.label}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{cron.schedule}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{cron.note}</div>
                </div>
                <button
                  type="button"
                  onClick={() => void trigger(cron.id)}
                  disabled={running}
                  className="mt-3 w-full px-3 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300 transition-colors"
                >
                  {running ? 'Running…' : 'Run now'}
                </button>
                {r && (
                  <div className={`mt-3 text-xs ${s.status === 'error' ? 'text-red-700' : 'text-gray-700'}`}>
                    {r.error ? (
                      <div>Error: {r.error}</div>
                    ) : (
                      <>
                        <div>
                          fetched <b>{r.fetched ?? 0}</b> · inserted <b>{r.inserted ?? 0}</b> ·
                          updated <b>{r.updated ?? 0}</b>
                        </div>
                        {r.errors && r.errors.length > 0 && (
                          <ul className="mt-1 list-disc list-inside text-red-700">
                            {r.errors.map((e, i) => (
                              <li key={i} className="truncate">
                                {e}
                              </li>
                            ))}
                          </ul>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      <SectionCard title="Ingestion log" hint="Latest 50 runs, newest first">
        {rows.length === 0 ? (
          <EmptyState>No ingestion runs logged yet.</EmptyState>
        ) : (
          <div className="overflow-auto max-h-[28rem] rounded-lg border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="text-left bg-gray-50 border-b text-xs text-gray-500 uppercase tracking-wide">
                  <th className="py-2 px-3">Source</th>
                  <th className="py-2 px-3">Started</th>
                  <th className="py-2 px-3 text-right">Fetched</th>
                  <th className="py-2 px-3 text-right">Inserted</th>
                  <th className="py-2 px-3 text-right">Updated</th>
                  <th className="py-2 px-3">Errors</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b last:border-b-0 even:bg-gray-50/60">
                    <td className="py-2 px-3 font-medium text-gray-800">{r.source_id}</td>
                    <td className="py-2 px-3 text-gray-500 tabular-nums whitespace-nowrap">{r.started_at}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-gray-700">{r.fetched}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-gray-700">{r.inserted}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-gray-700">{r.updated}</td>
                    <td className={'py-2 px-3 ' + (r.errors ? 'text-red-600' : 'text-gray-400')}>
                      {r.errors ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  )
}
