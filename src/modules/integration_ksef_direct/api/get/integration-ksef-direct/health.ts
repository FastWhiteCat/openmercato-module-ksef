import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { verifyAccess, KsefAuthError, KsefNetworkError } from '../../../lib/ksefClient'
import type { KsefCredentials } from '../../../lib/ksefClient'
import { KsefDirectCredentialsSchema } from '../../../data/validators'

export const metadata = {
  path: '/integration-ksef-direct/health',
  GET: { requireAuth: true, requireFeatures: ['integration_ksef_direct.manage'] },
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const credentialsService = container.resolve('integrationCredentialsService') as any
  const em = container.resolve('em') as any

  const { KsefDirectConnection } = await import('../../../data/entities')
  const { emitKsefDirectEvent } = await import('../../../events')

  const rawCredentials = credentialsService
    ? await credentialsService.resolve('integration_ksef_direct', {
        tenantId: auth.tenantId,
        organizationId: auth.orgId,
      })
    : null

  const credentialsParsed = rawCredentials
    ? KsefDirectCredentialsSchema.safeParse(rawCredentials)
    : null

  if (!credentialsParsed?.success) {
    await upsertConnection(em, KsefDirectConnection, auth.orgId, auth.tenantId, {
      status: 'unconfigured',
      lastCheckedAt: null,
      errorMessage: null,
      errorCode: null,
    })
    return NextResponse.json({ status: 'unconfigured', lastCheckedAt: null })
  }

  const credentials: KsefCredentials = {
    ksefToken: credentialsParsed.data.ksef_token,
    nip: credentialsParsed.data.nip,
    environment: credentialsParsed.data.environment,
  }

  await upsertConnection(em, KsefDirectConnection, auth.orgId, auth.tenantId, {
    status: 'checking',
    lastCheckedAt: null,
    errorMessage: null,
    errorCode: null,
  })

  try {
    const rateLimits = await verifyAccess(credentials)
    const now = new Date()

    await upsertConnection(em, KsefDirectConnection, auth.orgId, auth.tenantId, {
      status: 'connected',
      lastCheckedAt: now,
      errorMessage: null,
      errorCode: null,
    })

    await emitKsefDirectEvent('ksef_direct.connection.checked', {
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
    })
    await emitKsefDirectEvent('ksef_direct.connection.connected', {
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
    })

    return NextResponse.json({
      status: 'connected',
      lastCheckedAt: now.toISOString(),
      environment: credentials.environment,
      rateLimits,
    })
  } catch (err) {
    const now = new Date()
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'
    const errorCode =
      err instanceof KsefAuthError
        ? err.errorCode
        : err instanceof KsefNetworkError
          ? err.errorCode
          : 'UNKNOWN_ERROR'

    await upsertConnection(em, KsefDirectConnection, auth.orgId, auth.tenantId, {
      status: 'error',
      lastCheckedAt: now,
      errorMessage,
      errorCode,
    })

    await emitKsefDirectEvent('ksef_direct.connection.checked', {
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
    })
    await emitKsefDirectEvent('ksef_direct.connection.failed', {
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
    })

    return NextResponse.json({
      status: 'error',
      lastCheckedAt: now.toISOString(),
      error: errorMessage,
      errorCode,
    })
  }
}

interface UpsertPayload {
  status: 'unconfigured' | 'checking' | 'connected' | 'error'
  lastCheckedAt: Date | null
  errorMessage: string | null
  errorCode: string | null
}

async function upsertConnection(
  em: any,
  KsefDirectConnection: any,
  organizationId: string,
  tenantId: string,
  payload: UpsertPayload,
): Promise<void> {
  const existing = await em.findOne(KsefDirectConnection, { organizationId, tenantId })
  if (existing) {
    existing.status = payload.status
    existing.lastCheckedAt = payload.lastCheckedAt
    existing.errorMessage = payload.errorMessage
    existing.errorCode = payload.errorCode
    existing.updatedAt = new Date()
    await em.flush()
  } else {
    const connection = em.create(KsefDirectConnection, {
      organizationId,
      tenantId,
      status: payload.status,
      lastCheckedAt: payload.lastCheckedAt,
      errorMessage: payload.errorMessage,
      errorCode: payload.errorCode,
    })
    await em.persist(connection).flush()
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'KSeF Direct',
  summary: 'KSeF Direct health check',
  methods: {
    GET: {
      summary: 'Check KSeF Direct connection health',
      description: 'Performs a full authentication flow against the KSeF MF API v2 and returns connection status.',
      responses: [
        {
          status: 200,
          description: 'Health check result',
          schema: z.union([
            z.object({
              status: z.literal('connected'),
              lastCheckedAt: z.string(),
              environment: z.enum(['test', 'production']),
              rateLimits: z.object({
                otherPerSecond: z.number().optional(),
                otherPerMinute: z.number().optional(),
              }).optional(),
            }),
            z.object({
              status: z.literal('error'),
              lastCheckedAt: z.string(),
              error: z.string(),
              errorCode: z.string(),
            }),
            z.object({
              status: z.literal('unconfigured'),
              lastCheckedAt: z.null(),
            }),
          ]),
        },
      ],
    },
  },
}

export default GET
