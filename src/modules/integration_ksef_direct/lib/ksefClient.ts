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
  tenantId?: string
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
  return `${credentials.environment}:${credentials.tenantId ?? ''}:${credentials.nip}`
}

async function ksefFetch(url: string, options: RequestInit): Promise<Response> {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(15_000),
  })

  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After')
    const waitMs = Math.min(retryAfter ? parseInt(retryAfter, 10) * 1000 : 2000, 10_000)
    console.log(`[ksef] 429 rate-limit, waiting ${waitMs}ms before retry`)
    await new Promise((resolve) => setTimeout(resolve, waitMs))
    return fetch(url, { ...options, signal: AbortSignal.timeout(15_000) })
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

  console.log('[ksef-auth] fetchPublicKey...')
  const publicKeyPem = await fetchPublicKey(credentials.environment)
  console.log('[ksef-auth] publicKey fetched')

  console.log('[ksef-auth] POST /auth/challenge...')
  const challengeRes = await ksefFetch(`${baseUrl}/auth/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  console.log('[ksef-auth] challenge status:', challengeRes.status)
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

  console.log('[ksef-auth] POST /auth/ksef-token...')
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

  console.log('[ksef-auth] pollAuthStatus...')
  const authStatusData = await pollAuthStatus(baseUrl, tokenData.referenceNumber, authToken)
  console.log('[ksef-auth] pollAuthStatus done:', authStatusData)
  if (!authStatusData) {
    throw new KsefAuthError('Authentication timed out waiting for KSeF status', 'AUTH_TIMEOUT')
  }

  console.log('[ksef-auth] POST /auth/token/redeem...')
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

const OpenSessionResponseSchema = z.object({
  referenceNumber: z.string(),
  validUntil: z.string(),
})

const SendInvoiceToSessionResponseSchema = z.object({
  referenceNumber: z.string(),
})

const SessionStatusResponseSchema = z.object({
  status: z.object({
    code: z.number(),
    description: z.string(),
    details: z.array(z.string()).optional().nullable(),
  }),
  successfulInvoiceCount: z.number().optional().nullable(),
  failedInvoiceCount: z.number().optional().nullable(),
}).passthrough()

export async function sendInvoice(
  credentials: KsefCredentials,
  payload: {
    encryptedSymmetricKey: string
    initializationVector: string
    encryptedInvoiceContent: string
    invoiceHash: string
    invoiceSize: number
    encryptedInvoiceHash: string
    encryptedInvoiceSize: number
    publicKeyId?: string
  },
): Promise<{ sessionReferenceNumber: string; invoiceReferenceNumber: string }> {
  const baseUrl = BASE_URLS[credentials.environment]
  const accessToken = await getValidAccessToken(credentials)

  const openRes = await ksefFetch(`${baseUrl}/sessions/online`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({
      formCode: { systemCode: 'FA (2)', schemaVersion: '1-0E', value: 'FA' },
      encryption: {
        encryptedSymmetricKey: payload.encryptedSymmetricKey,
        initializationVector: payload.initializationVector,
        ...(payload.publicKeyId ? { publicKeyId: payload.publicKeyId } : {}),
      },
    }),
  })

  if (!openRes.ok) {
    const body = await openRes.text().catch(() => '')
    throw new KsefNetworkError(`Session open failed: HTTP ${openRes.status}${body ? ` — ${body}` : ''}`)
  }

  const openData = OpenSessionResponseSchema.parse(await openRes.json())
  const sessionReferenceNumber = openData.referenceNumber

  let invoiceReferenceNumber: string
  try {
    const sendRes = await ksefFetch(
      `${baseUrl}/sessions/online/${encodeURIComponent(sessionReferenceNumber)}/invoices`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
        body: JSON.stringify({
          invoiceHash: payload.invoiceHash,
          invoiceSize: payload.invoiceSize,
          encryptedInvoiceHash: payload.encryptedInvoiceHash,
          encryptedInvoiceSize: payload.encryptedInvoiceSize,
          encryptedInvoiceContent: payload.encryptedInvoiceContent,
        }),
      },
    )

    if (!sendRes.ok) {
      const body = await sendRes.text().catch(() => '')
      throw new KsefNetworkError(`Invoice send failed: HTTP ${sendRes.status}${body ? ` — ${body}` : ''}`)
    }

    const sendData = SendInvoiceToSessionResponseSchema.parse(await sendRes.json())
    invoiceReferenceNumber = sendData.referenceNumber
  } catch (err) {
    await ksefFetch(
      `${baseUrl}/sessions/online/${encodeURIComponent(sessionReferenceNumber)}/close`,
      { method: 'POST', headers: { 'Authorization': `Bearer ${accessToken}` } },
    ).catch(() => {})
    throw err
  }

  const closeRes = await ksefFetch(
    `${baseUrl}/sessions/online/${encodeURIComponent(sessionReferenceNumber)}/close`,
    { method: 'POST', headers: { 'Authorization': `Bearer ${accessToken}` } },
  )

  if (!closeRes.ok && closeRes.status !== 204) {
    const body = await closeRes.text().catch(() => '')
    console.warn(`KSeF session close returned HTTP ${closeRes.status}${body ? `: ${body}` : ''}`)
  }

  return { sessionReferenceNumber, invoiceReferenceNumber }
}

export interface KsefReceivedInvoiceSummary {
  ksefReferenceNumber: string
  sessionReferenceNumber: string
  issueDate: string | null
  sellerNip: string | null
  sellerName: string | null
  grossAmount: string | null
  netAmount: string | null
  vatAmount: string | null
  currency: string | null
  invoiceNumber: string | null
  upoDownloadUrl: string | null
  invoiceDownloadUrl: string | null
}

const SessionListResponseSchema = z.object({
  sessions: z.array(z.object({
    referenceNumber: z.string(),
  }).passthrough()).default([]),
  continuationToken: z.string().nullable().optional(),
}).passthrough()

const SessionInvoiceItemSchema = z.object({
  referenceNumber: z.string().optional(),
  ksefNumber: z.string().optional(),
  ksefReferenceNumber: z.string().optional(),
  issueDate: z.string().nullable().optional(),
  subjectBy: z.object({
    identifier: z.object({
      type: z.string().optional(),
      identifier: z.string().optional(),
    }).optional(),
    name: z.string().optional(),
  }).passthrough().optional(),
  grossAmount: z.union([z.string(), z.number()]).nullable().optional(),
  netAmount: z.union([z.string(), z.number()]).nullable().optional(),
  vatAmount: z.union([z.string(), z.number()]).nullable().optional(),
  currency: z.string().nullable().optional(),
  invoiceNumber: z.string().nullable().optional(),
  upoDownloadUrl: z.string().nullable().optional(),
  invoiceDownloadUrl: z.string().nullable().optional(),
}).passthrough()

const SessionInvoiceListResponseSchema = z.object({
  invoices: z.array(SessionInvoiceItemSchema).default([]),
  continuationToken: z.string().nullable().optional(),
}).passthrough()

async function fetchAllSessionInvoices(
  baseUrl: string,
  accessToken: string,
  sessionRef: string,
): Promise<KsefReceivedInvoiceSummary[]> {
  const results: KsefReceivedInvoiceSummary[] = []
  let continuationToken: string | null | undefined = undefined
  let isFirst = true

  while (isFirst || continuationToken) {
    isFirst = false
    const url = new URL(`${baseUrl}/sessions/${encodeURIComponent(sessionRef)}/invoices`)
    if (continuationToken) url.searchParams.set('continuationToken', continuationToken)

    console.log('[ksef-receive] GET session invoices:', url.pathname)
    const res = await ksefFetch(url.toString(), {
      method: 'GET',
      headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    })
    console.log('[ksef-receive] session invoices response:', res.status)

    if (!res.ok) break

    const data = SessionInvoiceListResponseSchema.parse(await res.json())
    continuationToken = data.continuationToken ?? null

    for (const inv of data.invoices) {
      const ksefRef = inv.ksefNumber ?? inv.ksefReferenceNumber
      if (!ksefRef) continue
      const grossRaw = inv.grossAmount
      const netRaw = inv.netAmount
      const vatRaw = inv.vatAmount
      results.push({
        ksefReferenceNumber: ksefRef,
        sessionReferenceNumber: sessionRef,
        issueDate: inv.issueDate ?? null,
        sellerNip: inv.subjectBy?.identifier?.identifier ?? null,
        sellerName: inv.subjectBy?.name ?? null,
        grossAmount: grossRaw != null ? String(grossRaw) : null,
        netAmount: netRaw != null ? String(netRaw) : null,
        vatAmount: vatRaw != null ? String(vatRaw) : null,
        currency: inv.currency ?? null,
        invoiceNumber: inv.invoiceNumber ?? null,
        upoDownloadUrl: inv.upoDownloadUrl ?? null,
        invoiceDownloadUrl: inv.invoiceDownloadUrl ?? null,
      })
    }

    if (!continuationToken) break
  }

  return results
}

export async function queryReceivedInvoices(
  credentials: KsefCredentials,
  params: {
    dateFrom: string
    dateTo: string
  },
): Promise<{ items: KsefReceivedInvoiceSummary[]; totalCount: number }> {
  console.log('[ksef-receive] queryReceivedInvoices start')
  const baseUrl = BASE_URLS[credentials.environment]
  console.log('[ksef-receive] getValidAccessToken...')
  const accessToken = await getValidAccessToken(credentials)
  console.log('[ksef-receive] accessToken obtained')
  const allItems: KsefReceivedInvoiceSummary[] = []

  let continuationToken: string | null | undefined = undefined
  let isFirst = true

  while (isFirst || continuationToken) {
    isFirst = false
    const sessionUrl = new URL(`${baseUrl}/sessions`)
    sessionUrl.searchParams.set('sessionType', 'online')
    sessionUrl.searchParams.set('direction', 'received')
    sessionUrl.searchParams.set('dateFrom', params.dateFrom)
    sessionUrl.searchParams.set('dateTo', params.dateTo)
    if (continuationToken) sessionUrl.searchParams.set('continuationToken', continuationToken)

    console.log('[ksef-receive] GET sessions:', sessionUrl.toString())
    const res = await ksefFetch(sessionUrl.toString(), {
      method: 'GET',
      headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    })
    console.log('[ksef-receive] sessions response status:', res.status)

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new KsefNetworkError(`Query received sessions failed: HTTP ${res.status}${body ? ` — ${body}` : ''}`)
    }

    const sessionData = SessionListResponseSchema.parse(await res.json())
    continuationToken = sessionData.continuationToken ?? null
    console.log('[ksef-receive] sessions count:', sessionData.sessions.length, 'continuationToken:', continuationToken)

    for (const session of sessionData.sessions) {
      console.log('[ksef-receive] fetching invoices for session:', session.referenceNumber)
      const invoices = await fetchAllSessionInvoices(baseUrl, accessToken, session.referenceNumber)
      console.log('[ksef-receive] session invoices:', invoices.length)
      allItems.push(...invoices)
    }

    if (!continuationToken) break
  }

  console.log('[ksef-receive] total items:', allItems.length)
  return { items: allItems, totalCount: allItems.length }
}

async function downloadFromUrl(url: string): Promise<string> {
  const res = await fetch(url, {
    method: 'GET',
    signal: AbortSignal.timeout(30_000),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new KsefNetworkError(`Invoice download failed: HTTP ${res.status}${body ? ` — ${body}` : ''}`)
  }

  return res.text()
}

export async function downloadInvoiceFromUrl(url: string): Promise<string> {
  return downloadFromUrl(url)
}

export async function downloadInvoice(
  credentials: KsefCredentials,
  ksefReferenceNumber: string,
): Promise<{ rawContent: string; upoDownloadUrl: string | null; invoiceDownloadUrl: string | null }> {
  const baseUrl = BASE_URLS[credentials.environment]
  const accessToken = await getValidAccessToken(credentials)

  console.log(`[ksef-fetch] GET /invoices/ksef/${ksefReferenceNumber}`)
  const res = await ksefFetch(`${baseUrl}/invoices/ksef/${encodeURIComponent(ksefReferenceNumber)}`, {
    method: 'GET',
    headers: { 'Accept': 'application/octet-stream', 'Authorization': `Bearer ${accessToken}` },
  })

  console.log(`[ksef-fetch] response status: ${res.status}, content-type: ${res.headers.get('content-type')}`)

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new KsefNetworkError(`Invoice fetch failed: HTTP ${res.status}${body ? ` — ${body}` : ''}`)
  }

  const contentType = res.headers.get('content-type') ?? ''
  let rawContent: string

  if (contentType.includes('application/json')) {
    const data = await res.json() as Record<string, unknown>
    console.log(`[ksef-fetch] JSON response keys: ${Object.keys(data).join(', ')}`)
    const downloadUrl = (data['invoiceDownloadUrl'] ?? data['downloadUrl'] ?? data['url']) as string | undefined
    if (downloadUrl) {
      rawContent = await downloadFromUrl(downloadUrl)
    } else if (typeof data['content'] === 'string') {
      rawContent = data['content'] as string
    } else {
      throw new KsefNetworkError(`Unexpected JSON response from /invoices/ksef — keys: ${Object.keys(data).join(', ')}`)
    }
    return {
      rawContent,
      upoDownloadUrl: (data['upoDownloadUrl'] as string | undefined) ?? null,
      invoiceDownloadUrl: (data['invoiceDownloadUrl'] as string | undefined) ?? null,
    }
  }

  rawContent = await res.text()
  return { rawContent, upoDownloadUrl: null, invoiceDownloadUrl: null }
}

export async function checkInvoiceStatus(
  credentials: KsefCredentials,
  referenceNumber: string,
): Promise<{ processingCode: number; ksefReferenceNumber?: string; errorDescription?: string }> {
  const baseUrl = BASE_URLS[credentials.environment]
  const accessToken = await getValidAccessToken(credentials)

  const res = await ksefFetch(`${baseUrl}/sessions/${encodeURIComponent(referenceNumber)}`, {
    method: 'GET',
    headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${accessToken}` },
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new KsefNetworkError(`Session status check failed: HTTP ${res.status}${body ? ` — ${body}` : ''}`)
  }

  const data = SessionStatusResponseSchema.parse(await res.json())
  const code = data.status.code

  if (code === 200) {
    if ((data.failedInvoiceCount ?? 0) > 0) {
      const details = data.status.details?.join('; ') ?? ''
      return { processingCode: 400, errorDescription: `KSeF rejected ${data.failedInvoiceCount} invoice(s): ${data.status.description}${details ? ` — ${details}` : ''}` }
    }
    return { processingCode: 200 }
  }

  if (code >= 400) {
    const details = data.status.details?.join('; ') ?? ''
    return { processingCode: code, errorDescription: `${data.status.description}${details ? ` — ${details}` : ''}` }
  }

  return { processingCode: 100 }
}
