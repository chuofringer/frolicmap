import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { adminApi } from '@/api/admin'
import type { Item } from '@shared/types'
import { isAllowedPhotoUrl, ALLOWED_PHOTO_HOSTS } from '@shared/photoHost'

export function ItemEditor() {
  const { id } = useParams<{ id: string }>()
  const nav = useNavigate()
  const { data } = useQuery({
    queryKey: ['admin', 'item', id],
    queryFn: () => adminApi.getItem(id!),
    enabled: !!id,
  })
  const [patch, setPatch] = useState<Partial<Item>>({})
  // Drop in-progress edits when the route moves to a different item. A
  // render-time reset keyed on the id transition (React's "adjust state when
  // a prop changes" pattern) — the old `useEffect(() => setPatch({}), [id])`
  // did the same one render later and tripped react-hooks/set-state-in-effect.
  const [patchForId, setPatchForId] = useState(id)
  if (patchForId !== id) {
    setPatchForId(id)
    setPatch({})
  }

  const save = useMutation({
    mutationFn: () => adminApi.edit(id!, patch),
    onSuccess: () => nav('/admin'),
  })
  const approve = useMutation({
    mutationFn: async () => { await adminApi.edit(id!, patch); await adminApi.approve(id!) },
    onSuccess: () => nav('/admin'),
  })
  const reject = useMutation({
    mutationFn: () => adminApi.reject(id!),
    onSuccess: () => nav('/admin'),
  })

  if (!data) return <div>Loading…</div>
  const item = { ...data.item, ...patch }
  // Mirrors the server's host allow-list (worker/src/routes/admin.ts /
  // shared/photoHost.ts) so a curator sees the problem before submitting
  // rather than after a 400.
  const photoUrlError = item.photo_url && !isAllowedPhotoUrl(item.photo_url)
    ? `Photo URL must be an https:// URL on one of: ${ALLOWED_PHOTO_HOSTS.join(', ')}`
    : null

  return (
    <div className="max-w-3xl">
      <Link to="/admin" className="text-sm text-blue-600">← back to queue</Link>
      <h2 className="text-xl font-semibold my-2">{item.name}</h2>
      <div className="text-xs text-gray-500 mb-4">
        <a href={item.source_url} target="_blank" rel="noreferrer" className="underline">
          Source: {item.source_url}
        </a>
      </div>

      <Field label="Name" value={item.name ?? ''} onChange={(v) => setPatch((p) => ({ ...p, name: v }))} />
      {/* Chinese title (#692). Titles are the only translated item field —
          description and address stay English in both locales — so this is the
          only translation input the editor has. Blank clears it and the row
          falls back to its English name on /zh; the server normalizes '' to
          NULL. Sits under Name because it's the same fact in another language,
          and because a curator fixing one usually checks the other. */}
      <Field
        label="Chinese title (blank = fall back to English)"
        value={item.name_zh ?? ''}
        onChange={(v) => setPatch((p) => ({ ...p, name_zh: v }))}
      />
      <Field label="Description" value={item.description ?? ''} onChange={(v) => setPatch((p) => ({ ...p, description: v }))} textarea />
      <Field label="Address" value={item.address ?? ''} onChange={(v) => setPatch((p) => ({ ...p, address: v }))} />

      <PhotoFields
        photoUrl={item.photo_url ?? null}
        photoAttribution={item.photo_attribution ?? null}
        onPhotoUrlChange={(v) => setPatch((p) => ({ ...p, photo_url: v }))}
        onAttributionChange={(v) => setPatch((p) => ({ ...p, photo_attribution: v }))}
        onClear={() => setPatch((p) => ({ ...p, photo_url: null, photo_attribution: null }))}
      />

      <div className="grid grid-cols-2 gap-3 my-3">
        <Field label="Age min" value={String(item.age_min ?? '')} onChange={(v) => setPatch((p) => ({ ...p, age_min: v ? Number(v) : null }))} />
        <Field label="Age max" value={String(item.age_max ?? '')} onChange={(v) => setPatch((p) => ({ ...p, age_max: v ? Number(v) : null }))} />
      </div>

      <div className="flex gap-3">
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={item.indoor === 1} onChange={(e) => setPatch((p) => ({ ...p, indoor: e.target.checked ? 1 : 0 }))} />
          Indoor
        </label>
        {item.category === 'park' && (
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={item.has_playground === 1}
              onChange={(e) => setPatch((p) => ({ ...p, has_playground: e.target.checked ? 1 : 0 }))}
            />
            Has playground
          </label>
        )}
        <label className="inline-flex items-center gap-2">
          <input type="radio" name="cost" checked={item.cost === 'free'} onChange={() => setPatch((p) => ({ ...p, cost: 'free' }))} />
          Free
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="radio" name="cost" checked={item.cost === 'paid'} onChange={() => setPatch((p) => ({ ...p, cost: 'paid' }))} />
          Paid
        </label>
      </div>

      <div className="mt-6 flex gap-3">
        <button
          className="px-3 py-2 bg-green-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={!!photoUrlError}
          title={photoUrlError ?? undefined}
          onClick={() => approve.mutate()}
        >
          Save & Approve
        </button>
        <button
          className="px-3 py-2 bg-gray-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={!!photoUrlError}
          title={photoUrlError ?? undefined}
          onClick={() => save.mutate()}
        >
          Save (keep pending)
        </button>
        <button className="px-3 py-2 bg-red-600 text-white rounded" onClick={() => reject.mutate()}>Reject</button>
      </div>
    </div>
  )
}

/**
 * Photo URL + attribution fields (#299 — "Add pictures for locations").
 * `photo_url` is the only curated field with an external-network preview, so
 * it gets its own component rather than the plain `Field`: host-allow-listed
 * validation feedback (`@shared/photoHost`), a live thumbnail (or a failure
 * message, never a browser's broken-image icon), and a one-click Clear that
 * blanks both fields together (an attribution with no photo is meaningless).
 */
function PhotoFields({
  photoUrl,
  photoAttribution,
  onPhotoUrlChange,
  onAttributionChange,
  onClear,
}: {
  photoUrl: string | null
  photoAttribution: string | null
  onPhotoUrlChange: (v: string | null) => void
  onAttributionChange: (v: string | null) => void
  onClear: () => void
}) {
  const trimmed = photoUrl?.trim() ?? ''
  const urlError = trimmed && !isAllowedPhotoUrl(trimmed)
    ? `Photo URL must be an https:// URL on one of: ${ALLOWED_PHOTO_HOSTS.join(', ')}`
    : null

  return (
    <div className="mb-3">
      <div className="text-xs text-gray-600 mb-1">Photo URL</div>
      <div className="flex gap-2">
        <input
          value={photoUrl ?? ''}
          onChange={(e) => onPhotoUrlChange(e.target.value || null)}
          placeholder="https://upload.wikimedia.org/..."
          className="w-full border rounded px-2 py-1 text-base md:text-sm"
        />
        {(photoUrl || photoAttribution) && (
          <button type="button" onClick={onClear} className="px-2 py-1 text-xs text-gray-700 border rounded whitespace-nowrap">
            Clear
          </button>
        )}
      </div>
      {urlError && <div className="mt-1 text-xs text-red-600">{urlError}</div>}

      {trimmed && !urlError && (
        <div className="mt-2 w-56">
          <PhotoPreview key={trimmed} url={trimmed} />
        </div>
      )}

      <label className="block mt-2">
        <div className="text-xs text-gray-600 mb-1">Photo attribution</div>
        <input
          value={photoAttribution ?? ''}
          onChange={(e) => onAttributionChange(e.target.value || null)}
          placeholder='e.g. "Jane Doe / Wikimedia Commons (CC BY-SA 4.0)"'
          className="w-full border rounded px-2 py-1 text-base md:text-sm"
        />
      </label>
      <div className="mt-1 text-[11px] text-gray-500">
        Required for Wikimedia Commons photos (nearly all of them) — leave blank only for a photo you know needs no credit.
      </div>
    </div>
  )
}

/**
 * The live thumbnail. Keyed by URL from the parent so a new/edited URL always
 * remounts this (fresh `failed` state, browser re-attempts the load) instead
 * of reusing a stale error from a previous value.
 */
function PhotoPreview({ url }: { url: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <div className="aspect-video rounded border border-dashed border-gray-300 bg-gray-50 flex items-center justify-center text-xs text-gray-500">
        Image failed to load
      </div>
    )
  }
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className="w-full aspect-video object-cover rounded border border-gray-200"
    />
  )
}

function Field({ label, value, onChange, textarea }: { label: string; value: string; onChange: (v: string) => void; textarea?: boolean }) {
  const props = { value, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value), className: 'w-full border rounded px-2 py-1 text-base md:text-sm' }
  return (
    <label className="block mb-3">
      <div className="text-xs text-gray-600 mb-1">{label}</div>
      {textarea ? <textarea rows={3} {...props} /> : <input {...props} />}
    </label>
  )
}
