import { describe, it, expect, vi, afterEach } from 'vitest'
import { sendCronFailureAlert } from '../src/utils/email'
import type { Env } from '../src/env'

const fullEnv = {
  RESEND_API_KEY: 're_test_key',
  RESEND_FROM_EMAIL: 'alerts@frolicmap.app',
  ALERT_EMAIL: 'ops@example.org',
} as Env

afterEach(() => {
  vi.restoreAllMocks()
})

describe('sendCronFailureAlert', () => {
  it('posts to Resend with the alert details when fully configured', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
    await sendCronFailureAlert(fullEnv, 'osm', ['park: [timeout] Overpass 504'])
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.resend.com/emails')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer re_test_key')
    const body = JSON.parse(init.body as string) as { from: string; to: string; subject: string; text: string }
    expect(body.from).toBe('frolicmap alerts <alerts@frolicmap.app>')
    expect(body.to).toBe('ops@example.org')
    expect(body.subject).toContain('osm')
    expect(body.text).toContain('park: [timeout] Overpass 504')
  })

  it('falls back to the default sender when RESEND_FROM_EMAIL is unset', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
    await sendCronFailureAlert({ ...fullEnv, RESEND_FROM_EMAIL: undefined } as Env, 'osm', ['boom'])
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string) as { from: string }
    expect(body.from).toBe('frolicmap alerts <alerts@frolicmap.app>')
  })

  it('is a console.log no-op when ALERT_EMAIL is unset or empty', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await sendCronFailureAlert({ ...fullEnv, ALERT_EMAIL: undefined } as Env, 'osm', ['boom'])
    await sendCronFailureAlert({ ...fullEnv, ALERT_EMAIL: '' } as Env, 'osm', ['boom'])
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledTimes(2)
    expect(logSpy.mock.calls[0][0]).toContain('ALERT_EMAIL unset')
  })

  it('is a console.log no-op when RESEND_API_KEY is unset', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await sendCronFailureAlert({ ...fullEnv, RESEND_API_KEY: undefined } as Env, 'osm', ['boom'])
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(logSpy.mock.calls[0][0]).toContain('RESEND_API_KEY unset')
  })

  it('never throws when Resend rejects or the network fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('nope', { status: 500 }))
    await expect(sendCronFailureAlert(fullEnv, 'osm', ['boom'])).resolves.toBeUndefined()
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('dns'))
    await expect(sendCronFailureAlert(fullEnv, 'osm', ['boom'])).resolves.toBeUndefined()
  })

  it('truncates a long error list in the body', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
    await sendCronFailureAlert(fullEnv, 'osm', ['1', '2', '3', '4', '5', '6', '7'])
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string) as { text: string }
    expect(body.text).toContain('...and 2 more')
  })
})
