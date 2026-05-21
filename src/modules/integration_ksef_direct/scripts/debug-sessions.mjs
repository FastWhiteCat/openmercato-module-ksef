/**
 * Tests the new session-based received-invoices flow.
 * Mirrors what queryReceivedInvoices + downloadInvoice now do in ksefClient.ts.
 */
import crypto from 'node:crypto'
import { execSync } from 'node:child_process'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/open-mercato'
const ENCRYPTION_SECRET = process.env.TENANT_DATA_ENCRYPTION_FALLBACK_KEY ?? 'dev-tenant-encryption-fallback-key-32chars'

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
  const plain = aesGcmDecrypt(l1['__om_encrypted_credentials_blob_v1'], dek)
  if (!plain) throw new Error('Layer 2 decryption failed')
  return JSON.parse(plain)
}

async function kfetch(url, init) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) })
  if (res.status === 429) {
    const wait = parseInt(res.headers.get('Retry-After') ?? '2', 10) * 1000
    console.warn(`  ⏳ 429 rate-limited, waiting ${wait}ms`)
    await new Promise(r => setTimeout(r, wait))
    return fetch(url, { ...init, signal: AbortSignal.timeout(15_000) })
  }
  return res
}

function encryptToken(token, ts, pem) {
  return crypto.publicEncrypt(
    { key: pem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(`${token}|${ts}`, 'utf-8'),
  ).toString('base64')
}

async function getAccessToken(baseUrl, creds) {
  const pkRes = await kfetch(`${baseUrl}/security/public-key-certificates`, { method: 'GET', headers: { Accept: 'application/json' } })
  const certs = await pkRes.json()
  const cert = certs.find(c => c.usage?.includes('KsefTokenEncryption'))
  const pem = new crypto.X509Certificate(Buffer.from(cert.certificate, 'base64')).publicKey.export({ type: 'spki', format: 'pem' }).toString()

  const cr = await (await kfetch(`${baseUrl}/auth/challenge`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json()
  const ts = cr.timestampMs ?? Date.now()

  const kr = await kfetch(`${baseUrl}/auth/ksef-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challenge: cr.challenge, contextIdentifier: { type: 'nip', value: creds.nip }, encryptedToken: encryptToken(creds.ksef_token, ts, pem) }),
  })
  const kd = await kr.json()
  if (!kd.authenticationToken) throw new Error(`ksef-token failed: ${JSON.stringify(kd)}`)
  const authToken = kd.authenticationToken.token

  const deadline = Date.now() + 30_000; let delay = 1000
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, delay)); delay = Math.min(delay * 1.5, 5000)
    const sd = await (await kfetch(`${baseUrl}/auth/${kd.referenceNumber}`, { method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${authToken}` } })).json()
    const code = sd?.status?.code ?? -1
    if (code === 200) break
    if (code >= 400) throw new Error(`Poll: code=${code} — ${JSON.stringify(sd)}`)
  }

  const rd = await (await kfetch(`${baseUrl}/auth/token/redeem`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` }, body: '{}' })).json()
  const token = rd?.sessionToken?.token ?? rd?.accessToken?.token
  if (!token) throw new Error(`No token in redeem response: ${JSON.stringify(rd)}`)
  return token
}

// ── Main ─────────────────────────────────────────────────────────────────────

const creds = getKsefCredentials()
console.log(`NIP=${creds.nip}  env=${creds.environment}`)

const BASE_URL = creds.environment === 'production'
  ? 'https://api.ksef.mf.gov.pl/v2'
  : 'https://api-test.ksef.mf.gov.pl/v2'

console.log('\nAuthenticating …')
const token = await getAccessToken(BASE_URL, creds)
console.log(`Token: ${token.slice(0, 20)}…`)

const h = { Accept: 'application/json', Authorization: `Bearer ${token}` }

const today = new Date().toISOString().slice(0, 10)
const d30 = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10)
console.log(`\nDate range: ${d30} → ${today}`)

// ── Step 1: list received sessions ───────────────────────────────────────────
console.log('\n═══ GET /sessions?direction=received ════════════════════════')
const sessionUrl = new URL(`${BASE_URL}/sessions`)
sessionUrl.searchParams.set('sessionType', 'online')
sessionUrl.searchParams.set('direction', 'received')
sessionUrl.searchParams.set('dateFrom', d30)
sessionUrl.searchParams.set('dateTo', today)

const sessionRes = await kfetch(sessionUrl.toString(), { method: 'GET', headers: h })
const sessionBody = await sessionRes.text()
console.log(`HTTP ${sessionRes.status}`)
if (!sessionRes.ok) {
  console.error('Failed:', sessionBody)
  process.exit(1)
}

const sessionData = JSON.parse(sessionBody)
console.log(`continuationToken: ${sessionData.continuationToken ?? 'none'}`)
const sessions = sessionData.sessions ?? []
console.log(`Sessions found: ${sessions.length}`)
sessions.forEach((s, i) => console.log(`  [${i}] ${s.referenceNumber}  status=${JSON.stringify(s.status)}`))

// ── Step 2: list invoices in each session ────────────────────────────────────
const allInvoices = []
for (const session of sessions) {
  console.log(`\n═══ GET /sessions/${session.referenceNumber}/invoices ══════`)
  const invRes = await kfetch(
    `${BASE_URL}/sessions/${encodeURIComponent(session.referenceNumber)}/invoices`,
    { method: 'GET', headers: h }
  )
  const invBody = await invRes.text()
  console.log(`HTTP ${invRes.status}`)
  if (!invRes.ok) { console.error('  Failed:', invBody.slice(0, 300)); continue }

  const invData = JSON.parse(invBody)
  const invoices = invData.invoices ?? []
  console.log(`  Invoices in session: ${invoices.length}  (continuationToken=${invData.continuationToken ?? 'none'})`)
  for (const inv of invoices) {
    const ksefRef = inv.ksefNumber ?? inv.ksefReferenceNumber ?? inv.referenceNumber
    console.log(`\n  Invoice:`)
    console.log(`    ksefNumber/ref  : ${ksefRef}`)
    console.log(`    issueDate       : ${inv.issueDate ?? 'n/a'}`)
    console.log(`    subjectBy       : ${JSON.stringify(inv.subjectBy ?? {})}`)
    console.log(`    grossAmount     : ${inv.grossAmount ?? 'n/a'}`)
    console.log(`    netAmount       : ${inv.netAmount ?? 'n/a'}`)
    console.log(`    vatAmount       : ${inv.vatAmount ?? 'n/a'}`)
    console.log(`    currency        : ${inv.currency ?? 'n/a'}`)
    console.log(`    invoiceNumber   : ${inv.invoiceNumber ?? 'n/a'}`)
    console.log(`    upoDownloadUrl  : ${inv.upoDownloadUrl ?? 'none'}`)
    console.log(`    invoiceDownloadUrl: ${inv.invoiceDownloadUrl ?? 'none'}`)
    console.log(`    ALL KEYS        : ${Object.keys(inv).join(', ')}`)
    allInvoices.push({ ...inv, _sessionRef: session.referenceNumber, _ksefRef: ksefRef })
  }

  // Also dump raw JSON for full field inspection (first session only)
  if (session === sessions[0]) {
    console.log('\n  Raw JSON (first session):')
    console.log(JSON.stringify(invData, null, 2).slice(0, 3000))
  }
}

// ── Step 3: fetch invoice detail for first found invoice ─────────────────────
if (allInvoices.length > 0) {
  const inv = allInvoices[0]
  const sessionRef = inv._sessionRef
  const invRef = inv.referenceNumber
  console.log(`\n═══ GET /sessions/${sessionRef}/invoices/${invRef} ══════════`)
  const detailRes = await kfetch(
    `${BASE_URL}/sessions/${encodeURIComponent(sessionRef)}/invoices/${encodeURIComponent(invRef)}`,
    { method: 'GET', headers: h }
  )
  const detailBody = await detailRes.text()
  console.log(`HTTP ${detailRes.status}`)
  try {
    console.log(JSON.stringify(JSON.parse(detailBody), null, 2).slice(0, 3000))
  } catch { console.log(detailBody.slice(0, 1000)) }

  // ── Step 4: try to download from URLs ──────────────────────────────────────
  const upoUrl = inv.upoDownloadUrl
  const invoiceUrl = inv.invoiceDownloadUrl

  if (invoiceUrl) {
    console.log(`\n═══ Downloading invoiceDownloadUrl ════════════════════════`)
    const dl = await fetch(invoiceUrl, { signal: AbortSignal.timeout(15_000) })
    console.log(`HTTP ${dl.status}  Content-Type: ${dl.headers.get('content-type')}`)
    const content = await dl.text()
    console.log(`Content length: ${content.length}`)
    console.log(`First 1000 chars:\n${content.slice(0, 1000)}`)
  }

  if (upoUrl) {
    console.log(`\n═══ Downloading upoDownloadUrl ════════════════════════════`)
    const dl = await fetch(upoUrl, { signal: AbortSignal.timeout(15_000) })
    console.log(`HTTP ${dl.status}  Content-Type: ${dl.headers.get('content-type')}`)
    const content = await dl.text()
    console.log(`Content length: ${content.length}`)
    console.log(`First 1000 chars:\n${content.slice(0, 1000)}`)
  }
} else {
  console.log('\nNo invoices found in any session.')
}

console.log('\nDone.')
