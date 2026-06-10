import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { validateCrudMutationGuard, runCrudMutationGuardAfterSuccess } from '@open-mercato/shared/lib/crud/mutation-guard'
import { CreateKsefDirectDocumentSchema } from '../../../../data/validators'
import { createKsefDirectDocument, KsefDirectNotConfiguredError } from '../../../../commands/create-ksef-direct-document'

export const metadata = {
  path: '/integration-ksef-direct/documents',
  POST: { requireAuth: true, requireFeatures: ['integration_ksef_direct.documents.create'] },
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await readJsonSafe(req, {})
  const parsed = CreateKsefDirectDocumentSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    )
  }

  const container = await createRequestContainer()

  const guardResult = await validateCrudMutationGuard(container, {
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    userId: auth.sub ?? '',
    resourceKind: 'integration_ksef_direct.document',
    resourceId: 'new',
    operation: 'create',
    requestMethod: 'POST',
    requestHeaders: req.headers,
  })
  if (guardResult && !guardResult.ok) {
    return NextResponse.json(guardResult.body, { status: guardResult.status })
  }

  const em = container.resolve('em') as any
  const credentialsService = container.resolve('integrationCredentialsService') as any

  let result: { id: string; status: string; invoiceNumber: string; sellerNip: string }
  try {
    result = await createKsefDirectDocument(em, auth.tenantId, auth.orgId, parsed.data, credentialsService)
  } catch (err) {
    if (err instanceof KsefDirectNotConfiguredError) {
      return NextResponse.json(
        { error: 'KSeF Direct integration is not configured. Set up NIP in integration credentials first.' },
        { status: 422 },
      )
    }
    throw err
  }

  if (guardResult?.shouldRunAfterSuccess) {
    await runCrudMutationGuardAfterSuccess(container, {
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
      userId: auth.sub ?? '',
      resourceKind: 'integration_ksef_direct.document',
      resourceId: result.id,
      operation: 'create',
      requestMethod: 'POST',
      requestHeaders: req.headers,
      metadata: guardResult.metadata,
    })
  }

  return NextResponse.json(result, { status: 201 })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'KSeF Direct',
  summary: 'Create KSeF Direct document',
  methods: {
    POST: {
      summary: 'Create a manual KSeF Direct document',
      description: 'Creates a document record in draft status from manually entered invoice data.',
      requestBody: {
        contentType: 'application/json',
        schema: CreateKsefDirectDocumentSchema,
      },
      responses: [
        {
          status: 201,
          description: 'Document created',
          schema: z.object({
            id: z.string().uuid(),
            status: z.literal('draft'),
            invoiceNumber: z.string(),
            sellerNip: z.string(),
          }),
        },
      ],
      errors: [
        { status: 400, description: 'Validation error', schema: z.object({ error: z.string(), fieldErrors: z.record(z.string(), z.array(z.string())).optional() }) },
        { status: 422, description: 'Integration not configured', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
