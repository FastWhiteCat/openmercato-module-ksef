import type { KsefDirectDocument } from '../data/entities'

export class KsefXmlGenerationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KsefXmlGenerationError'
  }
}

export type SellerInfo = {
  sellerName: string
  sellerAddressL1?: string
  sellerCity?: string
  sellerCountry?: string
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]!
}

// vatRate → { suffix for P_13/P_14, p12Code for FaWiersz.P_12, whether VAT amount applies }
const VAT_RATE_GROUPS: Record<string, { suffix: string; p12Code: string; hasVat: boolean }> = {
  '23': { suffix: '1', p12Code: '23', hasVat: true },
  '8':  { suffix: '2', p12Code: '8',  hasVat: true },
  '5':  { suffix: '3', p12Code: '5',  hasVat: true },
  '0':  { suffix: '4', p12Code: '0',  hasVat: false },
  'ZW': { suffix: '5', p12Code: 'zw', hasVat: false },
  'NP': { suffix: '6', p12Code: 'np', hasVat: false },
}

export function generateFa2Xml(document: KsefDirectDocument, seller: SellerInfo): string {
  if (!seller.sellerName.trim()) {
    throw new KsefXmlGenerationError('sellerName is required for FA_VAT 2.0 XML generation')
  }
  if (!seller.sellerAddressL1?.trim()) {
    throw new KsefXmlGenerationError('sellerAddressL1 is required for FA_VAT 2.0 XML generation')
  }

  const now = new Date()
  const issueDate = formatDate(document.issueDate)
  const saleDate = document.saleDate ? formatDate(document.saleDate) : issueDate

  const lineItemsXml = document.lineItems.map((item, index) => {
    const group = VAT_RATE_GROUPS[item.vatRate]
    const p12 = group?.p12Code ?? item.vatRate
    return `
  <FaWiersz>
    <NrWierszaFa>${index + 1}</NrWierszaFa>
    <P_7>${escapeXml(item.description)}</P_7>
    <P_8A>${escapeXml(item.unit)}</P_8A>
    <P_8B>${item.quantity}</P_8B>
    <P_9A>${item.unitNetPrice.toFixed(2)}</P_9A>
    <P_11>${item.netAmount.toFixed(2)}</P_11>
    <P_12>${escapeXml(p12)}</P_12>
  </FaWiersz>`
  }).join('')

  // Group by VAT rate, accumulate net + vat amounts
  const groups = new Map<string, { net: number; vat: number; hasVat: boolean }>()
  for (const item of document.lineItems) {
    const group = VAT_RATE_GROUPS[item.vatRate]
    if (!group) continue
    const existing = groups.get(group.suffix) ?? { net: 0, vat: 0, hasVat: group.hasVat }
    groups.set(group.suffix, {
      net: existing.net + item.netAmount,
      vat: existing.vat + item.vatAmount,
      hasVat: group.hasVat,
    })
  }

  // Sort suffix numerically for deterministic output
  const sortedSuffixes = [...groups.keys()].sort()
  const vatSummaryXml = sortedSuffixes.map((suffix) => {
    const g = groups.get(suffix)!
    const net = `\n    <P_13_${suffix}>${g.net.toFixed(2)}</P_13_${suffix}>`
    const vat = g.hasVat ? `\n    <P_14_${suffix}>${g.vat.toFixed(2)}</P_14_${suffix}>` : ''
    return net + vat
  }).join('')

  // TAdres: KodKraju → AdresL1 → [AdresL2] — city goes in AdresL2, no Miejscowosc element
  const adresL2 = seller.sellerCity?.trim()
    ? `\n      <AdresL2>${escapeXml(seller.sellerCity)}</AdresL2>`
    : ''
  const adresXml = `
    <Adres>
      <KodKraju>${escapeXml(seller.sellerCountry ?? 'PL')}</KodKraju>
      <AdresL1>${escapeXml(seller.sellerAddressL1)}</AdresL1>${adresL2}
    </Adres>`

  const grossAmount = parseFloat(String(document.grossAmount)).toFixed(2)

  // FA(2) v1-0E Fa sequence: KodWaluty → P_1 → P_2A → P_6 → VAT summaries → P_15 → Adnotacje → RodzajFaktury → FaWiersz
  return `<?xml version="1.0" encoding="UTF-8"?>
<Faktura xmlns="http://crd.gov.pl/wzor/2023/06/29/12648/">
  <Naglowek>
    <KodFormularza kodSystemowy="FA (2)" wersjaSchemy="1-0E">FA</KodFormularza>
    <WariantFormularza>2</WariantFormularza>
    <DataWytworzeniaFa>${now.toISOString()}</DataWytworzeniaFa>
    <SystemInfo>OpenMercato</SystemInfo>
  </Naglowek>
  <Podmiot1>
    <DaneIdentyfikacyjne>
      <NIP>${escapeXml(document.sellerNip)}</NIP>
      <Nazwa>${escapeXml(seller.sellerName)}</Nazwa>
    </DaneIdentyfikacyjne>${adresXml}
  </Podmiot1>
  <Podmiot2>
    <DaneIdentyfikacyjne>
      <NIP>${escapeXml(document.buyerNip)}</NIP>
      <Nazwa>${escapeXml(document.buyerName ?? '')}</Nazwa>
    </DaneIdentyfikacyjne>
  </Podmiot2>
  <Fa>
    <KodWaluty>${escapeXml(document.currency)}</KodWaluty>
    <P_1>${issueDate}</P_1>
    <P_2>${escapeXml(document.invoiceNumber)}</P_2>
    <P_6>${saleDate}</P_6>${vatSummaryXml}
    <P_15>${grossAmount}</P_15>
    <Adnotacje>
      <P_16>2</P_16>
      <P_17>2</P_17>
      <P_18>2</P_18>
      <P_18A>2</P_18A>
      <Zwolnienie>
        <P_19N>1</P_19N>
      </Zwolnienie>
      <NoweSrodkiTransportu>
        <P_22N>1</P_22N>
      </NoweSrodkiTransportu>
      <P_23>2</P_23>
      <PMarzy>
        <P_PMarzyN>1</P_PMarzyN>
      </PMarzy>
    </Adnotacje>
    <RodzajFaktury>VAT</RodzajFaktury>${lineItemsXml}
  </Fa>
</Faktura>`
}
