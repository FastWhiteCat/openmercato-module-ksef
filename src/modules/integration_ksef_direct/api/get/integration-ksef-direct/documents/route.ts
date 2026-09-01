import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { KsefDirectDocument } from '../../../../data/entities'

export const metadata = {
  path: '/integration-ksef-direct/documents',
  GET: { requireAuth: true, requireFeatures: ['integration_ksef_direct.documents.view'] },
}

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  status: z.string().optional(),
  source: z.string().optional(),
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
  if (query.source) where.source = query.source

  const [docs, total] = await em.findAndCount(
    KsefDirectDocument,
    where,
    {
      orderBy: { createdAt: 'DESC' },
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    },
  )

  const items = docs.map((doc: KsefDirectDocument) => ({
    id: doc.id,
    source: doc.source,
    status: doc.status,
    invoiceNumber: doc.invoiceNumber,
    buyerNip: doc.buyerNip,
    buyerName: doc.buyerName ?? null,
    issueDate: doc.issueDate.toISOString().split('T')[0],
    sellerNip: doc.sellerNip,
    netAmount: doc.netAmount,
    vatAmount: doc.vatAmount,
    grossAmount: doc.grossAmount,
    currency: doc.currency,
    ksefReferenceNumber: doc.ksefReferenceNumber ?? null,
    createdAt: doc.createdAt.toISOString(),
  }))

  return NextResponse.json({ items, total, page: query.page, pageSize: query.pageSize })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'KSeF Direct',
  summary: 'List KSeF Direct documents',
  methods: {
    GET: {
      summary: 'List KSeF Direct documents',
      description: 'Returns a paginated list of KSeF Direct document records for the current organization.',
      responses: [
        {
          status: 200,
          description: 'Paginated list',
          schema: z.object({
            items: z.array(z.object({
              id: z.string().uuid(),
              source: z.string(),
              status: z.string(),
              invoiceNumber: z.string(),
              buyerNip: z.string(),
              buyerName: z.string().nullable(),
              issueDate: z.string(),
              sellerNip: z.string(),
              netAmount: z.string(),
              vatAmount: z.string(),
              grossAmount: z.string(),
              currency: z.string(),
              ksefReferenceNumber: z.string().nullable(),
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

export default GET
