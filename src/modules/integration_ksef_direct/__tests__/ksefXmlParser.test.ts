import { parseReceivedInvoiceXml, type ParsedReceivedInvoice } from '../lib/ksefXmlParser'

// Minimal FA(2) invoice XML based on the structure produced by ksefFa2Xml.ts
const FA2_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Faktura xmlns="http://crd.gov.pl/wzor/2023/06/29/12648/">
  <Podmiot1>
    <DaneIdentyfikacyjne>
      <NIP>1234567890</NIP>
      <Nazwa>Seller Sp. z o.o.</Nazwa>
    </DaneIdentyfikacyjne>
  </Podmiot1>
  <Podmiot2>
    <DaneIdentyfikacyjne>
      <NIP>0987654321</NIP>
      <Nazwa>Buyer S.A.</Nazwa>
    </DaneIdentyfikacyjne>
  </Podmiot2>
  <Fa>
    <KodWaluty>PLN</KodWaluty>
    <P_1>2025-01-15</P_1>
    <P_2>FV/2025/01/ABCD1234</P_2>
    <P_6>2025-01-15</P_6>
    <P_13_1>1000.00</P_13_1>
    <P_14_1>230.00</P_14_1>
    <P_13_2>500.00</P_13_2>
    <P_14_2>40.00</P_14_2>
    <P_15>1770.00</P_15>
  </Fa>
</Faktura>`

// FA(2) XML using P_2A instead of P_2 for invoice number
const FA2_XML_WITH_P2A = `<?xml version="1.0" encoding="UTF-8"?>
<Faktura xmlns="http://crd.gov.pl/wzor/2023/06/29/12648/">
  <Podmiot1>
    <DaneIdentyfikacyjne>
      <NIP>1111111111</NIP>
      <PelnaNazwa>Full Name GmbH</PelnaNazwa>
    </DaneIdentyfikacyjne>
  </Podmiot1>
  <Fa>
    <KodWaluty>EUR</KodWaluty>
    <P_1>2024-06-30</P_1>
    <P_2A>FV/2024/06/XXXXXXXX</P_2A>
    <P_6>2024-06-30</P_6>
    <P_13_1>200.00</P_13_1>
    <P_14_1>46.00</P_14_1>
    <P_15>246.00</P_15>
  </Fa>
</Faktura>`

// FA(2) with only exempt (no VAT) rates — no P_14 elements
const FA2_XML_EXEMPT_ONLY = `<?xml version="1.0" encoding="UTF-8"?>
<Faktura xmlns="http://crd.gov.pl/wzor/2023/06/29/12648/">
  <Podmiot1>
    <DaneIdentyfikacyjne>
      <NIP>5555555555</NIP>
      <Nazwa>Exempt Seller</Nazwa>
    </DaneIdentyfikacyjne>
  </Podmiot1>
  <Fa>
    <KodWaluty>PLN</KodWaluty>
    <P_1>2025-03-01</P_1>
    <P_2>FV/2025/03/ZERORAT1</P_2>
    <P_6>2025-03-01</P_6>
    <P_13_5>800.00</P_13_5>
    <P_15>800.00</P_15>
  </Fa>
</Faktura>`

// UPO (Potwierdzenie) format from KSeF
const UPO_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Potwierdzenie xmlns="http://upo.schematy.mf.gov.pl/KSeF/2023">
  <Dokument>
    <NipSprzedawcy>9999999999</NipSprzedawcy>
    <NumerFaktury>FV/2025/05/UPOTEST1</NumerFaktury>
    <DataWystawieniaFaktury>2025-05-10</DataWystawieniaFaktury>
  </Dokument>
</Potwierdzenie>`

// Entirely malformed / empty XML
const EMPTY_XML = ''
const GARBAGE_XML = '<not-an-invoice>garbage</not-an-invoice>'

describe('parseReceivedInvoiceXml', () => {
  describe('FA(2) format — standard invoice', () => {
    let result: ParsedReceivedInvoice

    beforeEach(() => {
      result = parseReceivedInvoiceXml(FA2_XML)
    })

    it('extracts the seller NIP from Podmiot1', () => {
      expect(result.sellerNip).toBe('1234567890')
    })

    it('extracts the seller name (Nazwa) from Podmiot1', () => {
      expect(result.sellerName).toBe('Seller Sp. z o.o.')
    })

    it('extracts the issue date (P_1)', () => {
      expect(result.issueDate).toBe('2025-01-15')
    })

    it('extracts the invoice number from P_2 when P_2A is absent', () => {
      expect(result.invoiceNumber).toBe('FV/2025/01/ABCD1234')
    })

    it('extracts the currency (KodWaluty)', () => {
      expect(result.currency).toBe('PLN')
    })

    it('sums all P_13_* elements as net amount', () => {
      // 1000.00 + 500.00 = 1500.00
      expect(result.netAmount).toBe('1500.00')
    })

    it('sums all P_14_* elements as VAT amount', () => {
      // 230.00 + 40.00 = 270.00
      expect(result.vatAmount).toBe('270.00')
    })

    it('extracts the gross amount from P_15', () => {
      expect(result.grossAmount).toBe('1770.00')
    })
  })

  describe('FA(2) format — P_2A takes precedence over P_2 for invoice number', () => {
    it('uses P_2A as invoice number when present', () => {
      const result = parseReceivedInvoiceXml(FA2_XML_WITH_P2A)
      expect(result.invoiceNumber).toBe('FV/2024/06/XXXXXXXX')
    })

    it('extracts PelnaNazwa as seller name when Nazwa is absent', () => {
      const result = parseReceivedInvoiceXml(FA2_XML_WITH_P2A)
      expect(result.sellerName).toBe('Full Name GmbH')
    })

    it('reads EUR currency', () => {
      const result = parseReceivedInvoiceXml(FA2_XML_WITH_P2A)
      expect(result.currency).toBe('EUR')
    })
  })

  describe('FA(2) format — exempt-only rates (no P_14 elements)', () => {
    let result: ParsedReceivedInvoice

    beforeEach(() => {
      result = parseReceivedInvoiceXml(FA2_XML_EXEMPT_ONLY)
    })

    it('returns null for vatAmount when there are no P_14_* elements', () => {
      expect(result.vatAmount).toBeNull()
    })

    it('returns the correct net amount from P_13_5', () => {
      expect(result.netAmount).toBe('800.00')
    })

    it('returns the correct gross amount', () => {
      expect(result.grossAmount).toBe('800.00')
    })
  })

  describe('UPO (Potwierdzenie) format', () => {
    let result: ParsedReceivedInvoice

    beforeEach(() => {
      result = parseReceivedInvoiceXml(UPO_XML)
    })

    it('detects UPO format and extracts NipSprzedawcy', () => {
      expect(result.sellerNip).toBe('9999999999')
    })

    it('extracts NumerFaktury as invoiceNumber', () => {
      expect(result.invoiceNumber).toBe('FV/2025/05/UPOTEST1')
    })

    it('extracts DataWystawieniaFaktury as issueDate', () => {
      expect(result.issueDate).toBe('2025-05-10')
    })

    it('returns null for financial fields not present in UPO', () => {
      expect(result.sellerName).toBeNull()
      expect(result.currency).toBeNull()
      expect(result.netAmount).toBeNull()
      expect(result.vatAmount).toBeNull()
      expect(result.grossAmount).toBeNull()
    })
  })

  describe('empty or malformed input', () => {
    it('returns all-null result for empty string', () => {
      const result = parseReceivedInvoiceXml(EMPTY_XML)
      expect(result.invoiceNumber).toBeNull()
      expect(result.sellerNip).toBeNull()
      expect(result.sellerName).toBeNull()
      expect(result.issueDate).toBeNull()
      expect(result.currency).toBeNull()
      expect(result.netAmount).toBeNull()
      expect(result.vatAmount).toBeNull()
      expect(result.grossAmount).toBeNull()
    })

    it('returns all-null result for garbage XML that has no recognized structure', () => {
      const result = parseReceivedInvoiceXml(GARBAGE_XML)
      expect(result.invoiceNumber).toBeNull()
      expect(result.sellerNip).toBeNull()
    })
  })

  describe('return shape', () => {
    it('always returns an object with the expected keys', () => {
      const result = parseReceivedInvoiceXml(FA2_XML)
      const expectedKeys: (keyof ParsedReceivedInvoice)[] = [
        'invoiceNumber',
        'sellerNip',
        'sellerName',
        'issueDate',
        'currency',
        'netAmount',
        'vatAmount',
        'grossAmount',
      ]
      for (const key of expectedKeys) {
        expect(result).toHaveProperty(key)
      }
    })
  })
})
