import type { MiddlewareHandler } from 'hono'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { Env } from '../env'

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null

function getJwks(team: string) {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`https://${team}/cdn-cgi/access/certs`))
  }
  return jwks
}

export const cfAccess: MiddlewareHandler<{ Bindings: Env; Variables: { adminEmail: string } }> = async (c, next) => {
  // Dev-only bypass: requires explicit `DEV_ADMIN_BYPASS=yes` in env AND the
  // `x-dev-admin: yes` request header. Both-must-be-set prevents an unset-secret
  // mistake from exposing admin in production.
  if (c.env.DEV_ADMIN_BYPASS === 'yes' && c.req.header('x-dev-admin') === 'yes') {
    c.set('adminEmail', 'dev@local')
    return next()
  }

  const team = c.env.CF_ACCESS_TEAM
  const aud = c.env.CF_ACCESS_AUD
  if (!team || !aud) return c.json({ error: 'admin not configured' }, 503)

  const token = c.req.header('Cf-Access-Jwt-Assertion')
  if (!token) return c.json({ error: 'no access token' }, 401)

  try {
    const { payload } = await jwtVerify(token, getJwks(team), {
      issuer: `https://${team}`,
      audience: aud,
    })
    c.set('adminEmail', (payload.email as string) ?? 'unknown')
  } catch {
    return c.json({ error: 'invalid access token' }, 401)
  }

  return next()
}
