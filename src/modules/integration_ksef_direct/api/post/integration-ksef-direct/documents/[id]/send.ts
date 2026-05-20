import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import {
  enqueueKsefDirectDocument,
  KsefDocumentNotFoundError,
  KsefDocumentNotQueueableError,
} from '../../../../../commands/enqueue-ksef-direct-document'

export const metadata = {
  path: '/integration-ksef-direct/documents/[id]/send',
  POST: { requireAuth: true, requireFeatures: ['integration_ksef_direct.documents.send'] },
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as any

  try {
    const result = await enqueueKsefDirectDocument(em, auth.tenantId, auth.orgId, params.id)
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    if (err instanceof KsefDocumentNotFoundError) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }
    if (err instanceof KsefDocumentNotQueueableError) {
      return NextResponse.json({ error: err.message }, { status: 409 })
    }
    throw err
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'KSeF Direct',
  summary: 'Send KSeF Direct document',
  methods: {
    POST: {
      summary: 'Queue a KSeF Direct document for sending',
      description: 'Transitions a document from draft or failed status to queued and enqueues it for KSeF submission.',
      responses: [
        {
          status: 200,
          description: 'Document queued',
          schema: z.object({
            id: z.string().uuid(),
            status: z.literal('queued'),
            invoiceNumber: z.string(),
          }),
        },
      ],
      errors: [
        { status: 404, description: 'Document not found', schema: z.object({ error: z.string() }) },
        { status: 409, description: 'Document cannot be queued in current status', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
