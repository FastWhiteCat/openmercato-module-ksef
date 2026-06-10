import type { CreateKsefDirectDocumentInput, KsefDirectLineItemInput } from '../data/validators'
import { KsefDirectDocument, type KsefDirectStoredLineItem } from '../data/entities'
import { emitKsefDirectEvent } from '../events'

export class KsefDirectNotConfiguredError extends Error {
  constructor() {
    super('KSEF_DIRECT_NOT_CONFIGURED')
    this.name = 'KsefDirectNotConfiguredError'
  }
}

const VAT_RATE_MAP: Record<string, number> = { '0': 0, '5': 5, '8': 8, '23': 23, ZW: 0, NP: 0 }

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function computeLineItem(item: KsefDirectLineItemInput): KsefDirectStoredLineItem {
  const netAmount = round2(item.quantity * item.unitNetPrice)
  const rate = VAT_RATE_MAP[item.vatRate] ?? 0
  const vatAmount = round2(netAmount * rate / 100)
  return {
    description: item.description,
    quantity: item.quantity,
    unit: item.unit,
    unitNetPrice: item.unitNetPrice,
    vatRate: item.vatRate,
    netAmount,
    vatAmount,
    grossAmount: round2(netAmount + vatAmount),
  }
}

export async function createKsefDirectDocument(
  em: any,
  tenantId: string,
  organizationId: string,
  input: CreateKsefDirectDocumentInput,
  credentialsService: any,
): Promise<{ id: string; status: string; invoiceNumber: string; sellerNip: string }> {
  const credentials = await credentialsService?.resolve('integration_ksef_direct', { tenantId, organizationId })
  if (!credentials?.nip) {
    throw new KsefDirectNotConfiguredError()
  }

  let sellerName = input.sellerName ?? null
  if (!sellerName) {
    const { Organization } = await import('@open-mercato/core/modules/directory/data/entities')
    const org = await em.findOne(Organization, { id: organizationId })
    sellerName = org?.name ?? null
  }

  const storedLineItems = input.lineItems.map(computeLineItem)
  const netAmount = round2(storedLineItems.reduce((sum, l) => sum + l.netAmount, 0))
  const vatAmount = round2(storedLineItems.reduce((sum, l) => sum + l.vatAmount, 0))
  const grossAmount = round2(netAmount + vatAmount)
  const now = new Date()

  const doc = em.create(KsefDirectDocument, {
    organizationId,
    tenantId,
    source: 'manual' as const,
    status: 'draft' as const,
    sellerNip: credentials.nip,
    sellerName,
    sellerAddressL1: input.sellerAddressL1 ?? null,
    sellerCity: input.sellerCity ?? null,
    sellerCountry: input.sellerCountry ?? null,
    buyerNip: input.buyerNip,
    buyerName: input.buyerName ?? null,
    invoiceNumber: input.invoiceNumber,
    issueDate: new Date(input.issueDate),
    saleDate: input.saleDate ? new Date(input.saleDate) : null,
    netAmount: String(netAmount),
    vatAmount: String(vatAmount),
    grossAmount: String(grossAmount),
    currency: input.currency ?? 'PLN',
    lineItems: storedLineItems,
    notes: input.notes ?? null,
    createdAt: now,
    updatedAt: now,
  })

  await em.persist(doc).flush()

  await emitKsefDirectEvent('ksef_direct.document.created', {
    documentId: doc.id,
    organizationId,
    tenantId,
  })

  return { id: doc.id, status: doc.status, invoiceNumber: doc.invoiceNumber, sellerNip: doc.sellerNip }
}
