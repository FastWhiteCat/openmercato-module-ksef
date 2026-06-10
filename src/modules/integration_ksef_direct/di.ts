import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { ksefDirectHealthChecker } from './lib/health'

export function register(container: AppContainer) {
  container.register({
    ksefDirectHealthChecker: asValue(ksefDirectHealthChecker),
  })
}
