import { randomBytes } from 'crypto'

// Format: FV/{yyyy}/{mm}/{nanoid:8} — extensible to per-tenant configurable format in the future
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const MAX_VALID = 256 - (256 % ALPHABET.length)

function createAlphanumericId(size: number): string {
  let id = ''
  while (id.length < size) {
    const byte = randomBytes(1)[0]
    if (byte >= MAX_VALID) continue
    id += ALPHABET[byte % ALPHABET.length]
  }
  return id
}

export function generateKsefInvoiceNumber(): string {
  const now = new Date()
  const yyyy = String(now.getFullYear())
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const unique = createAlphanumericId(8)
  return `FV/${yyyy}/${mm}/${unique}`
}
