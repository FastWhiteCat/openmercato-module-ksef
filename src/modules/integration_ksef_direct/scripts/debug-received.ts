/**
 * Debug script: tests KSeF received-invoice query (date range) and single-reference download.
 *
 * Usage:
 *   KSEF_TOKEN=<token> KSEF_NIP=<nip> KSEF_ENV=test npx tsx debug-received.ts
 *
 * Defaults: KSEF_ENV=test, date range = last 2 days.
 */

import crypto from 'node:crypto'

// ── env / config ─────────────────────────────────────────────────────────────

const KSEF_TOKEN = process.env.KSEF_TOKEN ?? ''
const KSEF_NIP   = process.env.KSEF_NIP   ?? ''
const KSEF_ENV   = (process.env.KSEF_ENV ?? 'test') as 'test' | 'production'

const SINGLE_REF = process.env.KSEF_REF ?? '9720865431-20260521-5DD4C3C00000-1E'

if (!KSEF_TOKEN || !KSEF_NIP) {
  console.error('❌  Set KSEF_TOKEN and KSEF_NIP env vars before running.')
  process.exit(1)
}

const BASE_URL = KSEF_ENV === 'production'
  ? 'https://api.ksef.mf.gov.pl/v2'
  : 'https://api-test.ksef.mf.gov.pl/v2'

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10)
}
const today      = isoDate(new Date())
const twoDaysAgo = isoDate(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000))

// ── helpers ───────────────────────────────────────────────────────────────────

async function kfetch(url: string, init: RequestInit): Promise<Response> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) })
  if (res.status === 429) {
    const wait = parseInt(res.headers.get('Retry-After') ?? '2', 10) * 1000
    console.warn(`  ⏳ 429 rate-limited — waiting ${wait}ms …`)
    await new Promise(r => setTimeout(r, wait))
    return fetch(url, { ...init, signal: AbortSignal.timeout(15_000) })
  }
  return res
}

async function logResponse(label: string, res: Response, bodyText: string) {
  console.log(`\n── ${label} ──────────────────────────────────────`)
  console.log(`  HTTP ${res.status} ${res.statusText}`)
  console.log('  Headers:', Object.fromEntries(
    [...res.headers.entries()].filter(([k]) => !['date','content-length'].includes(k))
  ))
  try {
    const parsed = JSON.parse(bodyText)
    console.log('  Body:', JSON.stringify(parsed, null, 2).slice(0, 4000))
  } catch {
    console.log('  Body (raw):', bodyText.slice(0, 2000))
  }
}

// ── crypto ────────────────────────────────────────────────────────────────────

type Cert = { certificate: string; usage?: string[]; publicKeyId?: string }

async function fetchPublicKey(): Promise<string> {
  console.log(`\n[1] Fetching public-key certificates from ${BASE_URL}/security/public-key-certificates …`)
  const res = await kfetch(`${BASE_URL}/security/public-key-certificates`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })
  const body = await res.text()
  await logResponse('public-key-certificates', res, body)

  if (!res.ok) throw new Error(`Public-key fetch failed: HTTP ${res.status}`)
  const certs: Cert[] = JSON.parse(body)
  console.log('  Cert usages:', certs.map(c => c.usage))

  const cert = certs.find(c => c.usage?.includes('KsefTokenEncryption'))
  if (!cert) throw new Error('No KsefTokenEncryption cert found. Certs: ' + JSON.stringify(certs.map(c => ({ usage: c.usage }))))

  const der = Buffer.from(cert.certificate, 'base64')
  const x509 = new crypto.X509Certificate(der)
  return x509.publicKey.export({ type: 'spki', format: 'pem' }).toString()
}

function encryptToken(token: string, timestampMs: number, pem: string): string {
  return crypto.publicEncrypt(
    { key: pem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(`${token}|${timestampMs}`, 'utf-8'),
  ).toString('base64')
}

// ── auth ──────────────────────────────────────────────────────────────────────

async function authenticate(): Promise<string> {
  const pem = await fetchPublicKey()

  // 1. Challenge
  console.log('\n[2] POST /auth/challenge …')
  const challengeRes = await kfetch(`${BASE_URL}/auth/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  const challengeBody = await challengeRes.text()
  await logResponse('auth/challenge', challengeRes, challengeBody)
  if (!challengeRes.ok) throw new Error(`Challenge failed: HTTP ${challengeRes.status} — ${challengeBody}`)

  const { challenge, timestampMs } = JSON.parse(challengeBody)
  const ts = timestampMs ?? Date.now()
  const encryptedToken = encryptToken(KSEF_TOKEN, ts, pem)
  console.log(`  challenge=${challenge}, ts=${ts}`)

  // 2. Submit ksef-token
  console.log('\n[3] POST /auth/ksef-token …')
  const ktRes = await kfetch(`${BASE_URL}/auth/ksef-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      challenge,
      contextIdentifier: { type: 'nip', value: KSEF_NIP },
      encryptedToken,
    }),
  })
  const ktBody = await ktRes.text()
  await logResponse('auth/ksef-token', ktRes, ktBody)
  if (!ktRes.ok) throw new Error(`ksef-token failed: HTTP ${ktRes.status} — ${ktBody}`)

  const { referenceNumber, authenticationToken } = JSON.parse(ktBody)
  const authToken: string = authenticationToken.token
  console.log(`  referenceNumber=${referenceNumber}`)

  // 3. Poll status
  console.log('\n[4] Polling auth status …')
  const deadline = Date.now() + 30_000
  let delay = 1000
  let ok = false
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, delay))
    delay = Math.min(delay * 1.5, 5000)

    const sRes = await kfetch(`${BASE_URL}/auth/${referenceNumber}`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${authToken}` },
    })
    const sBody = await sRes.text()
    const sData = JSON.parse(sBody) as { status?: { code?: number; description?: string } }
    const code = sData?.status?.code ?? -1
    console.log(`  → status code=${code} desc=${sData?.status?.description ?? ''}`)

    if (code === 200) { ok = true; break }
    if (code >= 400) throw new Error(`Auth polling failed: code=${code} ${sData?.status?.description}`)
  }
  if (!ok) throw new Error('Auth timed out')

  // 4. Redeem
  console.log('\n[5] POST /auth/token/redeem …')
  const redeemRes = await kfetch(`${BASE_URL}/auth/token/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({}),
  })
  const redeemBody = await redeemRes.text()
  await logResponse('auth/token/redeem', redeemRes, redeemBody)
  if (!redeemRes.ok) throw new Error(`Redeem failed: HTTP ${redeemRes.status} — ${redeemBody}`)

  const redeemData = JSON.parse(redeemBody)
  const accessToken: string =
    redeemData?.sessionToken?.token ?? redeemData?.accessToken?.token
  if (!accessToken) throw new Error(`No accessToken in redeem response: ${redeemBody}`)
  console.log(`  ✅ accessToken obtained (len=${accessToken.length})`)
  return accessToken
}

// ── query received invoices ───────────────────────────────────────────────────

async function queryReceived(accessToken: string, dateFrom: string, dateTo: string) {
  const url = new URL(`${BASE_URL}/invoices`)
  url.searchParams.set('dateFrom', dateFrom)
  url.searchParams.set('dateTo', dateTo)
  url.searchParams.set('pageSize', '100')
  url.searchParams.set('pageOffset', '0')

  console.log(`\n[6] GET /invoices?dateFrom=${dateFrom}&dateTo=${dateTo} …`)
  console.log(`  Full URL: ${url}`)

  const res = await kfetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
  })
  const body = await res.text()
  await logResponse('invoices (date range)', res, body)

  if (!res.ok) {
    console.error(`  ❌ Query failed: HTTP ${res.status}`)
  } else {
    try {
      const data = JSON.parse(body)
      console.log(`  ✅ totalCount=${data.totalCount ?? '?'}, items=${data.invoices?.length ?? 0}`)
    } catch {
      console.error('  ⚠️  Response is not valid JSON')
    }
  }
}

// ── download single ───────────────────────────────────────────────────────────

async function downloadSingle(accessToken: string, ref: string) {
  const url = `${BASE_URL}/invoices/${encodeURIComponent(ref)}`
  console.log(`\n[7] GET /invoices/${ref} …`)

  const res = await kfetch(url, {
    method: 'GET',
    headers: { Accept: 'application/xml', Authorization: `Bearer ${accessToken}` },
  })
  const body = await res.text()
  await logResponse(`invoices/${ref}`, res, body)

  if (!res.ok) {
    console.error(`  ❌ Download failed: HTTP ${res.status}`)
  } else {
    console.log(`  ✅ Downloaded ${body.length} bytes of XML`)
    const snippet = body.slice(0, 300)
    console.log(`  First 300 chars: ${snippet}`)
  }
}

// ── main ──────────────────────────────────────────────────────────────────────

console.log('═══════════════════════════════════════════════════════')
console.log(`KSeF Debug — env=${KSEF_ENV}  nip=${KSEF_NIP}  base=${BASE_URL}`)
console.log(`Date range: ${twoDaysAgo} → ${today}`)
console.log(`Single ref: ${SINGLE_REF}`)
console.log('═══════════════════════════════════════════════════════')

let accessToken: string
try {
  accessToken = await authenticate()
} catch (err) {
  console.error('\n❌ Authentication failed:', err)
  process.exit(1)
}

await queryReceived(accessToken, twoDaysAgo, today)
await downloadSingle(accessToken, SINGLE_REF)

console.log('\n═══════════════════════════════════════════════════════')
console.log('Done.')
