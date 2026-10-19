import type { Env } from '../env'

// Cron failure alert. Fires only when the last two consecutive runs of a
// given source both have errors (the caller, `alertOnRepeatedFailure` in
// index.ts, skips first failures to avoid noise on transient network blips).
//
// Delivered via Resend's REST API directly through `fetch`, so there is no
// extra npm dependency and the Workers runtime supports it natively.
//
// Soft-fails at every gate so a partial deploy or a Resend outage never
// crashes the scheduled handler: when `RESEND_API_KEY` or `ALERT_EMAIL` is
// unset (vitest, bare `wrangler dev`, a fresh deploy) the function logs and
// returns. `RESEND_API_KEY` is a `wrangler secret`; `RESEND_FROM_EMAIL` and
// `ALERT_EMAIL` are non-secret `[vars]` in `wrangler.toml`.

const DEFAULT_FROM = 'alerts@frolicmap.app'

export async function sendCronFailureAlert(
  env: Env,
  sourceId: string,
  errors: string[],
): Promise<void> {
  const to = env.ALERT_EMAIL
  if (!to) {
    console.log(`[cron-alert] mock send (ALERT_EMAIL unset) source=${sourceId} errors=${errors.length}`)
    return
  }
  const apiKey = env.RESEND_API_KEY
  if (!apiKey) {
    console.log(`[cron-alert] mock send (RESEND_API_KEY unset) source=${sourceId} errors=${errors.length}`)
    return
  }

  const fromAddress = env.RESEND_FROM_EMAIL || DEFAULT_FROM
  const subject = `[frolicmap] ${sourceId} cron: repeated failure`
  const errPreview = errors.slice(0, 5).join('\n  - ')
  const moreCount = errors.length > 5 ? `\n  ...and ${errors.length - 5} more` : ''
  const text = [
    `Cron source: ${sourceId}`,
    'Failed twice in a row.',
    '',
    'Errors:',
    `  - ${errPreview}${moreCount}`,
    '',
    'Check `wrangler tail` for the full run output, and the admin Ingestion',
    'tab for last-run timestamps and status.',
  ].join('\n')

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: `frolicmap alerts <${fromAddress}>`,
        to,
        subject,
        text,
      }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '<unreadable>')
      console.error(`[cron-alert] resend send failed status=${res.status} body=${detail}`)
    }
  } catch (err) {
    console.error(`[cron-alert] resend fetch error: ${err instanceof Error ? err.message : err}`)
  }
}
