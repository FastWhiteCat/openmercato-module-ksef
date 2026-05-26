import type { QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createModuleQueue } from '@open-mercato/queue'

export const metadata: WorkerMeta = {
  queue: 'ksef_direct_check',
  id: 'ksef-direct-check',
  concurrency: 5,
}

type HandlerContext = { resolve: <T = unknown>(name: string) => T }

type CheckJobPayload = {
  documentId: string
  organizationId: string
  tenantId: string
  attempt: number
}

export default async function handler(
  job: QueuedJob<CheckJobPayload>,
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

  if (!doc || doc.status !== 'sending') {
    return
  }

  if (!doc.ksefProcessingReferenceNumber) {
    doc.status = 'failed'
    doc.errorMessage = 'Missing KSeF processing reference number'
    doc.updatedAt = new Date()
    await em.flush()
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
    return
  }

  const credentials = {
    ksefToken: credsParsed.data.ksef_token,
    nip: credsParsed.data.nip,
    environment: credsParsed.data.environment,
    tenantId: payload.tenantId,
  }

  const { checkInvoiceStatus } = await import('../lib/ksefClient')
  const { emitKsefDirectEvent } = await import('../events')

  let result: { processingCode: number; ksefReferenceNumber?: string; errorDescription?: string }
  try {
    result = await checkInvoiceStatus(credentials, doc.ksefProcessingReferenceNumber)
  } catch (err) {
    // Re-throw transient errors so BullMQ retries; do not permanently fail the document
    throw err
  }

  if (result.processingCode === 200) {
    doc.status = 'sent'
    doc.updatedAt = new Date()
    await em.flush()

    await emitKsefDirectEvent('ksef_direct.document.sent', {
      documentId: doc.id,
      ksefReferenceNumber: doc.ksefReferenceNumber ?? undefined,
      organizationId: payload.organizationId,
      tenantId: payload.tenantId,
    })
  } else if (result.processingCode === 100) {
    if (payload.attempt >= 10) {
      doc.status = 'failed'
      doc.errorMessage = 'Timeout: KSeF did not confirm the document within 10 minutes'
      doc.updatedAt = new Date()
      await em.flush()

      await emitKsefDirectEvent('ksef_direct.document.failed', {
        documentId: doc.id,
        errorMessage: doc.errorMessage,
        organizationId: payload.organizationId,
        tenantId: payload.tenantId,
      })
    } else {
      const checkQueue = createModuleQueue<CheckJobPayload>('ksef_direct_check')
      await checkQueue.enqueue(
        { ...payload, attempt: payload.attempt + 1 },
        { delayMs: 60_000 },
      )
    }
  } else {
    const errorMessage = result.errorDescription
      ?? `KSeF processing error: code ${result.processingCode}`
    doc.status = 'failed'
    doc.errorMessage = errorMessage
    doc.ksefReferenceNumber = null
    doc.updatedAt = new Date()
    await em.flush()

    await emitKsefDirectEvent('ksef_direct.document.failed', {
      documentId: doc.id,
      errorMessage,
      organizationId: payload.organizationId,
      tenantId: payload.tenantId,
    })
  }
}
