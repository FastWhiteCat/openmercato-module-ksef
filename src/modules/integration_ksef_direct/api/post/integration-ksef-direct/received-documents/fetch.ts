import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { ReceivedDocumentFetchSchema } from '../../../../data/validators'
import { KsefNetworkError } from '../../../../lib/ksefClient'

export const metadata = {
  path: '/integration-ksef-direct/received-documents/fetch',
  POST: { requireAuth: true, requireFeatures: ['integration_ksef_direct.received_documents.sync'] },
}

const receivedDocumentResponseSchema = z.object({
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
  rawXml: z.string(),
  status: z.literal('downloaded'),
  errorMessage: z.null(),
  syncedAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await readJsonSafe(req, {})
  const parsed = ReceivedDocumentFetchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const credentialsService = container.resolve('integrationCredentialsService') as any
  const rawCreds = credentialsService
    ? await credentialsService.resolve('integration_ksef_direct', {
        tenantId: auth.tenantId,
        organizationId: auth.orgId,
      })
    : null

  const { KsefDirectCredentialsSchema } = await import('../../../../data/validators')
  const credsParsed = KsefDirectCredentialsSchema.safeParse(rawCreds)
  if (!credsParsed.success) {
    return NextResponse.json({ error: 'KSeF credentials not configured' }, { status: 409 })
  }

  const credentials = {
    ksefToken: credsParsed.data.ksef_token,
    nip: credsParsed.data.nip,
    environment: credsParsed.data.environment,
    tenantId: auth.tenantId,
  }

  const { downloadInvoice } = await import('../../../../lib/ksefClient')
  const { parseReceivedInvoiceXml } = await import('../../../../lib/ksefXmlParser')
  const { KsefDirectReceivedDocument } = await import('../../../../data/entities')

  let rawContent: string
  let upoDownloadUrl: string | null = null
  let invoiceDownloadUrl: string | null = null

  try {
    const result = await downloadInvoice(credentials, parsed.data.ksefReferenceNumber)
    rawContent = result.rawContent
    upoDownloadUrl = result.upoDownloadUrl
    invoiceDownloadUrl = result.invoiceDownloadUrl
  } catch (err) {
    if (err instanceof KsefNetworkError) {
      return NextResponse.json({ error: `KSeF API error: ${err.message}` }, { status: 502 })
    }
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      return NextResponse.json({ error: 'KSeF API request timed out' }, { status: 504 })
    }
    throw err
  }

  const parsedXml = parseReceivedInvoiceXml(rawContent)
  const em = container.resolve('em') as any
  const now = new Date()

  let record = await em.findOne(KsefDirectReceivedDocument, {
    organizationId: auth.orgId,
    ksefReferenceNumber: parsed.data.ksefReferenceNumber,
  })

  if (record) {
    record.rawXml = rawContent
    if (parsedXml.invoiceNumber) record.invoiceNumber = parsedXml.invoiceNumber
    if (parsedXml.sellerNip) record.sellerNip = parsedXml.sellerNip
    if (parsedXml.sellerName) record.sellerName = parsedXml.sellerName
    if (parsedXml.issueDate) record.issueDate = parsedXml.issueDate
    if (parsedXml.currency) record.currency = parsedXml.currency
    if (parsedXml.netAmount) record.netAmount = parsedXml.netAmount
    if (parsedXml.vatAmount) record.vatAmount = parsedXml.vatAmount
    if (parsedXml.grossAmount) record.grossAmount = parsedXml.grossAmount
    if (upoDownloadUrl) record.upoDownloadUrl = upoDownloadUrl
    if (invoiceDownloadUrl) record.invoiceDownloadUrl = invoiceDownloadUrl
    record.status = 'downloaded'
    record.errorMessage = null
    record.syncedAt = now
    record.updatedAt = now
  } else {
    record = em.create(KsefDirectReceivedDocument, {
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
      ksefReferenceNumber: parsed.data.ksefReferenceNumber,
      rawXml: rawContent,
      invoiceNumber: parsedXml.invoiceNumber ?? null,
      sellerNip: parsedXml.sellerNip ?? null,
      sellerName: parsedXml.sellerName ?? null,
      issueDate: parsedXml.issueDate ?? null,
      currency: parsedXml.currency ?? null,
      netAmount: parsedXml.netAmount ?? null,
      vatAmount: parsedXml.vatAmount ?? null,
      grossAmount: parsedXml.grossAmount ?? null,
      upoDownloadUrl,
      invoiceDownloadUrl,
      status: 'downloaded',
      syncedAt: now,
    })
    em.persist(record)
  }

  await em.flush()

  return NextResponse.json({
    id: record.id,
    ksefReferenceNumber: record.ksefReferenceNumber,
    invoiceNumber: record.invoiceNumber ?? null,
    sellerNip: record.sellerNip ?? null,
    sellerName: record.sellerName ?? null,
    issueDate: record.issueDate ?? null,
    currency: record.currency ?? null,
    netAmount: record.netAmount ?? null,
    vatAmount: record.vatAmount ?? null,
    grossAmount: record.grossAmount ?? null,
    rawXml: record.rawXml,
    status: 'downloaded',
    errorMessage: null,
    syncedAt: record.syncedAt?.toISOString() ?? now.toISOString(),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'KSeF Direct',
  summary: 'Fetch received document by KSeF reference',
  methods: {
    POST: {
      summary: 'Fetch and store a single received KSeF document',
      description: 'Downloads the FA(2) XML for a given KSeF reference number and stores it locally. Synchronous — waits for the download to complete.',
      requestBody: {
        contentType: 'application/json',
        schema: ReceivedDocumentFetchSchema,
      },
      responses: [
        {
          status: 200,
          description: 'Document fetched and stored',
          schema: receivedDocumentResponseSchema,
        },
      ],
      errors: [
        { status: 400, description: 'Invalid request', schema: z.object({ error: z.string() }) },
        { status: 409, description: 'KSeF credentials not configured', schema: z.object({ error: z.string() }) },
        { status: 502, description: 'KSeF API error', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
