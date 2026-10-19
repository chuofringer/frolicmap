/**
 * Bulk-approval quality gate (#679). Pure so the admin endpoint and tests
 * share one decision.
 *
 *   accuracy >= thresholds.approve   -> 'approve'   (bulk approve allowed)
 *   thresholds.hold <= acc < approve -> 'hold', tier 'probation'
 *   accuracy <  thresholds.hold      -> 'hold', tier 'failing'
 *   no sample on file                -> 'unsampled' (allowed, but reported so
 *                                       the curator knows it was unchecked)
 *
 * Both sub-95 tiers stay pending; the tier is only a label so the curator can
 * tell "close, re-sample" from "broken, fix the extractor".
 */
export interface SourceAccuracyEntry {
  /** Percent 0-100, correct / (correct + wrong). */
  accuracy: number
  sampled: number
  /** ISO week of the sample, e.g. "2026-W41". */
  week: string
}

export interface SourceAccuracyConfig {
  thresholds: { approve: number; hold: number }
  sources: Record<string, SourceAccuracyEntry>
}

export type GateDecision = 'approve' | 'hold' | 'unsampled'
export type HoldTier = 'probation' | 'failing'

export interface GateResult {
  decision: GateDecision
  accuracy: number | null
  tier: HoldTier | null
}

export function gateSource(sourceType: string, config: SourceAccuracyConfig): GateResult {
  const entry = Object.prototype.hasOwnProperty.call(config.sources, sourceType)
    ? config.sources[sourceType]
    : undefined
  if (!entry || !Number.isFinite(entry.accuracy)) return { decision: 'unsampled', accuracy: null, tier: null }
  if (entry.accuracy >= config.thresholds.approve) return { decision: 'approve', accuracy: entry.accuracy, tier: null }
  return {
    decision: 'hold',
    accuracy: entry.accuracy,
    tier: entry.accuracy < config.thresholds.hold ? 'failing' : 'probation',
  }
}
