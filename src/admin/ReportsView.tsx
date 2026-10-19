import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { adminApi } from '@/api/admin'
import { EmptyState } from './ui'

// Color-code the report reason so the curator can triage by severity at a
// glance: wrong_info amber (fixable), closed red (urgent — take it down),
// inappropriate purple (moderation). Anything unmapped falls back to gray.
const REASON_STYLE: Record<string, { cls: string; label: string }> = {
  wrong_info: { cls: 'bg-amber-100 text-amber-800', label: 'wrong info' },
  closed: { cls: 'bg-red-100 text-red-800', label: 'closed' },
  inappropriate: { cls: 'bg-purple-100 text-purple-800', label: 'inappropriate' },
}
function reasonStyle(reason: string) {
  return REASON_STYLE[reason] ?? { cls: 'bg-gray-100 text-gray-700', label: reason }
}

export function ReportsView() {
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: ['admin', 'reports', 'open'],
    queryFn: () => adminApi.listReports(false),
  })
  const resolve = useMutation({
    mutationFn: adminApi.resolveReport,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'reports', 'open'] }),
  })
  const reports = data?.reports ?? []

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">
        Open reports{' '}
        <span className="text-base font-normal text-gray-500">({reports.length})</span>
      </h2>

      {reports.length === 0 ? (
        <EmptyState padded>No open reports — the queue is clear. 🎉</EmptyState>
      ) : (
        <ul className="space-y-3">
          {reports.map((r) => {
            const rs = reasonStyle(r.reason)
            return (
              <li key={r.id} className="border rounded-lg bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link
                        to={`/admin/items/${r.item_id}`}
                        className="font-semibold text-blue-600 hover:underline break-all"
                      >
                        {r.item_id}
                      </Link>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${rs.cls}`}>
                        {rs.label}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400 mt-1">{r.created_at}</div>
                  </div>
                  <button
                    className="shrink-0 px-3 py-2 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
                    onClick={() => resolve.mutate(r.id)}
                    disabled={resolve.isPending}
                  >
                    Mark resolved
                  </button>
                </div>
                {r.note && (
                  <blockquote className="mt-3 border-l-4 border-gray-200 bg-gray-50 rounded-r px-3 py-2 text-sm text-gray-700 italic">
                    {r.note}
                  </blockquote>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
