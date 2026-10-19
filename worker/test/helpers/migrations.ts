// Shared Miniflare D1 migration fixture. Loads the single schema file
// (worker/migrations/0001_init.sql) so every suite that uses it runs the
// current schema. Add new migrations to the glob's sorted list by filename:
// appending a file needs zero test-file edits.

const modules = import.meta.glob('../../migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const splitQueries = (sql: string) =>
  sql.split(/;\s*\n/).map((q) => q.trim()).filter(Boolean)

export const d1Migrations = Object.entries(modules)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, sql]) => ({
    name: (path.split('/').pop() ?? path).replace(/\.sql$/, ''),
    queries: splitQueries(sql),
  }))
