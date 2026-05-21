import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { generateKsefInvoiceNumber } from '../../../lib/invoiceNumberFormat'

export const metadata = {
  path: '/integration-ksef-direct/invoice-numbers',
  POST: { requireAuth: true, requireFeatures: ['integration_ksef_direct.documents.create'] },
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const number = generateKsefInvoiceNumber()
  return NextResponse.json({ number }, { status: 201 })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'KSeF Direct',
  summary: 'Generate KSeF invoice number',
  methods: {
    POST: {
      summary: 'Generate a unique KSeF invoice number',
      description: 'Returns a unique invoice number in FV/{yyyy}/{mm}/{id} format using a cryptographically random identifier.',
      responses: [
        {
          status: 201,
          description: 'Generated invoice number',
          schema: z.object({
            number: z.string(),
          }),
        },
      ],
    },
  },
}
