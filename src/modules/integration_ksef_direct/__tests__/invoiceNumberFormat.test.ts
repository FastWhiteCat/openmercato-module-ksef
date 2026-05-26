import { generateKsefInvoiceNumber } from '../lib/invoiceNumberFormat'

describe('generateKsefInvoiceNumber', () => {
  it('returns a string in the format FV/{yyyy}/{mm}/{8 chars}', () => {
    const result = generateKsefInvoiceNumber()
    expect(typeof result).toBe('string')
    expect(result).toMatch(/^FV\/\d{4}\/\d{2}\/[0-9A-Z]{8}$/)
  })

  it('uses the current year in the generated number', () => {
    const result = generateKsefInvoiceNumber()
    const year = new Date().getFullYear().toString()
    expect(result.startsWith(`FV/${year}/`)).toBe(true)
  })

  it('uses the current month (zero-padded) in the generated number', () => {
    const result = generateKsefInvoiceNumber()
    const month = String(new Date().getMonth() + 1).padStart(2, '0')
    const parts = result.split('/')
    expect(parts[2]).toBe(month)
  })

  it('generates an 8-character alphanumeric suffix using only uppercase letters and digits', () => {
    const result = generateKsefInvoiceNumber()
    const suffix = result.split('/')[3]!
    expect(suffix).toHaveLength(8)
    expect(suffix).toMatch(/^[0-9A-Z]+$/)
  })

  it('generates unique values on successive calls', () => {
    const results = new Set(Array.from({ length: 20 }, () => generateKsefInvoiceNumber()))
    // With 36^8 ≈ 2.8 trillion combinations, collision in 20 draws is astronomically unlikely
    expect(results.size).toBe(20)
  })

  it('always produces exactly 4 parts when split by "/"', () => {
    const result = generateKsefInvoiceNumber()
    const parts = result.split('/')
    expect(parts).toHaveLength(4)
    expect(parts[0]).toBe('FV')
  })
})
