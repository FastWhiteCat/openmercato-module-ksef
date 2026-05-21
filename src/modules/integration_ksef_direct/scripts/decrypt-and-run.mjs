/**
 * Decrypts KSeF credentials from DB (via psql) and runs the full debug flow:
 *   1. Auth challenge → ksef-token → poll → redeem
 *   2. GET /invoices (date range: last 2 days)
 *   3. GET /invoices/<ref> (specific reference)
 *
 * Usage:
 *   node decrypt-and-run.mjs
 *   DATABASE_URL=... TENANT_DATA_ENCRYPTION_FALLBACK_KEY=... node decrypt-and-run.mjs
 */
import crypto from 'node:crypto'
import { execSync } from 'node:child_process'

// ── Config ────────────────────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/open-mercato'
const ENCRYPTION_SECRET = process.env.TENANT_DATA_ENCRYPTION_FALLBACK_KEY ?? 'dev-tenant-encryption-fallback-key-32chars'
const KSEF_REF = process.env.KSEF_REF ?? '9720865431-20260521-5DD4C3C00000-1E'

// ── DB query via psql ─────────────────────────────────────────────────────────

function queryDB(sql) {
  const result = execSync(
    `psql "${DATABASE_URL}" --no-align --tuples-only --field-separator='|' -c "${sql.replace(/"/g, '\\"')}"`,
    { encoding: 'utf-8', timeout: 10_000 }
  ).trim()
  return result
}

// ── DEK derivation (mirrors DerivedKmsService) ────────────────────────────────

function deriveTenantDek(secret, tenantId) {
  const root = crypto.createHash('sha256').update(secret).digest()
  const derived = crypto.pbkdf2Sync(root, tenantId, 310_000, 32, 'sha512')
  return derived.toString('base64')
}

// ── AES-GCM decrypt (mirrors decryptWithAesGcm) ───────────────────────────────

function aesGcmDecrypt(payload, dekBase64) {
  if (!payload) return null
  const parts = payload.split(':')
  if (parts.length !== 4 || parts[3] !== 'v1') return null
  const [ivB64, ctB64, tagB64] = parts
  const dek = Buffer.from(dekBase64, 'base64')
  const iv = Buffer.from(ivB64, 'base64')
  const ciphertext = Buffer.from(ctB64, 'base64')
  const tag = Buffer.from(tagB64, 'base64')
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', dek, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8')
  } catch {
    return null
  }
}

// ── Read + decrypt credentials ────────────────────────────────────────────────

function getKsefCredentials() {
  const sql = `SELECT credentials::text, tenant_id, organization_id FROM integration_credentials WHERE integration_id = 'integration_ksef_direct' AND deleted_at IS NULL LIMIT 1`
  const row = queryDB(sql)
  if (!row) throw new Error('No integration_ksef_direct row in DB')

  // psql field-separator is |, but credentials may contain | so split only on first two
  const firstPipe = row.indexOf('|')
  const secondPipe = row.indexOf('|', firstPipe + 1)

  const rawCredentials = row.slice(0, firstPipe)
  const tenantId = row.slice(firstPipe + 1, secondPipe)
  const orgId = row.slice(secondPipe + 1)

  console.log(`\nFound row — tenant=${tenantId}  org=${orgId}`)
  console.log(`Raw credentials length: ${rawCredentials.length}`)
  console.log(`Raw credentials prefix: ${rawCredentials.slice(0, 40)}`)

  const dek = deriveTenantDek(ENCRYPTION_SECRET, tenantId)
  console.log(`Derived DEK (first 16 base64 chars): ${dek.slice(0, 16)}…`)

  // The credentials column stores an AES-GCM–encrypted string (field-level encryption).
  // Strip surrounding JSON string quotes if present.
  let encryptedField = rawCredentials
  if (encryptedField.startsWith('"') && encryptedField.endsWith('"')) {
    encryptedField = encryptedField.slice(1, -1)
  }

  // Layer 1: field-level decryption
  const layer1 = aesGcmDecrypt(encryptedField, dek)
  if (!layer1) {
    // Maybe it wasn't encrypted at field level — try to parse directly
    try {
      const direct = JSON.parse(rawCredentials)
      const blobKey = '__om_encrypted_credentials_blob_v1'
      if (typeof direct === 'object' && direct[blobKey]) {
        const plain = aesGcmDecrypt(direct[blobKey], dek)
        if (!plain) throw new Error('Layer 2 blob decryption failed (direct JSON path)')
        return { tenantId, orgId, creds: JSON.parse(plain) }
      }
      if (typeof direct === 'object' && (direct.ksef_token || direct.nip)) {
        return { tenantId, orgId, creds: direct }
      }
    } catch {}
    throw new Error(`Layer 1 decryption failed — wrong DEK? Raw prefix: ${encryptedField.slice(0, 40)}`)
  }

  console.log(`Layer 1 decrypted (first 60): ${layer1.slice(0, 60)}`)

  let layer1Parsed
  try {
    layer1Parsed = JSON.parse(layer1)
  } catch {
    throw new Error(`Layer 1 decrypted value is not JSON: ${layer1.slice(0, 100)}`)
  }

  const blobKey = '__om_encrypted_credentials_blob_v1'
  if (typeof layer1Parsed[blobKey] === 'string') {
    const plain = aesGcmDecrypt(layer1Parsed[blobKey], dek)
    if (!plain) throw new Error('Layer 2 blob decryption failed')
    console.log(`Layer 2 decrypted (first 60): ${plain.slice(0, 60)}`)
    return { tenantId, orgId, creds: JSON.parse(plain) }
  }

  // No blob — layer 1 IS the plaintext credentials
  return { tenantId, orgId, creds: layer1Parsed }
}

// ── KSeF network helpers ──────────────────────────────────────────────────────

function isoDate(d) { return d.toISOString().slice(0, 10) }

async function kfetch(url, init) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) })
  if (res.status === 429) {
    const wait = parseInt(res.headers.get('Retry-After') ?? '2', 10) * 1000
    console.warn(`  ⏳ 429 — waiting ${wait}ms`)
    await new Promise(r => setTimeout(r, wait))
    return fetch(url, { ...init, signal: AbortSignal.timeout(15_000) })
  }
  return res
}

async function logRes(label, res, body) {
  console.log(`\n── ${label} ────────────────────────────`)
  console.log(`  HTTP ${res.status} ${res.statusText}`)
  try {
    const p = JSON.parse(body)
    console.log('  Body:', JSON.stringify(p, null, 2).slice(0, 3000))
  } catch {
    console.log('  Body (raw):', body.slice(0, 2000))
  }
}

// ── Auth ──────────────────────────────────────────────────────────────────────

async function fetchPublicKey(baseUrl) {
  console.log(`\n[1] GET ${baseUrl}/security/public-key-certificates`)
  const res = await kfetch(`${baseUrl}/security/public-key-certificates`, {
    method: 'GET', headers: { Accept: 'application/json' },
  })
  const body = await res.text()
  await logRes('public-key-certificates', res, body)
  if (!res.ok) throw new Error(`Public-key fetch failed: ${res.status}`)
  const certs = JSON.parse(body)
  console.log('  Cert usages:', certs.map(c => c.usage))
  const cert = certs.find(c => c.usage?.includes('KsefTokenEncryption'))
  if (!cert) throw new Error('No KsefTokenEncryption cert found')
  const der = Buffer.from(cert.certificate, 'base64')
  const x509 = new crypto.X509Certificate(der)
  return x509.publicKey.export({ type: 'spki', format: 'pem' }).toString()
}

function encryptToken(token, ts, pem) {
  return crypto.publicEncrypt(
    { key: pem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(`${token}|${ts}`, 'utf-8'),
  ).toString('base64')
}

async function authenticate(baseUrl, ksefToken, nip) {
  const pem = await fetchPublicKey(baseUrl)

  console.log(`\n[2] POST ${baseUrl}/auth/challenge`)
  const cr = await kfetch(`${baseUrl}/auth/challenge`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  })
  const cb = await cr.text()
  await logRes('auth/challenge', cr, cb)
  if (!cr.ok) throw new Error(`Challenge: ${cr.status} — ${cb}`)
  const { challenge, timestampMs } = JSON.parse(cb)
  const ts = timestampMs ?? Date.now()
  console.log(`  challenge=${challenge}  ts=${ts}`)

  console.log(`\n[3] POST ${baseUrl}/auth/ksef-token`)
  const kr = await kfetch(`${baseUrl}/auth/ksef-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challenge, contextIdentifier: { type: 'nip', value: nip }, encryptedToken: encryptToken(ksefToken, ts, pem) }),
  })
  const kb = await kr.text()
  await logRes('auth/ksef-token', kr, kb)
  if (!kr.ok) throw new Error(`ksef-token: ${kr.status} — ${kb}`)
  const { referenceNumber, authenticationToken } = JSON.parse(kb)
  const authToken = authenticationToken.token
  console.log(`  referenceNumber=${referenceNumber}`)

  console.log('\n[4] Polling …')
  const deadline = Date.now() + 30_000
  let delay = 1000, ok = false
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, delay))
    delay = Math.min(delay * 1.5, 5000)
    const sr = await kfetch(`${baseUrl}/auth/${referenceNumber}`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${authToken}` },
    })
    const sd = JSON.parse(await sr.text())
    const code = sd?.status?.code ?? -1
    console.log(`  → code=${code}  desc=${sd?.status?.description ?? ''}`)
    if (code === 200) { ok = true; break }
    if (code >= 400) throw new Error(`Poll failed: code=${code}`)
  }
  if (!ok) throw new Error('Auth timed out')

  console.log(`\n[5] POST ${baseUrl}/auth/token/redeem`)
  const rr = await kfetch(`${baseUrl}/auth/token/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: '{}',
  })
  const rb = await rr.text()
  await logRes('auth/token/redeem', rr, rb)
  if (!rr.ok) throw new Error(`Redeem: ${rr.status} — ${rb}`)
  const rd = JSON.parse(rb)
  const accessToken = rd?.sessionToken?.token ?? rd?.accessToken?.token
  if (!accessToken) throw new Error(`No accessToken: ${rb}`)
  console.log(`  ✅ accessToken len=${accessToken.length}`)
  return accessToken
}

// ── Query / Download ──────────────────────────────────────────────────────────

async function queryReceived(baseUrl, accessToken, dateFrom, dateTo) {
  const url = new URL(`${baseUrl}/invoices`)
  url.searchParams.set('dateFrom', dateFrom)
  url.searchParams.set('dateTo', dateTo)
  url.searchParams.set('pageSize', '100')
  url.searchParams.set('pageOffset', '0')
  console.log(`\n[6] GET /invoices?dateFrom=${dateFrom}&dateTo=${dateTo}`)
  console.log(`  Full URL: ${url}`)
  const res = await kfetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
  })
  const body = await res.text()
  await logRes('invoices (date range)', res, body)
  if (res.ok) {
    try {
      const d = JSON.parse(body)
      console.log(`  ✅ totalCount=${d.totalCount ?? '?'}  items=${d.invoices?.length ?? 0}`)
    } catch { console.error('  ⚠️ Not JSON') }
  } else {
    console.error(`  ❌ HTTP ${res.status}`)
  }
}

async function downloadSingle(baseUrl, accessToken, ref) {
  const url = `${baseUrl}/invoices/${encodeURIComponent(ref)}`
  console.log(`\n[7] GET /invoices/${ref}`)
  const res = await kfetch(url, {
    method: 'GET',
    headers: { Accept: 'application/xml', Authorization: `Bearer ${accessToken}` },
  })
  const body = await res.text()
  await logRes(`invoices/${ref}`, res, body)
  if (res.ok) {
    console.log(`  ✅ ${body.length} bytes XML`)
    console.log(`  First 300: ${body.slice(0, 300)}`)
  } else {
    console.error(`  ❌ HTTP ${res.status}`)
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('═══════════════════════════════════════════════════════════')
console.log('KSeF Debug — reading credentials from DB')
console.log(`DB: ${DATABASE_URL}`)
console.log(`Secret (prefix): ${ENCRYPTION_SECRET.slice(0, 8)}…`)
console.log('═══════════════════════════════════════════════════════════')

let info
try {
  info = getKsefCredentials()
} catch (err) {
  console.error('\n❌ Failed to read/decrypt credentials:', err.message)
  process.exit(1)
}

const { tenantId, orgId, creds } = info
console.log('\n✅ Decrypted credentials:')
console.log(`  nip         = ${creds.nip}`)
console.log(`  environment = ${creds.environment}`)
console.log(`  ksef_token  = ${String(creds.ksef_token ?? '').slice(0, 12)}… (len=${String(creds.ksef_token ?? '').length})`)

const BASE_URL = creds.environment === 'production'
  ? 'https://api.ksef.mf.gov.pl/v2'
  : 'https://api-test.ksef.mf.gov.pl/v2'

const today = isoDate(new Date())
const twoDaysAgo = isoDate(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000))

console.log(`\nBase URL   : ${BASE_URL}`)
console.log(`Date range : ${twoDaysAgo} → ${today}`)
console.log(`Single ref : ${KSEF_REF}`)
console.log('═══════════════════════════════════════════════════════════')

let accessToken
try {
  accessToken = await authenticate(BASE_URL, creds.ksef_token, creds.nip)
} catch (err) {
  console.error('\n❌ Authentication failed:', err.message)
  process.exit(1)
}

await queryReceived(BASE_URL, accessToken, twoDaysAgo, today)
await downloadSingle(BASE_URL, accessToken, KSEF_REF)

console.log('\n═══════════════════════════════════════════════════════════')
console.log('Done.')
