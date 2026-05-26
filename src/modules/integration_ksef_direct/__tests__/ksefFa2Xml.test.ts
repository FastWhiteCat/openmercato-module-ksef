import { generateFa2Xml, KsefXmlGenerationError, type SellerInfo } from '../lib/ksefFa2Xml'
import type { KsefDirectDocument, KsefDirectStoredLineItem } from '../data/entities'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLineItem(overrides: Partial<KsefDirectStoredLineItem> = {}): KsefDirectStoredLineItem {
  return {
    description: 'Test service',
    quantity: 1,
    unit: 'szt',
    unitNetPrice: 100,
    vatRate: '23',
    netAmount: 100,
    vatAmount: 23,
    grossAmount: 123,
    ...overrides,
  }
}

function makeDocument(overrides: Partial<KsefDirectDocument> = {}): KsefDirectDocument {
  return {
    id: 'doc-uuid-1',
    organizationId: 'org-uuid-1',
    tenantId: 'tenant-uuid-1',
    source: 'manual',
    status: 'draft',
    sellerNip: '1234567890',
    buyerNip: '0987654321',
    buyerName: 'Buyer Sp. z o.o.',
    invoiceNumber: 'FV/2025/01/TESTTEST',
    issueDate: new Date('2025-01-15'),
    saleDate: null,
    netAmount: '100.00',
    vatAmount: '23.00',
    grossAmount: '123.00',
    currency: 'PLN',
    lineItems: [makeLineItem()],
    notes: null,
    ksefReferenceNumber: null,
    ksefProcessingReferenceNumber: null,
    sellerName: null,
    sellerAddressL1: null,
    sellerCity: null,
    sellerCountry: null,
    errorMessage: null,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  } as KsefDirectDocument
}

const DEFAULT_SELLER: SellerInfo = {
  sellerName: 'Seller Sp. z o.o.',
  sellerAddressL1: 'ul. Testowa 1',
  sellerCity: 'Warszawa',
  sellerCountry: 'PL',
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateFa2Xml', () => {
  describe('validation — required seller fields', () => {
    it('throws KsefXmlGenerationError when sellerName is empty', () => {
      const doc = makeDocument()
      expect(() => generateFa2Xml(doc, { ...DEFAULT_SELLER, sellerName: '' })).toThrow(
        KsefXmlGenerationError,
      )
    })

    it('throws KsefXmlGenerationError when sellerName is whitespace-only', () => {
      const doc = makeDocument()
      expect(() => generateFa2Xml(doc, { ...DEFAULT_SELLER, sellerName: '   ' })).toThrow(
        KsefXmlGenerationError,
      )
    })

    it('throws KsefXmlGenerationError when sellerAddressL1 is absent', () => {
      const doc = makeDocument()
      const seller: SellerInfo = { sellerName: 'Seller', sellerAddressL1: undefined }
      expect(() => generateFa2Xml(doc, seller)).toThrow(KsefXmlGenerationError)
    })

    it('throws KsefXmlGenerationError when sellerAddressL1 is whitespace-only', () => {
      const doc = makeDocument()
      expect(() => generateFa2Xml(doc, { ...DEFAULT_SELLER, sellerAddressL1: '   ' })).toThrow(
        KsefXmlGenerationError,
      )
    })

    it('error name is "KsefXmlGenerationError"', () => {
      const doc = makeDocument()
      try {
        generateFa2Xml(doc, { ...DEFAULT_SELLER, sellerName: '' })
        fail('expected to throw')
      } catch (err) {
        expect((err as Error).name).toBe('KsefXmlGenerationError')
      }
    })
  })

  describe('XML structure', () => {
    let xml: string

    beforeEach(() => {
      xml = generateFa2Xml(makeDocument(), DEFAULT_SELLER)
    })

    it('produces a string starting with the XML declaration', () => {
      expect(xml).toMatch(/^<\?xml version="1\.0"/)
    })

    it('uses the FA(2) namespace', () => {
      expect(xml).toContain('xmlns="http://crd.gov.pl/wzor/2023/06/29/12648/"')
    })

    it('includes the KodFormularza element with value FA', () => {
      expect(xml).toContain('<KodFormularza kodSystemowy="FA (2)" wersjaSchemy="1-0E">FA</KodFormularza>')
    })

    it('includes WariantFormularza = 2', () => {
      expect(xml).toContain('<WariantFormularza>2</WariantFormularza>')
    })

    it('includes SystemInfo = OpenMercato', () => {
      expect(xml).toContain('<SystemInfo>OpenMercato</SystemInfo>')
    })

    it('includes RodzajFaktury = VAT', () => {
      expect(xml).toContain('<RodzajFaktury>VAT</RodzajFaktury>')
    })
  })

  describe('seller (Podmiot1) data', () => {
    it('places seller NIP inside Podmiot1', () => {
      const xml = generateFa2Xml(makeDocument(), DEFAULT_SELLER)
      expect(xml).toContain('<NIP>1234567890</NIP>')
    })

    it('places seller name inside Podmiot1', () => {
      const xml = generateFa2Xml(makeDocument(), DEFAULT_SELLER)
      expect(xml).toContain('<Nazwa>Seller Sp. z o.o.</Nazwa>')
    })

    it('includes sellerAddressL1 inside Adres/AdresL1', () => {
      const xml = generateFa2Xml(makeDocument(), DEFAULT_SELLER)
      expect(xml).toContain('<AdresL1>ul. Testowa 1</AdresL1>')
    })

    it('includes sellerCity inside Adres/AdresL2', () => {
      const xml = generateFa2Xml(makeDocument(), DEFAULT_SELLER)
      expect(xml).toContain('<AdresL2>Warszawa</AdresL2>')
    })

    it('defaults KodKraju to PL when sellerCountry is not provided', () => {
      const sellerNoCountry: SellerInfo = {
        sellerName: 'Seller',
        sellerAddressL1: 'ul. X 1',
      }
      const xml = generateFa2Xml(makeDocument(), sellerNoCountry)
      expect(xml).toContain('<KodKraju>PL</KodKraju>')
    })

    it('uses the provided sellerCountry code when given', () => {
      const xml = generateFa2Xml(makeDocument(), { ...DEFAULT_SELLER, sellerCountry: 'DE' })
      expect(xml).toContain('<KodKraju>DE</KodKraju>')
    })

    it('omits AdresL2 when sellerCity is absent', () => {
      const sellerNoCity: SellerInfo = {
        sellerName: 'Seller',
        sellerAddressL1: 'ul. X 1',
      }
      const xml = generateFa2Xml(makeDocument(), sellerNoCity)
      expect(xml).not.toContain('<AdresL2>')
    })
  })

  describe('buyer (Podmiot2) data', () => {
    it('places buyer NIP inside Podmiot2', () => {
      const xml = generateFa2Xml(makeDocument(), DEFAULT_SELLER)
      expect(xml).toContain('<NIP>0987654321</NIP>')
    })

    it('places buyer name inside Podmiot2', () => {
      const xml = generateFa2Xml(makeDocument(), DEFAULT_SELLER)
      expect(xml).toContain('<Nazwa>Buyer Sp. z o.o.</Nazwa>')
    })

    it('outputs empty Nazwa when buyerName is null', () => {
      const doc = makeDocument({ buyerName: null })
      const xml = generateFa2Xml(doc, DEFAULT_SELLER)
      expect(xml).toContain('<Nazwa></Nazwa>')
    })
  })

  describe('Fa / invoice fields', () => {
    it('outputs KodWaluty matching the document currency', () => {
      const xml = generateFa2Xml(makeDocument(), DEFAULT_SELLER)
      expect(xml).toContain('<KodWaluty>PLN</KodWaluty>')
    })

    it('outputs P_1 as the formatted issue date (YYYY-MM-DD)', () => {
      const xml = generateFa2Xml(makeDocument(), DEFAULT_SELLER)
      expect(xml).toContain('<P_1>2025-01-15</P_1>')
    })

    it('outputs P_2 with the invoice number', () => {
      const xml = generateFa2Xml(makeDocument(), DEFAULT_SELLER)
      expect(xml).toContain('<P_2>FV/2025/01/TESTTEST</P_2>')
    })

    it('outputs P_6 as the sale date when provided', () => {
      const doc = makeDocument({ saleDate: new Date('2025-01-20') })
      const xml = generateFa2Xml(doc, DEFAULT_SELLER)
      expect(xml).toContain('<P_6>2025-01-20</P_6>')
    })

    it('falls back P_6 to issueDate when saleDate is null', () => {
      const xml = generateFa2Xml(makeDocument(), DEFAULT_SELLER) // saleDate: null
      expect(xml).toContain('<P_6>2025-01-15</P_6>')
    })

    it('outputs P_15 as the gross amount (2 decimal places)', () => {
      const xml = generateFa2Xml(makeDocument(), DEFAULT_SELLER)
      expect(xml).toContain('<P_15>123.00</P_15>')
    })
  })

  describe('line items (FaWiersz)', () => {
    it('outputs a FaWiersz element for each line item', () => {
      const doc = makeDocument({
        lineItems: [
          makeLineItem({ description: 'Item A' }),
          makeLineItem({ description: 'Item B' }),
        ],
      })
      const xml = generateFa2Xml(doc, DEFAULT_SELLER)
      const matches = xml.match(/<FaWiersz>/g)
      expect(matches).toHaveLength(2)
    })

    it('sets NrWierszaFa starting from 1', () => {
      const xml = generateFa2Xml(makeDocument(), DEFAULT_SELLER)
      expect(xml).toContain('<NrWierszaFa>1</NrWierszaFa>')
    })

    it('outputs P_7 with the item description', () => {
      const xml = generateFa2Xml(makeDocument(), DEFAULT_SELLER)
      expect(xml).toContain('<P_7>Test service</P_7>')
    })

    it('outputs P_8A with the unit', () => {
      const xml = generateFa2Xml(makeDocument(), DEFAULT_SELLER)
      expect(xml).toContain('<P_8A>szt</P_8A>')
    })

    it('outputs P_8B with the quantity', () => {
      const xml = generateFa2Xml(makeDocument(), DEFAULT_SELLER)
      expect(xml).toContain('<P_8B>1</P_8B>')
    })

    it('outputs P_9A with the unit net price (2 decimal places)', () => {
      const xml = generateFa2Xml(makeDocument(), DEFAULT_SELLER)
      expect(xml).toContain('<P_9A>100.00</P_9A>')
    })

    it('outputs P_11 with the net amount (2 decimal places)', () => {
      const xml = generateFa2Xml(makeDocument(), DEFAULT_SELLER)
      expect(xml).toContain('<P_11>100.00</P_11>')
    })

    it('uses the correct P_12 code for 23% VAT rate', () => {
      const xml = generateFa2Xml(makeDocument(), DEFAULT_SELLER)
      expect(xml).toContain('<P_12>23</P_12>')
    })

    it('uses the correct P_12 code (zw) for ZW exempt rate', () => {
      const doc = makeDocument({
        lineItems: [makeLineItem({ vatRate: 'ZW', vatAmount: 0 })],
      })
      const xml = generateFa2Xml(doc, DEFAULT_SELLER)
      expect(xml).toContain('<P_12>zw</P_12>')
    })

    it('uses the correct P_12 code (np) for NP rate', () => {
      const doc = makeDocument({
        lineItems: [makeLineItem({ vatRate: 'NP', vatAmount: 0 })],
      })
      const xml = generateFa2Xml(doc, DEFAULT_SELLER)
      expect(xml).toContain('<P_12>np</P_12>')
    })
  })

  describe('VAT summary (P_13/P_14 grouping)', () => {
    it('outputs P_13_1 (net) for 23% VAT rate', () => {
      const xml = generateFa2Xml(makeDocument(), DEFAULT_SELLER)
      expect(xml).toContain('<P_13_1>100.00</P_13_1>')
    })

    it('outputs P_14_1 (VAT) for 23% VAT rate', () => {
      const xml = generateFa2Xml(makeDocument(), DEFAULT_SELLER)
      expect(xml).toContain('<P_14_1>23.00</P_14_1>')
    })

    it('does not output P_14_4 (VAT) for 0% rate (hasVat = false)', () => {
      const doc = makeDocument({
        lineItems: [makeLineItem({ vatRate: '0', vatAmount: 0 })],
      })
      const xml = generateFa2Xml(doc, DEFAULT_SELLER)
      expect(xml).not.toContain('<P_14_4>')
      expect(xml).toContain('<P_13_4>')
    })

    it('does not output P_14_5 for ZW (exempt) rate', () => {
      const doc = makeDocument({
        lineItems: [makeLineItem({ vatRate: 'ZW', vatAmount: 0 })],
      })
      const xml = generateFa2Xml(doc, DEFAULT_SELLER)
      expect(xml).not.toContain('<P_14_5>')
      expect(xml).toContain('<P_13_5>')
    })

    it('accumulates multiple lines with the same VAT rate into a single group', () => {
      const doc = makeDocument({
        lineItems: [
          makeLineItem({ vatRate: '23', netAmount: 100, vatAmount: 23 }),
          makeLineItem({ vatRate: '23', netAmount: 200, vatAmount: 46 }),
        ],
        grossAmount: '369.00',
      })
      const xml = generateFa2Xml(doc, DEFAULT_SELLER)
      expect(xml).toContain('<P_13_1>300.00</P_13_1>')
      expect(xml).toContain('<P_14_1>69.00</P_14_1>')
    })

    it('outputs separate P_13 groups for different VAT rates', () => {
      const doc = makeDocument({
        lineItems: [
          makeLineItem({ vatRate: '23', netAmount: 100, vatAmount: 23, grossAmount: 123 }),
          makeLineItem({ vatRate: '8', netAmount: 200, vatAmount: 16, grossAmount: 216 }),
        ],
        grossAmount: '339.00',
      })
      const xml = generateFa2Xml(doc, DEFAULT_SELLER)
      expect(xml).toContain('<P_13_1>100.00</P_13_1>') // 23% group
      expect(xml).toContain('<P_14_1>23.00</P_14_1>')
      expect(xml).toContain('<P_13_2>200.00</P_13_2>') // 8% group
      expect(xml).toContain('<P_14_2>16.00</P_14_2>')
    })
  })

  describe('XML escaping', () => {
    it('escapes & in description', () => {
      const doc = makeDocument({
        lineItems: [makeLineItem({ description: 'Services & Goods' })],
      })
      const xml = generateFa2Xml(doc, DEFAULT_SELLER)
      expect(xml).toContain('<P_7>Services &amp; Goods</P_7>')
    })

    it('escapes < in description', () => {
      const doc = makeDocument({
        lineItems: [makeLineItem({ description: '1<2' })],
      })
      const xml = generateFa2Xml(doc, DEFAULT_SELLER)
      expect(xml).toContain('<P_7>1&lt;2</P_7>')
    })

    it('escapes > in description', () => {
      const doc = makeDocument({
        lineItems: [makeLineItem({ description: '2>1' })],
      })
      const xml = generateFa2Xml(doc, DEFAULT_SELLER)
      expect(xml).toContain('<P_7>2&gt;1</P_7>')
    })

    it('escapes " in seller address', () => {
      const xml = generateFa2Xml(
        makeDocument(),
        { ...DEFAULT_SELLER, sellerAddressL1: 'ul. "Testowa" 1' },
      )
      expect(xml).toContain('<AdresL1>ul. &quot;Testowa&quot; 1</AdresL1>')
    })

    it("escapes ' in seller name", () => {
      const xml = generateFa2Xml(
        makeDocument(),
        { ...DEFAULT_SELLER, sellerName: "Seller's Ltd" },
      )
      expect(xml).toContain("<Nazwa>Seller&apos;s Ltd</Nazwa>")
    })
  })

  describe('Adnotacje block', () => {
    it('includes the static Adnotacje block', () => {
      const xml = generateFa2Xml(makeDocument(), DEFAULT_SELLER)
      expect(xml).toContain('<Adnotacje>')
      expect(xml).toContain('<P_16>2</P_16>')
      expect(xml).toContain('<P_17>2</P_17>')
      expect(xml).toContain('<P_23>2</P_23>')
    })
  })
})
