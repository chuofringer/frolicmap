import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { API_BASE } from '@/config/constants'
import { getSessionToken } from '@/stores/useSessionStore'
import { useFocusTrap } from '@/hooks/useFocusTrap'

export function ReportModal({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const [reason, setReason] = useState('closed')
  const [note, setNote] = useState('')
  const [sent, setSent] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  // Focus the dialog on open, ESC closes it (previously missing entirely),
  // and Tab/Shift+Tab stay inside it instead of walking out to the detail
  // panel/map behind it.
  useFocusTrap(dialogRef, true, onClose)

  async function submit() {
    // /api/report is session-gated like the other public writes. A missing
    // token (cold load edge) means the POST 401s; we still show the thanks
    // card — reports are best-effort and the modal isn't an error surface.
    const token = getSessionToken()
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (token) headers['authorization'] = `Bearer ${token}`
    await fetch(`${API_BASE}/api/report`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ item_id: itemId, reason, note }),
    }).catch(() => { /* network failure — swallow, same posture as analytics */ })
    setSent(true)
    setTimeout(onClose, 1200)
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end md:items-center justify-center p-3">
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-modal-title"
        className="bg-white dark:bg-gray-900 ring-1 ring-black/20 dark:ring-white/10 w-full md:max-w-sm rounded-xl p-4 space-y-3 focus:outline-none"
      >
        <h3 id="report-modal-title" className="font-semibold text-gray-900 dark:text-gray-100">{t('detail.report.title')}</h3>
        {sent ? <div className="text-gray-700 dark:text-gray-200">{t('detail.report.thanks')}</div> : (
          <>
            <select
              className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-base md:text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            >
              <option value="closed">{t('detail.report.reasonClosed')}</option>
              <option value="wrong_info">{t('detail.report.reasonWrongInfo')}</option>
              <option value="not_kid_friendly">{t('detail.report.reasonNotKidFriendly')}</option>
              <option value="other">{t('detail.report.reasonOther')}</option>
            </select>
            <textarea
              className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-base md:text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500"
              rows={3}
              placeholder={t('detail.report.detailsPlaceholder')}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <button className="px-3 py-1 text-sm text-gray-500 dark:text-gray-400" onClick={onClose}>{t('detail.report.cancel')}</button>
              <button className="px-3 py-1 bg-indigo-600 text-white rounded text-sm" onClick={submit}>{t('detail.report.send')}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
