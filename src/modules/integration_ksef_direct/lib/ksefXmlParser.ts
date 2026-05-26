export interface ParsedReceivedInvoice {
  invoiceNumber: string | null
  sellerNip: string | null
  sellerName: string | null
  issueDate: string | null
  currency: string | null
  netAmount: string | null
  vatAmount: string | null
  grossAmount: string | null
}

function extractSection(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}[\\s\\S]*?>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return match ? match[1]! : null
}

function extractTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, 'i'))
  return match ? match[1]!.trim() || null : null
}

function sumTagPattern(xml: string, tagPattern: RegExp): number {
  let sum = 0
  for (const match of xml.matchAll(new RegExp(`<(${tagPattern.source})>([^<]*)<\\/\\1>`, 'gi'))) {
    sum += parseFloat(match[2] ?? '0') || 0
  }
  return sum
}

function parseFa2Xml(xml: string): ParsedReceivedInvoice {
  const podmiot1 = extractSection(xml, 'Podmiot1')
  const sellerNip = podmiot1 ? extractTag(podmiot1, 'NIP') : null
  const sellerName = podmiot1
    ? (extractTag(podmiot1, 'PelnaNazwa') ?? extractTag(podmiot1, 'Nazwa'))
    : null

  const fa = extractSection(xml, 'Fa')
  const issueDate = fa ? extractTag(fa, 'P_1') : null
  const invoiceNumber = fa ? (extractTag(fa, 'P_2A') ?? extractTag(fa, 'P_2')) : null
  const currency = fa ? extractTag(fa, 'KodWaluty') : null
  const grossAmountRaw = fa ? extractTag(fa, 'P_15') : null

  const netAmountNum = fa ? sumTagPattern(fa, /P_13_\d+/) : 0
  const vatAmountNum = fa ? sumTagPattern(fa, /P_14_\d+/) : 0

  return {
    invoiceNumber,
    sellerNip,
    sellerName,
    issueDate,
    currency,
    netAmount: netAmountNum > 0 ? netAmountNum.toFixed(2) : null,
    vatAmount: vatAmountNum > 0 ? vatAmountNum.toFixed(2) : null,
    grossAmount: grossAmountRaw,
  }
}

function parseUpoXml(xml: string): ParsedReceivedInvoice {
  // UPO (Potwierdzenie) format from KSeF — xmlns="http://upo.schematy.mf.gov.pl/KSeF/..."
  // Contains metadata about an accepted invoice but not full financial data.
  const dokument = extractSection(xml, 'Dokument')
  const sellerNip = dokument ? extractTag(dokument, 'NipSprzedawcy') : null
  const invoiceNumber = dokument ? extractTag(dokument, 'NumerFaktury') : null
  const issueDate = dokument ? extractTag(dokument, 'DataWystawieniaFaktury') : null

  return {
    invoiceNumber,
    sellerNip,
    sellerName: null,
    issueDate,
    currency: null,
    netAmount: null,
    vatAmount: null,
    grossAmount: null,
  }
}

export function parseReceivedInvoiceXml(xml: string): ParsedReceivedInvoice {
  try {
    // Detect UPO format by namespace
    if (xml.includes('upo.schematy.mf.gov.pl') || xml.includes('<Potwierdzenie')) {
      return parseUpoXml(xml)
    }
    return parseFa2Xml(xml)
  } catch {
    return {
      invoiceNumber: null,
      sellerNip: null,
      sellerName: null,
      issueDate: null,
      currency: null,
      netAmount: null,
      vatAmount: null,
      grossAmount: null,
    }
  }
}
