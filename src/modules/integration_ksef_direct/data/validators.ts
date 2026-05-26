import { z } from 'zod'

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD')
const vatRates = ['0', '5', '8', '23', 'ZW', 'NP'] as const

export const KsefDirectLineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  unit: z.string().min(1).default('szt'),
  unitNetPrice: z.number().min(0),
  vatRate: z.enum(vatRates),
})

export const CreateKsefDirectDocumentSchema = z.object({
  buyerNip: z.string().regex(/^\d{10}$/, 'NIP must be 10 digits'),
  buyerName: z.string().max(256).optional(),
  invoiceNumber: z.string().min(1).max(256),
  issueDate: dateString,
  saleDate: dateString.optional(),
  currency: z.string().length(3).default('PLN'),
  lineItems: z.array(KsefDirectLineItemSchema).min(1),
  notes: z.string().optional(),
  sellerName: z.string().min(1).max(512).optional(),
  sellerAddressL1: z.string().min(1).max(512),
  sellerCity: z.string().min(1).max(256),
  sellerCountry: z.string().length(2).optional(),
})

export type CreateKsefDirectDocumentInput = z.infer<typeof CreateKsefDirectDocumentSchema>
export type KsefDirectLineItemInput = z.infer<typeof KsefDirectLineItemSchema>

export const KsefDirectConnectionStatusSchema = z.enum(['unconfigured', 'checking', 'connected', 'error'])

export const KsefDirectCredentialsSchema = z.object({
  ksef_token: z.string().min(1),
  nip: z.string().min(1),
  environment: z.enum(['test', 'production']),
})

export const KsefDirectRateLimitsSchema = z.object({
  otherPerSecond: z.number().optional(),
  otherPerMinute: z.number().optional(),
})

export const KsefDirectHealthResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('connected'),
    lastCheckedAt: z.string(),
    environment: z.enum(['test', 'production']),
    rateLimits: KsefDirectRateLimitsSchema.optional(),
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
  z.object({
    status: z.literal('checking'),
    lastCheckedAt: z.string().nullable(),
  }),
])

export type KsefDirectCredentials = z.infer<typeof KsefDirectCredentialsSchema>
export type KsefDirectHealthResponse = z.infer<typeof KsefDirectHealthResponseSchema>
export type KsefDirectRateLimits = z.infer<typeof KsefDirectRateLimitsSchema>

export const KsefSendInvoiceResponseSchema = z.object({
  referenceNumber: z.string(),
  processingCode: z.number().optional(),
  processingDescription: z.string().optional(),
  timestamp: z.string().optional(),
}).passthrough()

export const KsefInvoiceStatusResponseSchema = z.object({
  referenceNumber: z.string(),
  processingCode: z.number(),
  processingDescription: z.string().optional(),
  invoiceStatus: z.object({
    ksefReferenceNumber: z.string().optional(),
    invoiceNumber: z.string().optional(),
  }).optional(),
}).passthrough()

export type KsefSendInvoiceResponse = z.infer<typeof KsefSendInvoiceResponseSchema>
export type KsefInvoiceStatusResponse = z.infer<typeof KsefInvoiceStatusResponseSchema>

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD')

export const ReceivedDocumentSyncSchema = z.object({
  dateFrom: isoDate,
  dateTo: isoDate,
}).refine(
  (data) => data.dateTo >= data.dateFrom,
  { message: 'dateTo must be >= dateFrom', path: ['dateTo'] },
).refine(
  (data) => {
    const from = new Date(data.dateFrom)
    const to = new Date(data.dateTo)
    const diffDays = (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)
    return diffDays <= 366
  },
  { message: 'Date range must not exceed 366 days', path: ['dateTo'] },
)

export const ReceivedDocumentFetchSchema = z.object({
  ksefReferenceNumber: z.string().min(1),
})

export type ReceivedDocumentSyncInput = z.infer<typeof ReceivedDocumentSyncSchema>
export type ReceivedDocumentFetchInput = z.infer<typeof ReceivedDocumentFetchSchema>
