import { z } from 'zod'
import { fetchPublicKey, clearPublicKeyCache, encryptKsefToken } from './ksefCrypto'

type KsefEnvironment = 'test' | 'production'

const BASE_URLS: Record<KsefEnvironment, string> = {
  test: 'https://api-test.ksef.mf.gov.pl/v2',
  production: 'https://api.ksef.mf.gov.pl/v2',
}

export interface KsefCredentials {
  ksefToken: string
  nip: string
  environment: KsefEnvironment
}

interface KsefTokenCache {
  accessToken: string
  accessTokenExp: Date
  refreshToken: string
  refreshTokenExp: Date
}

const TOKEN_CACHE = new Map<string, KsefTokenCache>()

const ChallengeResponseSchema = z.object({
  challenge: z.string(),
  timestampMs: z.number().optional(),
})

const KsefTokenResponseSchema = z.object({
  referenceNumber: z.string(),
  authenticationToken: z.object({
    token: z.string(),
    validUntil: z.string().optional(),
  }),
})

const AuthStatusSchema = z.object({
  status: z.object({
    code: z.number(),
    description: z.string().optional(),
  }),
})

const RedeemResponseSchema = z.object({
  sessionToken: z.object({
    token: z.string(),
    generatedAt: z.string().optional(),
    validUntil: z.string().optional(),
  }).optional(),
  accessToken: z.object({
    token: z.string(),
    validUntil: z.string().optional(),
  }).optional(),
  refreshToken: z.object({
    token: z.string(),
    validUntil: z.string().optional(),
  }).optional(),
}).passthrough()

const RateLimitsSchema = z.object({
  otherPerSecond: z.number().optional(),
  otherPerMinute: z.number().optional(),
})

export type KsefRateLimits = z.infer<typeof RateLimitsSchema>

function cacheKey(credentials: KsefCredentials): string {
  return `${credentials.environment}:${credentials.nip}`
}

async function ksefFetch(url: string, options: RequestInit): Promise<Response> {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(10_000),
  })

  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After')
    const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 2000
    await new Promise((resolve) => setTimeout(resolve, waitMs))
    return fetch(url, { ...options, signal: AbortSignal.timeout(10_000) })
  }

  return response
}

async function getValidAccessToken(credentials: KsefCredentials): Promise<string> {
  const key = cacheKey(credentials)
  const cached = TOKEN_CACHE.get(key)
  const now = new Date()

  if (cached) {
    const refreshThreshold = new Date(cached.accessTokenExp.getTime() - 2 * 60 * 1000)
    if (now < refreshThreshold) {
      return cached.accessToken
    }

    if (now < cached.refreshTokenExp) {
      const newAccessToken = await refreshAccessToken(cached.refreshToken, credentials.environment)
      TOKEN_CACHE.set(key, {
        ...cached,
        accessToken: newAccessToken,
        accessTokenExp: new Date(Date.now() + 14 * 60 * 1000),
      })
      return newAccessToken
    }
  }

  return authenticate(credentials)
}

async function authenticate(credentials: KsefCredentials): Promise<string> {
  const baseUrl = BASE_URLS[credentials.environment]

  const publicKeyPem = await fetchPublicKey(credentials.environment)

  const challengeRes = await ksefFetch(`${baseUrl}/auth/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  if (!challengeRes.ok) {
    throw new KsefAuthError(`Challenge request failed: HTTP ${challengeRes.status}`, 'AUTH_CHALLENGE_FAILED')
  }
  const challengeData = ChallengeResponseSchema.parse(await challengeRes.json())

  const timestampMs = challengeData.timestampMs ?? Date.now()
  let encryptedToken: string
  try {
    encryptedToken = encryptKsefToken(credentials.ksefToken, timestampMs, publicKeyPem)
  } catch {
    clearPublicKeyCache(credentials.environment)
    const freshKey = await fetchPublicKey(credentials.environment)
    encryptedToken = encryptKsefToken(credentials.ksefToken, timestampMs, freshKey)
  }

  const ksefTokenRes = await ksefFetch(`${baseUrl}/auth/ksef-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      challenge: challengeData.challenge,
      contextIdentifier: { type: 'nip', value: credentials.nip },
      encryptedToken,
    }),
  })
  if (!ksefTokenRes.ok) {
    const body = await ksefTokenRes.text().catch(() => '')
    throw new KsefAuthError(
      `KSeF token submission failed: HTTP ${ksefTokenRes.status}${body ? ` — ${body}` : ''}`,
      ksefTokenRes.status === 401 ? 'AUTH_FAILED' : 'AUTH_KSEF_TOKEN_FAILED',
    )
  }
  const tokenData = KsefTokenResponseSchema.parse(await ksefTokenRes.json())
  const authToken = tokenData.authenticationToken.token

  const authStatusData = await pollAuthStatus(baseUrl, tokenData.referenceNumber, authToken)
  if (!authStatusData) {
    throw new KsefAuthError('Authentication timed out waiting for KSeF status', 'AUTH_TIMEOUT')
  }

  const redeemRes = await ksefFetch(`${baseUrl}/auth/token/redeem`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`,
    },
    body: JSON.stringify({}),
  })
  if (!redeemRes.ok) {
    const body = await redeemRes.text().catch(() => '')
    throw new KsefAuthError(`Token redeem failed: HTTP ${redeemRes.status}${body ? ` — ${body}` : ''}`, 'AUTH_REDEEM_FAILED')
  }

  const redeemRaw = await redeemRes.json() as Record<string, unknown>
  const redeemData = RedeemResponseSchema.parse(redeemRaw)
  const sessionTokenObj = redeemData.sessionToken ?? redeemData.accessToken
  if (!sessionTokenObj) {
    throw new KsefAuthError(
      `Unexpected redeem response shape: ${JSON.stringify(redeemRaw)}`,
      'AUTH_REDEEM_FAILED',
    )
  }
  const accessToken = sessionTokenObj.token
  const refreshTokenValue = redeemData.refreshToken?.token ?? accessToken
  const refreshTokenExp = redeemData.refreshToken?.validUntil
    ? new Date(redeemData.refreshToken.validUntil)
    : new Date(Date.now() + 60 * 60 * 1000)
  const accessTokenExp = sessionTokenObj.validUntil
    ? new Date(sessionTokenObj.validUntil)
    : new Date(Date.now() + 14 * 60 * 1000)

  TOKEN_CACHE.set(cacheKey(credentials), {
    accessToken,
    accessTokenExp,
    refreshToken: refreshTokenValue,
    refreshTokenExp,
  })

  return accessToken
}

async function pollAuthStatus(baseUrl: string, referenceNumber: string, authToken: string): Promise<boolean> {
  const deadline = Date.now() + 30_000
  let delay = 1000

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, delay))
    delay = Math.min(delay * 1.5, 5000)

    const res = await ksefFetch(`${baseUrl}/auth/${referenceNumber}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
    })

    if (res.ok) {
      const data = AuthStatusSchema.safeParse(await res.json())
      if (data.success) {
        const code = data.data.status.code
        if (code === 200) return true
        if (code >= 400) {
          throw new KsefAuthError(
            `KSeF authentication failed: ${data.data.status.description ?? `status ${code}`}`,
            'AUTH_FAILED',
          )
        }
      }
    }
  }

  return false
}

async function refreshAccessToken(refreshToken: string, environment: KsefEnvironment): Promise<string> {
  const baseUrl = BASE_URLS[environment]
  const res = await ksefFetch(`${baseUrl}/auth/token/refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${refreshToken}`,
    },
    body: JSON.stringify({}),
  })

  if (!res.ok) {
    throw new KsefAuthError(`Token refresh failed: HTTP ${res.status}`, 'AUTH_REFRESH_FAILED')
  }

  const raw = await res.json() as Record<string, unknown>
  const data = RedeemResponseSchema.parse(raw)
  const token = data.sessionToken?.token ?? data.accessToken?.token
  if (!token) throw new KsefAuthError('Unexpected refresh response shape', 'AUTH_REFRESH_FAILED')
  return token
}

export async function verifyAccess(credentials: KsefCredentials): Promise<KsefRateLimits> {
  const baseUrl = BASE_URLS[credentials.environment]
  const key = cacheKey(credentials)

  let accessToken: string
  try {
    accessToken = await getValidAccessToken(credentials)
  } catch (err) {
    TOKEN_CACHE.delete(key)
    throw err
  }

  const res = await ksefFetch(`${baseUrl}/rate-limits`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
  })

  if (res.status === 401) {
    TOKEN_CACHE.delete(key)
    const freshToken = await authenticate(credentials)
    const retryRes = await ksefFetch(`${baseUrl}/rate-limits`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${freshToken}`,
      },
    })
    if (!retryRes.ok) {
      throw new KsefNetworkError(`Rate limits check failed after re-auth: HTTP ${retryRes.status}`)
    }
    const parsed = RateLimitsSchema.safeParse(await retryRes.json())
    return parsed.success ? parsed.data : {}
  }

  if (!res.ok) {
    throw new KsefNetworkError(`Rate limits check failed: HTTP ${res.status}`)
  }

  const parsed = RateLimitsSchema.safeParse(await res.json())
  return parsed.success ? parsed.data : {}
}

export function clearTokenCache(tenantKey?: string): void {
  if (tenantKey) {
    TOKEN_CACHE.delete(tenantKey)
  } else {
    TOKEN_CACHE.clear()
  }
}

export class KsefAuthError extends Error {
  readonly errorCode: string
  constructor(message: string, errorCode: string) {
    super(message)
    this.name = 'KsefAuthError'
    this.errorCode = errorCode
  }
}

export class KsefNetworkError extends Error {
  readonly errorCode = 'NETWORK_ERROR'
  constructor(message: string) {
    super(message)
    this.name = 'KsefNetworkError'
  }
}
