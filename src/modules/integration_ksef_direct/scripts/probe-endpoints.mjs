/**
 * Probes KSeF v2 test API to find correct received-invoice endpoints.
 * Re-uses the same auth from decrypt-and-run.mjs logic.
 */
import crypto from 'node:crypto'
import { execSync } from 'node:child_process'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/open-mercato'
const ENCRYPTION_SECRET = process.env.TENANT_DATA_ENCRYPTION_FALLBACK_KEY ?? 'dev-tenant-encryption-fallback-key-32chars'
const BASE_URL = 'https://api-test.ksef.mf.gov.pl/v2'

function deriveTenantDek(secret, tenantId) {
  const root = crypto.createHash('sha256').update(secret).digest()
  return crypto.pbkdf2Sync(root, tenantId, 310_000, 32, 'sha512').toString('base64')
}

function aesGcmDecrypt(payload, dekBase64) {
  const parts = payload.split(':')
  if (parts.length !== 4 || parts[3] !== 'v1') return null
  const [ivB64, ctB64, tagB64] = parts
  try {
    const dek = Buffer.from(dekBase64, 'base64')
    const decipher = crypto.createDecipheriv('aes-256-gcm', dek, Buffer.from(ivB64, 'base64'))
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf-8')
  } catch { return null }
}

function getKsefCredentials() {
  const row = execSync(
    `psql "${DATABASE_URL}" --no-align --tuples-only --field-separator='|' -c "SELECT credentials::text, tenant_id FROM integration_credentials WHERE integration_id = 'integration_ksef_direct' AND deleted_at IS NULL LIMIT 1"`,
    { encoding: 'utf-8', timeout: 10_000 }
  ).trim()
  const firstPipe = row.indexOf('|')
  const rawCredentials = row.slice(0, firstPipe)
  const tenantId = row.slice(firstPipe + 1)
  const dek = deriveTenantDek(ENCRYPTION_SECRET, tenantId)
  let enc = rawCredentials
  if (enc.startsWith('"') && enc.endsWith('"')) enc = enc.slice(1, -1)
  const layer1 = aesGcmDecrypt(enc, dek)
  if (!layer1) throw new Error('Layer 1 decryption failed')
  const l1 = JSON.parse(layer1)
  const blobKey = '__om_encrypted_credentials_blob_v1'
  const plain = aesGcmDecrypt(l1[blobKey], dek)
  if (!plain) throw new Error('Layer 2 decryption failed')
  return JSON.parse(plain)
}

async function kfetch(url, init) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(10_000) })
}

function encryptToken(token, ts, pem) {
  return crypto.publicEncrypt(
    { key: pem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(`${token}|${ts}`, 'utf-8'),
  ).toString('base64')
}

async function getAccessToken(creds) {
  // public key
  const pkRes = await kfetch(`${BASE_URL}/security/public-key-certificates`, { method: 'GET', headers: { Accept: 'application/json' } })
  const certs = await pkRes.json()
  const cert = certs.find(c => c.usage?.includes('KsefTokenEncryption'))
  const pem = new crypto.X509Certificate(Buffer.from(cert.certificate, 'base64')).publicKey.export({ type: 'spki', format: 'pem' }).toString()

  // challenge
  const cr = await (await kfetch(`${BASE_URL}/auth/challenge`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json()
  const ts = cr.timestampMs ?? Date.now()

  // ksef-token
  const kr = await kfetch(`${BASE_URL}/auth/ksef-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challenge: cr.challenge, contextIdentifier: { type: 'nip', value: creds.nip }, encryptedToken: encryptToken(creds.ksef_token, ts, pem) }),
  })
  const kd = await kr.json()
  const authToken = kd.authenticationToken.token

  // poll
  const deadline = Date.now() + 30_000; let delay = 1000
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, delay)); delay = Math.min(delay * 1.5, 5000)
    const sd = await (await kfetch(`${BASE_URL}/auth/${kd.referenceNumber}`, { method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${authToken}` } })).json()
    const code = sd?.status?.code ?? -1
    if (code === 200) break
    if (code >= 400) throw new Error(`Poll: code=${code}`)
  }

  // redeem
  const rd = await (await kfetch(`${BASE_URL}/auth/token/redeem`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` }, body: '{}' })).json()
  return rd?.sessionToken?.token ?? rd?.accessToken?.token
}

async function probe(label, url, init) {
  try {
    const res = await kfetch(url, init)
    const body = await res.text()
    let bodySnippet
    try { bodySnippet = JSON.stringify(JSON.parse(body), null, 2).slice(0, 500) } catch { bodySnippet = body.slice(0, 300) }
    console.log(`  [${res.status}] ${label}`)
    if (res.status !== 404) console.log(`         ${bodySnippet}`)
  } catch (err) {
    console.log(`  [ERR] ${label} — ${err.message}`)
  }
}

console.log('Reading credentials from DB …')
const creds = getKsefCredentials()
console.log(`NIP=${creds.nip}  env=${creds.environment}`)

console.log('\nAuthenticating …')
const token = await getAccessToken(creds)
console.log(`Access token: ${token.slice(0, 20)}…\n`)

const h = { Accept: 'application/json', Authorization: `Bearer ${token}` }
const d2 = new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10)
const today = new Date().toISOString().slice(0, 10)

console.log('═══ Probing received-invoice endpoints ═══════════════════')

// Standard candidates
await probe(`GET /invoices`, `${BASE_URL}/invoices`, { method: 'GET', headers: h })
await probe(`GET /invoices?direction=received`, `${BASE_URL}/invoices?direction=received&dateFrom=${d2}&dateTo=${today}`, { method: 'GET', headers: h })
await probe(`GET /invoices/received`, `${BASE_URL}/invoices/received`, { method: 'GET', headers: h })
await probe(`GET /invoices/received?dateFrom`, `${BASE_URL}/invoices/received?dateFrom=${d2}&dateTo=${today}&pageSize=10&pageOffset=0`, { method: 'GET', headers: h })
await probe(`POST /invoices/query`, `${BASE_URL}/invoices/query`, { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ dateFrom: d2, dateTo: today }) })
await probe(`GET /invoice`, `${BASE_URL}/invoice`, { method: 'GET', headers: h })
await probe(`GET /invoice/received`, `${BASE_URL}/invoice/received`, { method: 'GET', headers: h })
await probe(`GET /invoice/received?dateFrom`, `${BASE_URL}/invoice/received?dateFrom=${d2}&dateTo=${today}&pageSize=10`, { method: 'GET', headers: h })
await probe(`GET /invoice/GetReferenceNumbers`, `${BASE_URL}/invoice/GetReferenceNumbers?dateFrom=${d2}&dateTo=${today}`, { method: 'GET', headers: h })

// KSeF ref download candidates
const ref = '9720865431-20260521-5DD4C3C00000-1E'
const refEnc = encodeURIComponent(ref)
console.log('\n═══ Probing download endpoints ═══════════════════════════')
await probe(`GET /invoices/${refEnc}`, `${BASE_URL}/invoices/${refEnc}`, { method: 'GET', headers: { ...h, Accept: 'application/xml' } })
await probe(`GET /invoice/${refEnc}`, `${BASE_URL}/invoice/${refEnc}`, { method: 'GET', headers: { ...h, Accept: 'application/xml' } })
await probe(`GET /invoices/${refEnc} (json)`, `${BASE_URL}/invoices/${refEnc}`, { method: 'GET', headers: h })
await probe(`GET /invoice/${refEnc} (json)`, `${BASE_URL}/invoice/${refEnc}`, { method: 'GET', headers: h })

// Check swagger / openapi
console.log('\n═══ Probing API discovery ════════════════════════════════')
await probe('GET /swagger/index.html', `${BASE_URL}/swagger/index.html`, { method: 'GET' })
await probe('GET /openapi.json', `${BASE_URL}/openapi.json`, { method: 'GET' })
await probe('GET /swagger/v1/swagger.json', `${BASE_URL}/swagger/v1/swagger.json`, { method: 'GET' })

console.log('\nDone.')
