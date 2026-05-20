import { createModuleQueue } from '@open-mercato/queue'
import { KsefDirectDocument } from '../data/entities'
import { emitKsefDirectEvent } from '../events'

export class KsefDocumentNotFoundError extends Error {
  readonly status = 404
  constructor() {
    super('Document not found')
    this.name = 'KsefDocumentNotFoundError'
  }
}

export class KsefDocumentNotQueueableError extends Error {
  readonly status = 409
  constructor(currentStatus: string) {
    super(`Document cannot be queued: current status is '${currentStatus}'`)
    this.name = 'KsefDocumentNotQueueableError'
  }
}

export type SendKsefDocumentJobPayload = {
  documentId: string
  organizationId: string
  tenantId: string
}

export async function enqueueKsefDirectDocument(
  em: any,
  tenantId: string,
  organizationId: string,
  documentId: string,
): Promise<{ id: string; status: string; invoiceNumber: string }> {
  const doc = await em.findOne(KsefDirectDocument, { id: documentId, organizationId, tenantId })

  if (!doc) {
    throw new KsefDocumentNotFoundError()
  }

  if (!['draft', 'failed'].includes(doc.status)) {
    throw new KsefDocumentNotQueueableError(doc.status)
  }

  doc.status = 'queued'
  doc.updatedAt = new Date()
  await em.flush()

  await emitKsefDirectEvent('ksef_direct.document.queued', {
    documentId: doc.id,
    organizationId,
    tenantId,
  })

  const queue = createModuleQueue<SendKsefDocumentJobPayload>('ksef_direct_send')
  await queue.enqueue({ documentId: doc.id, organizationId, tenantId })

  return { id: doc.id, status: doc.status, invoiceNumber: doc.invoiceNumber }
}
