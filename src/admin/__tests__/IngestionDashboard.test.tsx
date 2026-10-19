// Cron health card for the quarterly OSM ingest.
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
]

const FIXTURE = { crons: FIXTURE_CRONS }

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
  it('renders the OSM job card', async () => {
    renderDashboard()
    await waitFor(() => expect(observability).toHaveBeenCalled())
    expect(await screen.findByText('osm')).toBeInTheDocument()
  })

  it('summary tiles count healthy/failed and rows added for the job', async () => {
    renderDashboard()
    await screen.findByText('osm')
    expect(screen.getByText('Healthy').parentElement).toHaveTextContent('1')
    expect(screen.getByText('Failed').parentElement).toHaveTextContent('0')
    expect(screen.getByText('Rows added').parentElement).toHaveTextContent('10')
  })

  it('offers a manual OSM run and no other cron triggers', async () => {
    renderDashboard()
    await screen.findByText('osm')
    expect(screen.getAllByRole('button', { name: 'Run now' })).toHaveLength(1)
    expect(screen.queryByText(/structured feeds|archive expired/i)).toBeNull()
  })
})
