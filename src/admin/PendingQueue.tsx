import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '@/api/admin'
import { Link } from 'react-router-dom'
import { CATEGORIES, CATEGORY_ORDER, categoryLabel } from '@/config/categories'
import { getMetro, timezoneForRegion } from '@shared/metros'
import type { Category, Confidence, Item } from '@shared/types'
import { parseEventTime } from '@/utils/venueTime'

const PAGE_SIZE = 100

// Confidence → pill styling. high = trustworthy (green), medium = amber,
// low = needs a look (gray).
const CONFIDENCE_STYLE: Record<Confidence, string> = {
  high: 'bg-green-100 text-green-800',
  medium: 'bg-amber-100 text-amber-800',
  low: 'bg-gray-100 text-gray-600',
}

export function PendingQueue() {
  const qc = useQueryClient()
  // Defaults to All regions. It used to default to 'bay' (#368, when the queue
  // was a Bay curation workflow), but that silently broke the national queue:
  // when no Bay rows are pending, 'bay' isn't among the region facets, so a
  // `<select value="bay">` with no matching <option> DISPLAYS "All regions"
  // (the first option) while the state is still 'bay' — the query filters by
  // bay and shows nothing, and re-picking "All regions" fires no change event
  // because the browser already shows it selected. The queue is national now;
  // showing everything pending on open is both correct and unbreakable.
  const [region, setRegion] = useState<string>('')
  const [sourceType, setSourceType] = useState<string>('')
  const [offset, setOffset] = useState(0)

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'items', 'pending', region, sourceType, offset],
    queryFn: () => adminApi.listItems('pending', {
      region: region || undefined,
      sourceType: sourceType || undefined,
      limit: PAGE_SIZE,
      offset,
    }),
  })
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'items', 'pending'] })
  const approve = useMutation({ mutationFn: adminApi.approve, onSuccess: invalidate })
  const reject = useMutation({ mutationFn: adminApi.reject, onSuccess: invalidate })
  // Server-side bulk approve of everything behind the current filter (all
  // pages, one UPDATE). The confirm names the filter so a curator on "All
  // regions" knows they're about to approve the whole national queue.
  const approveAll = useMutation({
    mutationFn: () => adminApi.approveAll({ region: region || undefined, sourceType: sourceType || undefined }),
    onSuccess: async (res) => {
      await invalidate()
      setOffset(0)
      const held = (res.held ?? []).map((h) => `${h.source_type} (${h.pending.toLocaleString()} rows, ${h.accuracy}% — ${h.tier})`)
      const unsampled = (res.unsampled ?? []).map((u) => `${u.source_type} (${u.pending.toLocaleString()})`)
      window.alert(
        `Approved ${res.approved.toLocaleString()} item${res.approved === 1 ? '' : 's'}.` +
          (held.length ? `\n\nHELD pending (quality gate, sample accuracy below 95%): ${held.join(', ')}` : '') +
          (unsampled.length ? `\n\nApproved WITHOUT a quality sample: ${unsampled.join(', ')}` : ''),
      )
    },
  })
  function confirmApproveAll(count: number) {
    const scope = [region && `region ${region}`, sourceType && `source ${sourceType}`].filter(Boolean).join(', ') || 'ALL regions and sources'
    if (!window.confirm(`Approve ALL ${count.toLocaleString()} pending items (${scope})? This covers every page, not just this one.`)) return
    approveAll.mutate()
  }

  function changeFilter(next: () => void) {
    // Any filter change invalidates the current page number — offset 200 of a
    // 3,000-row queue is meaningless once you filter down to 40.
    setOffset(0)
    next()
  }

  const [bulkRunning, setBulkRunning] = useState(false)
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number; failed: number } | null>(null)

  async function bulkApprove(targets: Item[]) {
    if (targets.length === 0) return
    if (!window.confirm(`Approve ${targets.length} item${targets.length === 1 ? '' : 's'}?`)) return
    setBulkRunning(true)
    setBulkProgress({ done: 0, total: targets.length, failed: 0 })
    let done = 0
    let failed = 0
    // Sequential to keep worker rate-limits happy and surface accurate progress.
    for (const it of targets) {
      try {
        await adminApi.approve(it.id)
      } catch {
        failed += 1
      }
      done += 1
      setBulkProgress({ done, total: targets.length, failed })
    }
    await invalidate()
    setBulkRunning(false)
    if (failed > 0) {
      window.alert(`Approved ${done - failed}/${targets.length}. ${failed} failed — refresh to see what's left.`)
    }
  }

  if (isLoading) return <div>Loading…</div>
  const items = data?.items ?? []
  const total = data?.total ?? 0
  const facets = data?.facets
  const pageStart = total === 0 ? 0 : offset + 1
  const pageEnd = offset + items.length
  const hasPrev = offset > 0
  const hasNext = pageEnd < total

  const grouped = new Map<Category, Item[]>()
  for (const it of items) {
    const list = grouped.get(it.category) ?? []
    list.push(it)
    grouped.set(it.category, list)
  }
  const orderedCategories = CATEGORY_ORDER.filter((c) => grouped.has(c))

  const mutating = approve.isPending || reject.isPending || bulkRunning || approveAll.isPending

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">
          Pending{' '}
          <span className="text-base font-normal text-gray-500">
            {total > 0 ? `${pageStart}–${pageEnd} of ${total.toLocaleString()}` : '0'}
          </span>
        </h2>
        {items.length > 0 && (
          <span className="flex items-center gap-2">
            <button
              className="px-4 py-2 bg-green-700 text-white rounded-lg text-sm font-medium hover:bg-green-800 disabled:opacity-50 transition-colors"
              onClick={() => bulkApprove(items)}
              disabled={mutating}
            >
              {bulkRunning && bulkProgress
                ? `Approving ${bulkProgress.done}/${bulkProgress.total}…`
                : `Approve this page (${items.length})`}
            </button>
            <button
              className="px-4 py-2 bg-emerald-900 text-white rounded-lg text-sm font-medium hover:bg-black disabled:opacity-50 transition-colors"
              onClick={() => confirmApproveAll(total)}
              disabled={mutating}
              title="Approve every pending item behind the current filter, across all pages"
            >
              {approveAll.isPending ? 'Approving all…' : `Approve all (${total.toLocaleString()})`}
            </button>
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-6 text-sm">
        <label className="inline-flex items-center gap-2 bg-white border rounded-full pl-3 pr-1 py-1">
          <span className="text-gray-600">Region</span>
          <select
            className="bg-transparent rounded-full px-1 py-0.5 focus:outline-none"
            value={region}
            onChange={(e) => changeFilter(() => setRegion(e.target.value))}
          >
            <option value="">All regions</option>
            {/* Guarantee the currently-selected region is always an option,
                even if it has zero rows at this status and so is absent from
                the facets. Without this a `<select>` whose value isn't in the
                list falls back to displaying the first option, mismatching the
                real state — the bug that hid the whole national queue. */}
            {region && !facets?.regions.some((r) => r.value === region) && (
              <option value={region}>{region} (0)</option>
            )}
            {facets?.regions.map((r) => (
              <option key={r.value} value={r.value}>{r.value} ({r.n.toLocaleString()})</option>
            ))}
          </select>
        </label>
        <label className="inline-flex items-center gap-2 bg-white border rounded-full pl-3 pr-1 py-1">
          <span className="text-gray-600">Source</span>
          <select
            className="bg-transparent rounded-full px-1 py-0.5 max-w-64 focus:outline-none"
            value={sourceType}
            onChange={(e) => changeFilter(() => setSourceType(e.target.value))}
          >
            <option value="">All sources</option>
            {facets?.sourceTypes.map((s) => (
              <option key={s.value} value={s.value}>{s.value} ({s.n.toLocaleString()})</option>
            ))}
          </select>
        </label>
        {(region || sourceType) && (
          <button
            className="text-gray-500 hover:underline"
            onClick={() => changeFilter(() => { setRegion(''); setSourceType('') })}
          >
            clear filters
          </button>
        )}
        <span className="ml-auto flex items-center gap-2">
          <button
            className="px-3 py-1.5 border rounded-lg font-medium disabled:opacity-40 hover:bg-gray-50 transition-colors"
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            disabled={!hasPrev || mutating}
          >
            ← Prev
          </button>
          <button
            className="px-3 py-1.5 border rounded-lg font-medium disabled:opacity-40 hover:bg-gray-50 transition-colors"
            onClick={() => setOffset(offset + PAGE_SIZE)}
            disabled={!hasNext || mutating}
          >
            Next →
          </button>
        </span>
      </div>

      {orderedCategories.map((cat) => {
        const rows = grouped.get(cat)!
        const meta = CATEGORIES[cat]
        return (
          <div key={cat} className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-gray-700">
                {meta.emoji} {categoryLabel(cat)} ({rows.length})
              </h3>
              <button
                className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
                onClick={() => bulkApprove(rows)}
                disabled={mutating}
              >
                Approve {categoryLabel(cat).toLowerCase()} ({rows.length})
              </button>
            </div>
            <div className="space-y-2">
              {rows.map((it) => (
                <div
                  key={it.id}
                  className="border rounded-lg bg-white p-3 flex items-start gap-3"
                >
                  <span
                    className="shrink-0 w-9 h-9 rounded-lg grid place-items-center text-lg"
                    style={{ backgroundColor: meta.color + '22' }}
                    title={categoryLabel(cat)}
                    aria-hidden
                  >
                    {meta.emoji}
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/admin/items/${it.id}`}
                      className="font-medium text-blue-600 hover:underline break-words"
                    >
                      {it.name}
                    </Link>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-medium">
                        {getMetro(it.region)?.label ?? it.region}
                      </span>
                      <a
                        href={it.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
                      >
                        {it.source_type}
                      </a>
                      <span
                        className={`px-2 py-0.5 rounded-full font-medium ${CONFIDENCE_STYLE[it.confidence]}`}
                      >
                        {it.confidence}
                      </span>
                      <span className={whenClass(it)}>{formatWhen(it)}</span>
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    <button
                      className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
                      onClick={() => approve.mutate(it.id)}
                      disabled={mutating}
                    >Approve</button>
                    <button
                      className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
                      onClick={() => reject.mutate(it.id)}
                      disabled={mutating}
                    >Reject</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Compact "when" rendering for the pending queue row. Prioritizes:
//   - recurring (rrule present) → "Recurring"
//   - one-off w/ end_time → "Apr 25" or "Apr 25 – May 2" if multi-day
//   - one-off w/ only start_time → "Apr 25"
//   - undated → "—"
// Stale rows (end < today) get flagged in red so the curator spots them.
// Dates render on the ROW's venue clock (via its region), so a curator in
// the Bay reviewing New York rows sees New York calendar days — and a
// bare-date value ('2026-04-01', UTC midnight under plain `new Date()`) no
// longer renders as the previous day.
function formatWhen(it: Item): string {
  if (it.rrule) return 'Recurring'
  const s = it.start_time
  const e = it.end_time
  if (!s && !e) return '—'
  const tz = timezoneForRegion(it.region)
  const fmt = (iso: string) => {
    const p = parseEventTime(iso, tz)
    if (!p) return iso.slice(0, 10)
    return p.wall.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: p.wall.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined })
  }
  if (s && e) {
    const sd = fmt(s), ed = fmt(e)
    return sd === ed ? sd : `${sd} – ${ed}`
  }
  return fmt(s ?? e!)
}

function whenClass(it: Item): string {
  const base = 'tabular-nums '
  if (it.rrule) return base + 'text-gray-600'
  const checkIso = it.end_time ?? it.start_time
  if (!checkIso) return base + 'text-gray-400'
  const ts = Date.parse(checkIso)
  if (!Number.isFinite(ts)) return base + 'text-gray-400'
  if (ts < Date.now()) return base + 'text-red-600 font-medium' // past
  if (ts < Date.now() + 7 * 24 * 60 * 60 * 1000) return base + 'text-amber-700' // within 7 days — upcoming
  return base + 'text-gray-700'
}
