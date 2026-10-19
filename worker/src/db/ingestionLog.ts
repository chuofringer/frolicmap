export async function logRun(
  db: D1Database,
  sourceId: string,
  stats: { started: string; finished: string; fetched: number; inserted: number; updated: number; errors?: string[] }
) {
  await db
    .prepare(
      `INSERT INTO ingestion_log (source_id, started_at, finished_at, fetched, inserted, updated, errors)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      sourceId,
      stats.started,
      stats.finished,
      stats.fetched,
      stats.inserted,
      stats.updated,
      stats.errors?.length ? JSON.stringify(stats.errors) : null
    )
    .run()
}
