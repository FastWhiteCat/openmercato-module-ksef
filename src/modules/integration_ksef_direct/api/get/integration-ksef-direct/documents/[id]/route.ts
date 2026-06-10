import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { KsefDirectDocument } from '../../../../../data/entities'

export const metadata = {
  path: '/integration-ksef-direct/documents/[id]',
  GET: { requireAuth: true, requireFeatures: ['integration_ksef_direct.documents.view'] },
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as any

  const doc = await em.findOne(KsefDirectDocument, {
    id: params.id,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
  })

  if (!doc) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({
    id: doc.id,
    source: doc.source,
    status: doc.status,
    invoiceNumber: doc.invoiceNumber,
    sellerNip: doc.sellerNip,
    buyerNip: doc.buyerNip,
    buyerName: doc.buyerName ?? null,
    issueDate: doc.issueDate.toISOString().split('T')[0],
    saleDate: doc.saleDate ? doc.saleDate.toISOString().split('T')[0] : null,
    netAmount: doc.netAmount,
    vatAmount: doc.vatAmount,
    grossAmount: doc.grossAmount,
    currency: doc.currency,
    lineItems: doc.lineItems,
    notes: doc.notes ?? null,
    ksefReferenceNumber: doc.ksefReferenceNumber ?? null,
    errorMessage: doc.errorMessage ?? null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'KSeF Direct',
  summary: 'Get KSeF Direct document',
  methods: {
    GET: {
      summary: 'Get a single KSeF Direct document',
      description: 'Returns the full document record including line items.',
      responses: [
        {
          status: 200,
          description: 'Document record',
          schema: z.object({
            id: z.string().uuid(),
            source: z.string(),
            status: z.string(),
            invoiceNumber: z.string(),
            sellerNip: z.string(),
            buyerNip: z.string(),
            buyerName: z.string().nullable(),
            issueDate: z.string(),
            saleDate: z.string().nullable(),
            netAmount: z.string(),
            vatAmount: z.string(),
            grossAmount: z.string(),
            currency: z.string(),
            lineItems: z.array(z.record(z.string(), z.unknown())),
            notes: z.string().nullable(),
            ksefReferenceNumber: z.string().nullable(),
            errorMessage: z.string().nullable(),
            createdAt: z.string(),
            updatedAt: z.string(),
          }),
        },
      ],
      errors: [
        { status: 404, description: 'Document not found', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
