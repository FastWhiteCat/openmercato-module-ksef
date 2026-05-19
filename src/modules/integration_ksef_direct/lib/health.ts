import { verifyAccess, KsefAuthError, KsefNetworkError } from './ksefClient'
import type { KsefCredentials } from './ksefClient'

export interface HealthCheckResult {
  status: 'healthy' | 'unhealthy'
  message: string
  details: Record<string, unknown>
  checkedAt: Date
}

export const ksefDirectHealthChecker = {
  async check(credentials: Record<string, unknown>): Promise<HealthCheckResult> {
    const typed: KsefCredentials = {
      ksefToken: credentials.ksef_token as string,
      nip: credentials.nip as string,
      environment: credentials.environment as 'test' | 'production',
    }

    try {
      const rateLimits = await verifyAccess(typed)
      return {
        status: 'healthy',
        message: `Connected to KSeF ${typed.environment} (NIP: ${typed.nip})`,
        details: { environment: typed.environment, nip: typed.nip, rateLimits },
        checkedAt: new Date(),
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      const errorCode =
        err instanceof KsefAuthError
          ? err.errorCode
          : err instanceof KsefNetworkError
            ? err.errorCode
            : 'UNKNOWN_ERROR'
      return {
        status: 'unhealthy',
        message: `KSeF connection failed: ${message}`,
        details: { error: message, errorCode },
        checkedAt: new Date(),
      }
    }
  },
}
