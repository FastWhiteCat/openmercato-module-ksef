"use client"

import * as React from 'react'
import Link from 'next/link'
import { FileText, Inbox } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

export const pageMetadata = {
  requireAuth: true,
  requireFeatures: ['integration_ksef_direct.manage'],
}

type HealthStatus = 'unconfigured' | 'checking' | 'connected' | 'error'

type ConnectionState = {
  status: HealthStatus
  lastCheckedAt: string | null
  environment?: 'test' | 'production'
  rateLimits?: { otherPerSecond?: number; otherPerMinute?: number }
  error?: string
  errorCode?: string
}

export default function KsefDirectPage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [state, setState] = React.useState<ConnectionState | null>(null)
  const [isLoading, setLoading] = React.useState(false)
  const [isChecking, setChecking] = React.useState(false)
  const [fetchError, setFetchError] = React.useState<string | null>(null)

  const fetchStatus = React.useCallback(async () => {
    setLoading(true)
    setFetchError(null)
    try {
      const result = await apiCall<ConnectionState>('/api/integration-ksef-direct/health')
      if (result.ok && result.result) {
        setState(result.result)
      } else {
        setFetchError('Failed to load connection status')
      }
    } catch {
      setFetchError('Failed to load connection status')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { fetchStatus() }, [fetchStatus, scopeVersion])

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        window.history.back()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  async function handleCheckConnection() {
    setChecking(true)
    try {
      const result = await apiCall<ConnectionState>('/api/integration-ksef-direct/health')
      if (result.ok && result.result) {
        setState(result.result)
      }
    } finally {
      setChecking(false)
    }
  }

  function getStatusVariant(status: HealthStatus): 'success' | 'error' | 'neutral' | 'warning' {
    switch (status) {
      case 'connected': return 'success'
      case 'error': return 'error'
      case 'checking': return 'warning'
      default: return 'neutral'
    }
  }

  function getStatusLabel(status: HealthStatus): string {
    switch (status) {
      case 'connected': return t('integration_ksef_direct.health.connected', 'Connected')
      case 'error': return t('integration_ksef_direct.health.error', 'Connection error')
      case 'checking': return t('integration_ksef_direct.health.checking', 'Checking...')
      default: return t('integration_ksef_direct.health.unconfigured', 'Not configured')
    }
  }

  return (
    <Page>
      <PageBody>
        <SectionHeader title={t('integration_ksef_direct.title', 'KSeF Direct Integration')} />

        {isLoading && !state && <LoadingMessage />}
        {fetchError && !isLoading && <ErrorMessage message={fetchError} />}

        <div className="grid grid-cols-2 gap-3 mt-2 mb-6">
          <Link href="/backend/integration-ksef-direct/documents">
            <div className="flex items-center gap-3 rounded-lg border border-border p-4 hover:bg-muted/50 transition-colors cursor-pointer">
              <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-sm font-medium">{t('integration_ksef_direct.nav.documents', 'Sent Documents')}</p>
                <p className="text-xs text-muted-foreground">{t('integration_ksef_direct.nav.documents_desc', 'Outgoing invoices sent to KSeF')}</p>
              </div>
            </div>
          </Link>
          <Link href="/backend/integration-ksef-direct/received-documents">
            <div className="flex items-center gap-3 rounded-lg border border-border p-4 hover:bg-muted/50 transition-colors cursor-pointer">
              <Inbox className="h-5 w-5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-sm font-medium">{t('integration_ksef_direct.nav.received_documents', 'Received Documents')}</p>
                <p className="text-xs text-muted-foreground">{t('integration_ksef_direct.nav.received_documents_desc', 'Invoices received from KSeF')}</p>
              </div>
            </div>
          </Link>
        </div>

        {state && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <StatusBadge variant={getStatusVariant(state.status)}>
                {getStatusLabel(state.status)}
              </StatusBadge>
              {state.environment && (
                <span className="text-sm text-muted-foreground">
                  {t('integration_ksef_direct.health.environment', 'Environment:')} <strong>{state.environment.toUpperCase()}</strong>
                </span>
              )}
            </div>

            {state.lastCheckedAt && (
              <p className="text-sm text-muted-foreground">
                {t('integration_ksef_direct.health.last_checked', 'Last check:')}{' '}
                {new Date(state.lastCheckedAt).toLocaleString()}
              </p>
            )}

            {state.status === 'connected' && state.rateLimits && (
              <p className="text-sm text-muted-foreground">
                {t('integration_ksef_direct.health.rate_limits', 'Rate limits:')}{' '}
                {[
                  state.rateLimits.otherPerSecond != null && `${state.rateLimits.otherPerSecond} req/s`,
                  state.rateLimits.otherPerMinute != null && `${state.rateLimits.otherPerMinute} req/min`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}

            {state.status === 'error' && state.error && (
              <ErrorMessage
                message={state.error}
                detail={state.errorCode}
              />
            )}

            <div className="flex justify-end pt-2">
              <Button
                type="button"
                onClick={handleCheckConnection}
                disabled={isChecking}
                variant="outline"
              >
                {isChecking
                  ? t('integration_ksef_direct.health.checking', 'Checking...')
                  : t('integration_ksef_direct.health.check_button', 'Check connection')}
              </Button>
            </div>
          </div>
        )}
      </PageBody>
    </Page>
  )
}
