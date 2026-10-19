import type { Item, ItemStatus } from '@shared/types'
import { ADMIN_API_BASE } from '@/config/constants'

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${ADMIN_API_BASE}${path}`, {
    ...init,
    // CF Access cookies live on api.frolicmap.app; the admin SPA is served from
    // frolicmap.app. `credentials: 'include'` lets the browser ride those
    // cookies cross-origin. Worker-side CORS at `/api/admin/*` pairs with this.
    // Pinned to ADMIN_API_BASE (api.frolicmap.app) instead of API_BASE because
    // CF Access only intercepts the subdomain — see constants.ts comment.
    credentials: 'include',
    headers: { ...(init?.headers ?? {}), 'x-dev-admin': 'yes' },
  })
  if (!res.ok) throw new Error(`${path} ${res.status}`)
  return res.json() as Promise<T>
}

export interface AdminListOptions {
  region?: string
  sourceType?: string
  limit?: number
  offset?: number
}

export interface AdminFacets {
  regions: { value: string; n: number }[]
  sourceTypes: { value: string; n: number }[]
}

export interface AdminListResponse {
  items: Item[]
  total: number
  limit: number
  offset: number
  facets: AdminFacets
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

export const adminApi = {
  // Filtered + paginated (#368). `total` is the count behind the filter, not
  // the page size, so the UI can say "1–100 of 3,412" — the number that tells
  // a curator whether a national import just landed in their queue.
  listItems: (status: ItemStatus, opts: AdminListOptions = {}) => {
    const p = new URLSearchParams({ status })
    if (opts.region) p.set('region', opts.region)
    if (opts.sourceType) p.set('source_type', opts.sourceType)
    if (opts.limit != null) p.set('limit', String(opts.limit))
    if (opts.offset) p.set('offset', String(opts.offset))
    return http<AdminListResponse>(`/api/admin/items?${p}`)
  },
  getItem: (id: string) => http<{ item: Item }>(`/api/admin/items/${id}`),
  approve: (id: string) =>
    http<{ ok: boolean }>(`/api/admin/items/${id}/approve`, { method: 'POST' }),
  reject: (id: string) =>
    http<{ ok: boolean }>(`/api/admin/items/${id}/reject`, { method: 'POST' }),
  edit: (id: string, patch: Partial<Item>) =>
    http<{ item: Item }>(`/api/admin/items/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  listReports: (resolved: boolean) =>
    http<{ reports: { id: number; item_id: string; reason: string; note: string | null; created_at: string }[] }>(
      `/api/admin/reports?resolved=${resolved ? 1 : 0}`
    ),
  resolveReport: (id: number) =>
    http<{ ok: boolean }>(`/api/admin/reports/${id}/resolve`, { method: 'POST' }),
  ingestionLog: () =>
    http<{ log: { id: number; source_id: string; started_at: string; finished_at: string; fetched: number; inserted: number; updated: number; errors: string | null }[] }>(
      '/api/admin/ingestion-log'
    ),
  runCron: (source: 'osm') =>
    http<{
      source: string
      fetched?: number
      inserted?: number
      updated?: number
      errors?: string[]
      error?: string
    }>(`/api/admin/run/${source}`, { method: 'POST' }),
  observability: () =>
    http<{
      crons: {
        source_id: string
        schedule: string
        cadence: string
        last_run_at: string | null
        last_inserted: number | null
        last_updated: number | null
        last_errors: string[] | null
        days_since: number | null
        status: 'healthy' | 'late' | 'failed' | 'unknown'
      }[]
    }>('/api/admin/observability'),
}
