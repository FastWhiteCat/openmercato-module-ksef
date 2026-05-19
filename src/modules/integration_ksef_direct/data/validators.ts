import { z } from 'zod'

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
