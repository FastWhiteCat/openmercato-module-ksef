import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { createModuleQueue } from '@open-mercato/queue'
import { ReceivedDocumentSyncSchema } from '../../../../../data/validators'
import type { SyncReceivedDocumentsPayload } from '../../../../../workers/sync-received-documents'

export const metadata = {
  path: '/integration-ksef-direct/received-documents/sync',
  POST: { requireAuth: true, requireFeatures: ['integration_ksef_direct.received_documents.sync'] },
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await readJsonSafe(req, {})
  const parsed = ReceivedDocumentSyncSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid date range', fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    )
  }

  const container = await createRequestContainer()
  const credentialsService = container.resolve('integrationCredentialsService') as any
  const rawCreds = credentialsService
    ? await credentialsService.resolve('integration_ksef_direct', {
        tenantId: auth.tenantId,
        organizationId: auth.orgId,
      })
    : null

  const { KsefDirectCredentialsSchema } = await import('../../../../../data/validators')
  if (!KsefDirectCredentialsSchema.safeParse(rawCreds).success) {
    return NextResponse.json(
      { error: 'KSeF credentials not configured' },
      { status: 409 },
    )
  }

  const queue = createModuleQueue<SyncReceivedDocumentsPayload>('ksef_direct_receive')
  const jobId = await queue.enqueue({
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    dateFrom: parsed.data.dateFrom,
    dateTo: parsed.data.dateTo,
  })

  return NextResponse.json({ jobId, message: 'Sync job queued' }, { status: 202 })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'KSeF Direct',
  summary: 'Sync received documents',
  methods: {
    POST: {
      summary: 'Trigger date-range sync of received KSeF documents',
      description: 'Enqueues a background worker that fetches all invoices received from KSeF for the given date range.',
      requestBody: {
        contentType: 'application/json',
        schema: ReceivedDocumentSyncSchema,
      },
      responses: [
        {
          status: 202,
          description: 'Sync job queued',
          schema: z.object({
            jobId: z.string(),
            message: z.string(),
          }),
        },
      ],
      errors: [
        { status: 400, description: 'Invalid date range', schema: z.object({ error: z.string() }) },
        { status: 409, description: 'KSeF credentials not configured', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}

export default POST
