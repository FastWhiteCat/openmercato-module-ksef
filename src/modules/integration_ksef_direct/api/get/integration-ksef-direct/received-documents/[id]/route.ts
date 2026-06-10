import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { KsefDirectReceivedDocument } from '../../../../../data/entities'

export const metadata = {
  path: '/integration-ksef-direct/received-documents/[id]',
  GET: { requireAuth: true, requireFeatures: ['integration_ksef_direct.received_documents.view'] },
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as any

  const doc = await em.findOne(KsefDirectReceivedDocument, {
    id: params.id,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
  })

  if (!doc) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({
    id: doc.id,
    ksefReferenceNumber: doc.ksefReferenceNumber,
    invoiceNumber: doc.invoiceNumber ?? null,
    sellerNip: doc.sellerNip ?? null,
    sellerName: doc.sellerName ?? null,
    issueDate: doc.issueDate ?? null,
    currency: doc.currency ?? null,
    netAmount: doc.netAmount ?? null,
    vatAmount: doc.vatAmount ?? null,
    grossAmount: doc.grossAmount ?? null,
    rawXml: doc.rawXml ?? null,
    status: doc.status,
    errorMessage: doc.errorMessage ?? null,
    syncedAt: doc.syncedAt?.toISOString() ?? null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'KSeF Direct',
  summary: 'Get received KSeF document',
  methods: {
    GET: {
      summary: 'Get a single received KSeF document',
      description: 'Returns the full received document record including raw FA(2) XML.',
      responses: [
        {
          status: 200,
          description: 'Document record',
          schema: z.object({
            id: z.string().uuid(),
            ksefReferenceNumber: z.string(),
            invoiceNumber: z.string().nullable(),
            sellerNip: z.string().nullable(),
            sellerName: z.string().nullable(),
            issueDate: z.string().nullable(),
            currency: z.string().nullable(),
            netAmount: z.string().nullable(),
            vatAmount: z.string().nullable(),
            grossAmount: z.string().nullable(),
            rawXml: z.string().nullable(),
            status: z.string(),
            errorMessage: z.string().nullable(),
            syncedAt: z.string().nullable(),
            createdAt: z.string(),
            updatedAt: z.string(),
          }),
        },
      ],
      errors: [
        { status: 404, description: 'Not found', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
