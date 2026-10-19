export function slugify(s: string, suffix?: string): string {
  const base = s
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60)
  return suffix ? `${base}-${suffix}` : base
}
