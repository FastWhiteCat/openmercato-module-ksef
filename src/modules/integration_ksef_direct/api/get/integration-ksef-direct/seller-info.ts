import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { KsefDirectCredentialsSchema } from '../../../data/validators'

export const metadata = {
  path: '/integration-ksef-direct/seller-info',
  GET: { requireAuth: true, requireFeatures: ['integration_ksef_direct.documents.create'] },
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const credentialsService = container.resolve('integrationCredentialsService') as any
  const em = container.resolve('em') as any

  const rawCredentials = credentialsService
    ? await credentialsService.resolve('integration_ksef_direct', {
        tenantId: auth.tenantId,
        organizationId: auth.orgId,
      })
    : null

  const credentialsParsed = rawCredentials
    ? KsefDirectCredentialsSchema.safeParse(rawCredentials)
    : null

  const sellerNip = credentialsParsed?.success ? credentialsParsed.data.nip : null

  const { Organization } = await import('@open-mercato/core/modules/directory/data/entities')
  const org = await em.findOne(Organization, { id: auth.orgId })
  const sellerName = org?.name ?? null

  return NextResponse.json({ sellerNip, sellerName })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'KSeF Direct',
  summary: 'Get KSeF Direct seller info',
  methods: {
    GET: {
      summary: 'Get seller NIP and name for the current tenant',
      description: 'Returns seller NIP from KSeF credentials and seller name from the current Organization.',
      responses: [
        {
          status: 200,
          description: 'Seller info',
          schema: z.object({
            sellerNip: z.string().nullable(),
            sellerName: z.string().nullable(),
          }),
        },
      ],
    },
  },
}
