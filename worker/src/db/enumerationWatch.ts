// D1 read/write pair for the per-IP enumeration watch (issue #198, migration
// 0025). Decision logic lives in ../utils/enumerationGuard.ts; this file is
// only persistence.
import type { EnumerationState } from '../utils/enumerationGuard'

export interface EnumerationWatchRow extends EnumerationState {
  blockedUntil: Date | null
}

export async function getEnumerationWatch(db: D1Database, ipHash: string): Promise<EnumerationWatchRow | null> {
  const row = await db
    .prepare('SELECT last_id, streak, direction, blocked_until FROM id_fetch_watch WHERE ip_hash = ?')
    .bind(ipHash)
    .first<{ last_id: string; streak: number; direction: string | null; blocked_until: string | null }>()
  if (!row) return null
  return {
    lastId: row.last_id,
    streak: row.streak,
    direction: row.direction === 'asc' || row.direction === 'desc' ? row.direction : null,
    blockedUntil: row.blocked_until ? new Date(row.blocked_until) : null,
  }
}

export async function upsertEnumerationWatch(
  db: D1Database,
  ipHash: string,
  state: EnumerationState,
  blockedUntil: Date | null,
  now: Date,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO id_fetch_watch (ip_hash, last_id, streak, direction, updated_at, blocked_until)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(ip_hash) DO UPDATE SET
         last_id = excluded.last_id,
         streak = excluded.streak,
         direction = excluded.direction,
         updated_at = excluded.updated_at,
         blocked_until = excluded.blocked_until`,
    )
    .bind(ipHash, state.lastId, state.streak, state.direction, now.toISOString(), blockedUntil ? blockedUntil.toISOString() : null)
    .run()

  // Opportunistic sweep, no background job needed: the vast majority of visitors write
  // this table once per session and never return, so `updated_at` ages out
  // almost every row within a day. ~1% of writes pay the sweep cost so the
  // table doesn't grow unbounded under sustained traffic.
  if (Math.random() < 0.01) {
    const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
    await db.prepare('DELETE FROM id_fetch_watch WHERE updated_at < ?').bind(cutoff).run()
  }
}
