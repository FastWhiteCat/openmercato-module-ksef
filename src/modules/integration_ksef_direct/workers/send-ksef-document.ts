import type { QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createModuleQueue } from '@open-mercato/queue'

export const metadata: WorkerMeta = {
  queue: 'ksef_direct_send',
  id: 'ksef-direct-send',
  concurrency: 5,
}

type HandlerContext = { resolve: <T = unknown>(name: string) => T }

type SendJobPayload = {
  documentId: string
  organizationId: string
  tenantId: string
}

type CheckJobPayload = {
  documentId: string
  organizationId: string
  tenantId: string
  attempt: number
}

export default async function handler(
  job: QueuedJob<SendJobPayload>,
  ctx: HandlerContext,
): Promise<void> {
  const payload = job.payload
  const em = (ctx.resolve('em') as { fork: () => unknown })?.fork() as any
  if (!em) return

  const { KsefDirectDocument } = await import('../data/entities')
  const doc = await em.findOne(KsefDirectDocument, {
    id: payload.documentId,
    organizationId: payload.organizationId,
    tenantId: payload.tenantId,
  })

  if (!doc || doc.status !== 'queued') {
    return
  }

  if (!doc.sellerName?.trim()) {
    doc.status = 'failed'
    doc.errorMessage = 'Seller name is required to send the document to KSeF'
    doc.updatedAt = new Date()
    await em.flush()

    const { emitKsefDirectEvent } = await import('../events')
    await emitKsefDirectEvent('ksef_direct.document.failed', {
      documentId: doc.id,
      errorMessage: doc.errorMessage,
      organizationId: payload.organizationId,
      tenantId: payload.tenantId,
    })
    return
  }

  const credentialsService = ctx.resolve('integrationCredentialsService') as any
  const rawCreds = credentialsService
    ? await credentialsService.resolve('integration_ksef_direct', {
        tenantId: payload.tenantId,
        organizationId: payload.organizationId,
      })
    : null

  const { KsefDirectCredentialsSchema } = await import('../data/validators')
  const credsParsed = KsefDirectCredentialsSchema.safeParse(rawCreds)

  if (!credsParsed.success) {
    doc.status = 'failed'
    doc.errorMessage = 'KSeF Direct credentials not configured'
    doc.updatedAt = new Date()
    await em.flush()

    const { emitKsefDirectEvent } = await import('../events')
    await emitKsefDirectEvent('ksef_direct.document.failed', {
      documentId: doc.id,
      errorMessage: doc.errorMessage,
      organizationId: payload.organizationId,
      tenantId: payload.tenantId,
    })
    return
  }

  const creds = credsParsed.data
  const credentials = {
    ksefToken: creds.ksef_token,
    nip: creds.nip,
    environment: creds.environment,
    tenantId: payload.tenantId,
  }

  try {
    const { fetchInvoicePublicKey, prepareInvoicePayload } = await import('../lib/ksefCrypto')
    const { generateFa2Xml } = await import('../lib/ksefFa2Xml')
    const { sendInvoice } = await import('../lib/ksefClient')

    const xml = generateFa2Xml(doc, {
      sellerName: doc.sellerName,
      sellerAddressL1: doc.sellerAddressL1 ?? undefined,
      sellerCity: doc.sellerCity ?? undefined,
      sellerCountry: doc.sellerCountry ?? undefined,
    })

    const { publicKeyPem, publicKeyId } = await fetchInvoicePublicKey(credentials.environment)
    const invoicePayload = prepareInvoicePayload(xml, publicKeyPem)
    const { sessionReferenceNumber, invoiceReferenceNumber } = await sendInvoice(credentials, { ...invoicePayload, publicKeyId })

    doc.status = 'sending'
    doc.ksefProcessingReferenceNumber = sessionReferenceNumber
    doc.ksefReferenceNumber = invoiceReferenceNumber
    doc.updatedAt = new Date()
    await em.flush()

    const checkQueue = createModuleQueue<CheckJobPayload>('ksef_direct_check')
    await checkQueue.enqueue(
      { documentId: doc.id, organizationId: payload.organizationId, tenantId: payload.tenantId, attempt: 1 },
      { delayMs: 30_000 },
    )
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error during KSeF document send'
    doc.status = 'failed'
    doc.errorMessage = errorMessage
    doc.updatedAt = new Date()
    await em.flush()

    const { emitKsefDirectEvent } = await import('../events')
    await emitKsefDirectEvent('ksef_direct.document.failed', {
      documentId: doc.id,
      errorMessage,
      organizationId: payload.organizationId,
      tenantId: payload.tenantId,
    })
  }
}
