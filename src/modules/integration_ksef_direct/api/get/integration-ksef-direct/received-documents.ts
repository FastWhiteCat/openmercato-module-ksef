import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { KsefDirectReceivedDocument } from '../../../data/entities'

export const metadata = {
  path: '/integration-ksef-direct/received-documents',
  GET: { requireAuth: true, requireFeatures: ['integration_ksef_direct.received_documents.view'] },
}

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  status: z.string().optional(),
  search: z.string().optional(),
})

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query' }, { status: 400 })
  }
  const query = parsed.data

  const container = await createRequestContainer()
  const em = container.resolve('em') as any

  const where: Record<string, unknown> = {
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
  }

  if (query.status) where.status = query.status

  if (query.search) {
    const pattern = `%${query.search}%`
    where.$or = [
      { ksefReferenceNumber: { $ilike: pattern } },
      { invoiceNumber: { $ilike: pattern } },
      { sellerNip: { $ilike: pattern } },
      { sellerName: { $ilike: pattern } },
    ]
  }

  const [docs, total] = await em.findAndCount(
    KsefDirectReceivedDocument,
    where,
    {
      orderBy: { createdAt: 'DESC' },
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    },
  )

  const items = docs.map((doc: KsefDirectReceivedDocument) => ({
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
    status: doc.status,
    errorMessage: doc.errorMessage ?? null,
    syncedAt: doc.syncedAt?.toISOString() ?? null,
    createdAt: doc.createdAt.toISOString(),
  }))

  return NextResponse.json({ items, total, page: query.page, pageSize: query.pageSize })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'KSeF Direct',
  summary: 'List received KSeF documents',
  methods: {
    GET: {
      summary: 'List received KSeF documents',
      description: 'Returns a paginated list of received KSeF document records for the current organization.',
      responses: [
        {
          status: 200,
          description: 'Paginated list',
          schema: z.object({
            items: z.array(z.object({
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
              status: z.string(),
              errorMessage: z.string().nullable(),
              syncedAt: z.string().nullable(),
              createdAt: z.string(),
            })),
            total: z.number(),
            page: z.number(),
            pageSize: z.number(),
          }),
        },
      ],
    },
  },
}
