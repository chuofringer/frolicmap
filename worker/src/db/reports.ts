export interface ReportRow {
  id: number; item_id: string; reason: string; note: string | null;
  created_at: string; resolved: 0 | 1
}

export async function listReports(db: D1Database, resolved: 0 | 1): Promise<ReportRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM reports WHERE resolved = ? ORDER BY created_at DESC')
    .bind(resolved)
    .all<ReportRow>()
  return results
}

export async function resolveReport(db: D1Database, id: number): Promise<void> {
  await db.prepare('UPDATE reports SET resolved = 1 WHERE id = ?').bind(id).run()
}
