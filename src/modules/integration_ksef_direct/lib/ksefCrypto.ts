import crypto from 'node:crypto'

type KsefEnvironment = 'test' | 'production'

const BASE_URLS: Record<KsefEnvironment, string> = {
  test: 'https://api-test.ksef.mf.gov.pl/v2',
  production: 'https://api.ksef.mf.gov.pl/v2',
}

interface PublicKeyCacheEntry {
  publicKeyPem: string
  fetchedAt: number
}

const PUBLIC_KEY_CACHE = new Map<KsefEnvironment, PublicKeyCacheEntry>()
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

interface PublicKeyCertificateEntry {
  certificate: string
  certificateId: string
  publicKeyId?: string
  validFrom?: string
  validTo?: string
  usage?: string[]
}

export async function fetchPublicKey(environment: KsefEnvironment): Promise<string> {
  const cached = PUBLIC_KEY_CACHE.get(environment)
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.publicKeyPem
  }

  const url = `${BASE_URLS[environment]}/security/public-key-certificates`
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(10_000),
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch KSeF public key: HTTP ${response.status}`)
  }

  const data = await response.json() as PublicKeyCertificateEntry[]
  if (!Array.isArray(data)) {
    throw new Error('KSeF public key response is not an array')
  }

  const tokenEncryptionCert = data.find(entry => entry.usage?.includes('KsefTokenEncryption'))
  if (!tokenEncryptionCert?.certificate) {
    throw new Error('KSeF public key response missing KsefTokenEncryption certificate')
  }

  const derBuffer = Buffer.from(tokenEncryptionCert.certificate, 'base64')
  const x509 = new crypto.X509Certificate(derBuffer)
  const publicKeyPem = x509.publicKey.export({ type: 'spki', format: 'pem' }).toString()

  PUBLIC_KEY_CACHE.set(environment, { publicKeyPem, fetchedAt: Date.now() })
  return publicKeyPem
}

export function clearPublicKeyCache(environment?: KsefEnvironment): void {
  if (environment) {
    PUBLIC_KEY_CACHE.delete(environment)
  } else {
    PUBLIC_KEY_CACHE.clear()
  }
}

export function encryptKsefToken(token: string, timestampMs: number, publicKeyPem: string): string {
  const plaintext = `${token}|${timestampMs}`
  const encrypted = crypto.publicEncrypt(
    {
      key: publicKeyPem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    Buffer.from(plaintext, 'utf-8'),
  )
  return encrypted.toString('base64')
}

export function generateSymmetricKey(): { key: Buffer; iv: Buffer } {
  return {
    key: crypto.randomBytes(32),
    iv: crypto.randomBytes(16),
  }
}
