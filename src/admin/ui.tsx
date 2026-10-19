import type { ReactNode } from 'react'

// Shared admin UI primitives (admin redesign). Extracted from the Behavior
// dashboard (#487) so all five admin views speak one coherent visual language:
// summary tiles, section cards, colored bar rows, friendly empty states, and
// status badges. Light-theme only to match AdminApp's `text-gray-900` pinning —
// admin is deliberately light-only, so NO `dark:` variants here.

// --- Tile -------------------------------------------------------------------
// A single summary metric: small uppercase label over a big tabular number.
// `accent` echoes the amber highlight used for the Coffee tile in Behavior.
export function Tile({
  label,
  value,
  accent,
  hint,
}: {
  label: ReactNode
  value: ReactNode
  accent?: boolean
  hint?: ReactNode
}) {
  return (
    <div className={'border rounded-lg p-3 bg-white ' + (accent ? 'border-amber-300' : '')}>
      <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
      <div
        className={
          'text-2xl font-semibold tabular-nums ' + (accent ? 'text-amber-600' : 'text-gray-900')
        }
      >
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      {hint != null && <div className="text-xs text-gray-400 mt-0.5">{hint}</div>}
    </div>
  )
}

// --- SectionCard ------------------------------------------------------------
// A bordered white card grouping related content, with an optional title/hint
// header and an optional right-aligned slot (counts, actions).
export function SectionCard({
  title,
  hint,
  right,
  children,
  className,
}: {
  title?: ReactNode
  hint?: ReactNode
  right?: ReactNode
  children: ReactNode
  className?: string
}) {
  const hasHeader = title != null || right != null
  return (
    <section className={'border rounded-lg bg-white p-4 ' + (className ?? '')}>
      {hasHeader && (
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            {title != null && (
              <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
            )}
            {hint != null && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
          </div>
          {right != null && <div className="shrink-0">{right}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

// --- BarRow -----------------------------------------------------------------
// One horizontal percentage-width bar: label, filled track, right-aligned
// count. Widest value in a group should pass the same `max` so bars stay
// comparable. Min 2% width keeps a non-zero value visible.
export function BarRow({
  label,
  value,
  max,
  color,
  height = 'h-5',
  mono = false,
  title,
}: {
  label: ReactNode
  value: number
  max: number
  color: string
  height?: string
  mono?: boolean
  title?: string
}) {
  const pct = Math.max((value / Math.max(max, 1)) * 100, 2)
  return (
    <div className="flex items-center gap-3 text-sm">
      <div
        className={
          'w-36 shrink-0 truncate text-gray-700 ' + (mono ? 'font-mono text-xs' : '')
        }
        title={title ?? (typeof label === 'string' ? label : undefined)}
      >
        {label}
      </div>
      <div className={'flex-1 bg-gray-100 rounded overflow-hidden ' + height}>
        <div
          className="h-full rounded"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <div className="w-12 shrink-0 text-right tabular-nums text-gray-600">
        {value.toLocaleString()}
      </div>
    </div>
  )
}

// --- EmptyState -------------------------------------------------------------
// Muted "nothing here" text. `padded` gives the boxed, centered variant for a
// whole-view empty; the default is an inline one-liner inside a section.
export function EmptyState({
  children,
  padded,
}: {
  children: ReactNode
  padded?: boolean
}) {
  if (padded) {
    return (
      <div className="rounded-lg border bg-white p-8 text-center text-sm text-gray-500">
        {children}
      </div>
    )
  }
  return <p className="text-sm text-gray-400">{children}</p>
}

// --- StatusBadge ------------------------------------------------------------
// Colored dot + label pill for health/state. Tones map to the traffic-light
// semantics used across the portal (green ok / amber warn / red error / gray
// unknown).
export type StatusTone = 'green' | 'amber' | 'red' | 'gray'

const TONE: Record<StatusTone, { dot: string; pill: string }> = {
  green: { dot: 'bg-green-500', pill: 'bg-green-100 text-green-800' },
  amber: { dot: 'bg-amber-500', pill: 'bg-amber-100 text-amber-800' },
  red: { dot: 'bg-red-500', pill: 'bg-red-100 text-red-800' },
  gray: { dot: 'bg-gray-400', pill: 'bg-gray-100 text-gray-700' },
}

export function StatusBadge({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  const t = TONE[tone]
  return (
    <span
      className={
        'inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full font-medium ' + t.pill
      }
    >
      <span className={'w-2 h-2 rounded-full ' + t.dot} />
      {children}
    </span>
  )
}
