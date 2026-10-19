// Cron health card (issue #273 — surfaces the 2 Claude Code Desktop routines
// alongside the 3 Worker crons). No prior test file existed for this
// component; mocking follows the pattern in BehaviorView.test.tsx.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const observability = vi.fn()
const ingestionLog = vi.fn()
const runCron = vi.fn()
vi.mock('@/api/admin', () => ({
  adminApi: {
    observability: (...a: unknown[]) => observability(...a),
    ingestionLog: (...a: unknown[]) => ingestionLog(...a),
    runCron: (...a: unknown[]) => runCron(...a),
  },
}))

import { IngestionDashboard } from '../IngestionDashboard'

type Cron = {
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

// All 5 scheduled jobs (issue #273 done-when #1): 3 Worker crons + the 2
// routines (aggregators, upick).
const FIXTURE_CRONS: Cron[] = [
  {
    source_id: 'osm',
    schedule: '0 3 1 */3 *',
    cadence: 'quarterly',
    last_run_at: '2026-07-01T03:00:00.000Z',
    last_inserted: 10,
    last_updated: 2,
    last_errors: null,
    days_since: 20,
    status: 'healthy',
  },
  {
    source_id: 'structured-feeds',
    schedule: '0 4 * * MON',
    cadence: 'weekly',
    last_run_at: '2026-08-18T04:00:00.000Z',
    last_inserted: 5,
    last_updated: 1,
    last_errors: null,
    days_since: 4,
    status: 'healthy',
  },
  {
    source_id: 'archive-expired',
    schedule: '0 8 * * *',
    cadence: 'daily',
    last_run_at: '2026-08-22T08:00:00.000Z',
    last_inserted: 0,
    last_updated: 3,
    last_errors: null,
    days_since: 0.1,
    status: 'healthy',
  },
  {
    source_id: 'aggregators',
    schedule: 'Tue 21:00 PT (weekly Claude Code routine)',
    cadence: 'weekly',
    last_run_at: '2026-08-19T04:00:00.000Z',
    last_inserted: 38,
    last_updated: 0,
    last_errors: null,
    days_since: 3,
    status: 'healthy',
  },
  {
    source_id: 'upick',
    schedule: 'Mon 21:00 PT (weekly Apr–Oct Claude Code routine)',
    cadence: 'weekly, Apr–Oct',
    last_run_at: null,
    last_inserted: null,
    last_updated: null,
    last_errors: null,
    days_since: null,
    status: 'unknown',
  },
]

const FIXTURE = {
  crons: FIXTURE_CRONS,
  outbound_clicks: { total_last_30d: 0, top_hosts: [] },
}

const renderDashboard = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <IngestionDashboard />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  observability.mockReset()
  ingestionLog.mockReset()
  observability.mockResolvedValue(FIXTURE)
  ingestionLog.mockResolvedValue({ log: [] })
})
afterEach(() => cleanup())

describe('IngestionDashboard cron health card', () => {
  it('renders all 5 scheduled jobs — 3 Worker crons + aggregators + upick', async () => {
    renderDashboard()
    await waitFor(() => expect(observability).toHaveBeenCalled())

    for (const id of ['osm', 'structured-feeds', 'archive-expired', 'aggregators', 'upick']) {
      expect(await screen.findByText(id)).toBeInTheDocument()
    }
  })

  it('shows routine-managed rows-inserted counts on the aggregators card', async () => {
    renderDashboard()
    await screen.findByText('aggregators')
    expect(screen.getByText('38')).toBeInTheDocument()
  })

  it('upick shows the unknown/gray chip + "never" when off-season with no logged run', async () => {
    renderDashboard()
    await screen.findByText('upick')
    expect(screen.getByText('unknown')).toBeInTheDocument()
    expect(screen.getByText('never')).toBeInTheDocument()
  })

  it('summary tiles count healthy/failed across all 5 jobs, not just the 3 Worker crons', async () => {
    renderDashboard()
    await screen.findByText('upick')
    // 4 healthy (osm, structured-feeds, archive-expired, aggregators); upick is
    // unknown (off-season, never run) so it counts toward neither healthy nor failed.
    const healthyTile = screen.getByText('Healthy').parentElement
    expect(healthyTile).toHaveTextContent('4')
    const failedTile = screen.getByText('Failed').parentElement
    expect(failedTile).toHaveTextContent('0')
    // Rows added tile sums last_inserted across all 5 (10+5+0+38+null→0 = 53).
    const rowsTile = screen.getByText('Rows added').parentElement
    expect(rowsTile).toHaveTextContent('53')
  })
})
