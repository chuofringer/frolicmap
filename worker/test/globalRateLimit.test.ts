import { env } from 'cloudflare:test'
import { describe, it, expect } from 'vitest'
import { globalLimit, subjectFor, retryAfterSeconds } from '../src/utils/globalRateLimit'
import type { Env } from '../src/env'

describe('globalLimit', () => {
  it('is a no-op success when RATE_LIMITER_DO is absent from env (cold deploy / test env without the binding)', async () => {
    const bareEnv: Pick<Env, 'RATE_LIMITER_DO'> = { RATE_LIMITER_DO: undefined }
    const result = await globalLimit(bareEnv, 'unit-noop', 'subj-1', { limit: 5, windowMs: 1_000 })
    expect(result.success).toBe(true)
    expect(result.remaining).toBe(5)
    expect(result.resetAt).toBeGreaterThan(Date.now())
  })

  it('admits up to `limit` requests for a (scope, subject) pair, then rejects', async () => {
    const scope = `unit-limit-${crypto.randomUUID()}`
    const subject = 'subj-a'
    for (let i = 0; i < 3; i++) {
      const res = await globalLimit(env, scope, subject, { limit: 3, windowMs: 60_000 })
      expect(res.success).toBe(true)
    }
    const rejected = await globalLimit(env, scope, subject, { limit: 3, windowMs: 60_000 })
    expect(rejected.success).toBe(false)
    expect(rejected.remaining).toBe(0)
    expect(rejected.resetAt).toBeGreaterThan(Date.now())
  })

  it('gives each subject its own independent budget under the same scope', async () => {
    const scope = `unit-subjects-${crypto.randomUUID()}`
    for (let i = 0; i < 2; i++) {
      const res = await globalLimit(env, scope, 'subj-x', { limit: 2, windowMs: 60_000 })
      expect(res.success).toBe(true)
    }
    // subj-x is now exhausted...
    expect((await globalLimit(env, scope, 'subj-x', { limit: 2, windowMs: 60_000 })).success).toBe(false)
    // ...but a different subject in the SAME scope is untouched. This is the
    // exact property a per-isolate binding can't offer per-token: budgets
    // are isolated per (scope, subject), not shared across every caller.
    expect((await globalLimit(env, scope, 'subj-y', { limit: 2, windowMs: 60_000 })).success).toBe(true)
  })

  it('gives each scope its own independent budget for the same subject', async () => {
    const subject = `unit-shared-subject-${crypto.randomUUID()}`
    const scopeA = 'unit-scope-a'
    const scopeB = 'unit-scope-b'
    expect((await globalLimit(env, scopeA, subject, { limit: 1, windowMs: 60_000 })).success).toBe(true)
    expect((await globalLimit(env, scopeA, subject, { limit: 1, windowMs: 60_000 })).success).toBe(false)
    // Same subject, different scope (e.g. 'tiles' vs 'items-detail') — a
    // caller exhausting one endpoint's budget must not be throttled on
    // another endpoint's unrelated budget.
    expect((await globalLimit(env, scopeB, subject, { limit: 1, windowMs: 60_000 })).success).toBe(true)
  })

  it('fails open (success:true) if the DO stub throws', async () => {
    const brokenEnv = {
      RATE_LIMITER_DO: {
        idFromName: () => { throw new Error('boom') },
      },
    } as unknown as Pick<Env, 'RATE_LIMITER_DO'>
    const result = await globalLimit(brokenEnv, 'unit-broken', 'subj', { limit: 1, windowMs: 1_000 })
    expect(result.success).toBe(true)
  })
})

describe('subjectFor', () => {
  it('prefers the session nonce when present', () => {
    expect(subjectFor('1.2.3.4', 'abc123')).toBe('nonce:abc123')
  })

  it('falls back to the IP when there is no nonce (pre-token requests, e.g. POST /api/session)', () => {
    expect(subjectFor('1.2.3.4', undefined)).toBe('ip:1.2.3.4')
  })
})

describe('retryAfterSeconds', () => {
  it('rounds up to the nearest second and never returns less than 1', () => {
    const now = 1_000_000
    expect(retryAfterSeconds(now + 500, now)).toBe(1)
    expect(retryAfterSeconds(now + 30_500, now)).toBe(31)
    // Already past reset (clock skew / slow request) — still at least 1s,
    // never 0 or negative, so a client's Retry-After is always meaningful.
    expect(retryAfterSeconds(now - 5_000, now)).toBe(1)
  })
})
