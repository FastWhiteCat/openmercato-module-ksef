import type { QueuedJob, WorkerMeta } from '@open-mercato/queue'

export const metadata: WorkerMeta = {
  queue: 'ksef_direct_receive',
  id: 'ksef-direct-receive',
  concurrency: 3,
}

type HandlerContext = { resolve: <T = unknown>(name: string) => T }

export type SyncReceivedDocumentsPayload = {
  organizationId: string
  tenantId: string
  dateFrom: string
  dateTo: string
}

export default async function handler(
  job: QueuedJob<SyncReceivedDocumentsPayload>,
  ctx: HandlerContext,
): Promise<void> {
  const payload = job.payload
  console.log('[ksef-receive] handler start', { jobId: job.id, dateFrom: payload.dateFrom, dateTo: payload.dateTo })

  console.log('[ksef-receive] resolving em...')
  const em = (ctx.resolve('em') as { fork: () => unknown })?.fork() as any
  if (!em) { console.log('[ksef-receive] em is null, returning'); return }
  console.log('[ksef-receive] em forked OK')

  console.log('[ksef-receive] resolving credentialsService...')
  const credentialsService = ctx.resolve('integrationCredentialsService') as any
  console.log('[ksef-receive] credentialsService resolved, fetching creds...')
  const rawCreds = credentialsService
    ? await credentialsService.resolve('integration_ksef_direct', {
        tenantId: payload.tenantId,
        organizationId: payload.organizationId,
      })
    : null
  console.log('[ksef-receive] creds fetched, rawCreds is', rawCreds ? 'non-null' : 'null')

  const { KsefDirectCredentialsSchema } = await import('../data/validators')
  const credsParsed = KsefDirectCredentialsSchema.safeParse(rawCreds)
  if (!credsParsed.success) { console.log('[ksef-receive] creds parse failed:', credsParsed.error.message); return }
  console.log('[ksef-receive] creds parsed OK, environment:', credsParsed.data.environment)

  const credentials = {
    ksefToken: credsParsed.data.ksef_token,
    nip: credsParsed.data.nip,
    environment: credsParsed.data.environment,
    tenantId: payload.tenantId,
  }

  const { queryReceivedInvoices, downloadInvoiceFromUrl } = await import('../lib/ksefClient')
  const { KsefDirectReceivedDocument } = await import('../data/entities')
  const { parseReceivedInvoiceXml } = await import('../lib/ksefXmlParser')
  const { emitKsefDirectEvent } = await import('../events')

  console.log('[ksef-receive] calling queryReceivedInvoices...')
  // Phase 1: enumerate all received invoices for the date range and upsert summaries
  let result: { items: Awaited<ReturnType<typeof queryReceivedInvoices>>['items']; totalCount: number }
  try {
    result = await queryReceivedInvoices(credentials, {
      dateFrom: payload.dateFrom,
      dateTo: payload.dateTo,
    })
  } catch (err) {
    console.error('[ksef-receive] queryReceivedInvoices FAILED:', err instanceof Error ? err.message : String(err))
    throw err
  }
  console.log('[ksef-receive] queryReceivedInvoices returned', result.items.length, 'items')

  const collectedRefs: string[] = []

  for (const summary of result.items) {
    collectedRefs.push(summary.ksefReferenceNumber)

    const existing = await em.findOne(KsefDirectReceivedDocument, {
      organizationId: payload.organizationId,
      ksefReferenceNumber: summary.ksefReferenceNumber,
    })

    if (!existing) {
      const record = em.create(KsefDirectReceivedDocument, {
        organizationId: payload.organizationId,
        tenantId: payload.tenantId,
        ksefReferenceNumber: summary.ksefReferenceNumber,
        sellerNip: summary.sellerNip,
        sellerName: summary.sellerName,
        issueDate: summary.issueDate,
        grossAmount: summary.grossAmount,
        netAmount: summary.netAmount,
        vatAmount: summary.vatAmount,
        currency: summary.currency,
        invoiceNumber: summary.invoiceNumber,
        upoDownloadUrl: summary.upoDownloadUrl,
        invoiceDownloadUrl: summary.invoiceDownloadUrl,
        status: 'pending_download',
      })
      em.persist(record)
    } else {
      // Keep URL fields fresh in case they changed (pre-signed URLs rotate)
      if (summary.upoDownloadUrl) existing.upoDownloadUrl = summary.upoDownloadUrl
      if (summary.invoiceDownloadUrl) existing.invoiceDownloadUrl = summary.invoiceDownloadUrl
      if (existing.status === 'failed') {
        existing.status = 'pending_download'
        existing.errorMessage = null
        existing.updatedAt = new Date()
      }
    }
  }

  await em.flush()

  console.log('[ksef-receive] collectedRefs:', collectedRefs.length)
  if (collectedRefs.length === 0) {
    console.log('[ksef-receive] no refs, emitting synced event...')
    await emitKsefDirectEvent('ksef_direct.received_document.synced', {
      organizationId: payload.organizationId,
      tenantId: payload.tenantId,
      syncedCount: 0,
      failedCount: 0,
      dateFrom: payload.dateFrom,
      dateTo: payload.dateTo,
    })
    return
  }

  // Phase 2: download XML content for all pending records using stored URLs
  const pendingRecords = await em.find(KsefDirectReceivedDocument, {
    organizationId: payload.organizationId,
    tenantId: payload.tenantId,
    status: 'pending_download',
    ksefReferenceNumber: { $in: collectedRefs },
  })

  let syncedCount = 0
  let failedCount = 0

  for (const record of pendingRecords) {
    try {
      const downloadUrl = record.invoiceDownloadUrl ?? record.upoDownloadUrl
      if (!downloadUrl) {
        throw new Error('No download URL available for this invoice')
      }

      const rawXml = await downloadInvoiceFromUrl(downloadUrl)
      const parsed = parseReceivedInvoiceXml(rawXml)

      record.rawXml = rawXml
      // Only override metadata fields with parsed values when non-null (prefer KSeF API metadata)
      if (parsed.invoiceNumber) record.invoiceNumber = parsed.invoiceNumber
      if (parsed.sellerNip) record.sellerNip = parsed.sellerNip
      if (parsed.sellerName) record.sellerName = parsed.sellerName
      if (parsed.issueDate) record.issueDate = parsed.issueDate
      if (parsed.currency) record.currency = parsed.currency
      if (parsed.netAmount) record.netAmount = parsed.netAmount
      if (parsed.vatAmount) record.vatAmount = parsed.vatAmount
      if (parsed.grossAmount) record.grossAmount = parsed.grossAmount
      record.status = 'downloaded'
      record.syncedAt = new Date()
      record.updatedAt = new Date()
      await em.flush()
      syncedCount++
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error during XML download'
      record.status = 'failed'
      record.errorMessage = errorMessage
      record.updatedAt = new Date()
      await em.flush()
      failedCount++

      await emitKsefDirectEvent('ksef_direct.received_document.failed', {
        organizationId: payload.organizationId,
        tenantId: payload.tenantId,
        ksefReferenceNumber: record.ksefReferenceNumber,
        errorMessage,
      })
    }
  }

  await emitKsefDirectEvent('ksef_direct.received_document.synced', {
    organizationId: payload.organizationId,
    tenantId: payload.tenantId,
    syncedCount,
    failedCount,
    dateFrom: payload.dateFrom,
    dateTo: payload.dateTo,
  })
}
