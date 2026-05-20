import { enqueueKsefDirectDocument } from '../commands/enqueue-ksef-direct-document'

export const metadata = {
  event: 'ksef_direct.document.created',
  persistent: true,
  id: 'ksef_direct.auto_enqueue_document',
}

export default async function handler(
  payload: { documentId: string; organizationId: string; tenantId: string },
  ctx: { resolve: <T = unknown>(name: string) => T },
) {
  const em = ctx.resolve<{ fork: () => unknown }>('em')?.fork() as any
  if (!em) return

  try {
    await enqueueKsefDirectDocument(em, payload.tenantId, payload.organizationId, payload.documentId)
  } catch {
    // If document is already queued or in a non-draft state, ignore — idempotent
  }
}
