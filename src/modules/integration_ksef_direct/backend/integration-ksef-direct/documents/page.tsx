"use client"

import * as React from 'react'
import Link from 'next/link'
import { Plus, Send, RefreshCw } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'

const PAGE_SIZE = 50

const STATUS_VARIANT: Record<string, 'success' | 'error' | 'warning' | 'neutral'> = {
  draft: 'neutral',
  queued: 'warning',
  sending: 'warning',
  sent: 'success',
  failed: 'error',
}

export const pageMetadata = {
  features: ['integration_ksef_direct.documents.view'],
}

type DocumentRow = {
  id: string
  source: string
  status: string
  invoiceNumber: string
  buyerNip: string
  buyerName: string | null
  issueDate: string
  grossAmount: string
  currency: string
  ksefReferenceNumber: string | null
  createdAt: string
}

type ApiResponse = {
  items: DocumentRow[]
  total: number
  page: number
  pageSize: number
}

export default function KsefDirectDocumentsPage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [rows, setRows] = React.useState<DocumentRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [isLoading, setLoading] = React.useState(false)
  const [sendingId, setSendingId] = React.useState<string | null>(null)

  const { runMutation } = useGuardedMutation<{ entityType: string }>({
    contextId: 'integration_ksef_direct:send-document',
  })

  const fetchData = React.useCallback(async () => {
    setLoading(true)
    try {
      const result = await apiCall<ApiResponse>(
        `/api/integration-ksef-direct/documents?page=${page}&pageSize=${PAGE_SIZE}`,
      )
      if (result.ok && result.result) {
        setRows(result.result.items)
        setTotal(result.result.total)
        setTotalPages(Math.max(1, Math.ceil(result.result.total / PAGE_SIZE)))
      } else {
        setRows([])
        setTotal(0)
        setTotalPages(1)
      }
    } catch {
      setRows([])
      setTotal(0)
      setTotalPages(1)
    } finally {
      setLoading(false)
    }
  }, [page])

  React.useEffect(() => { void fetchData() }, [fetchData, scopeVersion])

  useAppEvent('ksef_direct.document.*', () => { void fetchData() }, [fetchData])

  const handleSend = React.useCallback(async (documentId: string) => {
    setSendingId(documentId)
    try {
      await runMutation({
        operation: async () => {
          const result = await apiCall(`/api/integration-ksef-direct/documents/${documentId}/send`, {
            method: 'POST',
          })
          if (!result.ok) {
            const err = (result.result as Record<string, unknown>)?.error
            throw new Error(typeof err === 'string' ? err : t('integration_ksef_direct.documents.errors.send_failed', 'Send failed'))
          }
          return result.result
        },
        context: { entityType: 'integration_ksef_direct.document' },
        mutationPayload: { entityType: 'integration_ksef_direct.document' },
      })
      flash(t('integration_ksef_direct.documents.send_success', 'Document queued for sending'), 'success')
      void fetchData()
    } catch (err) {
      flash(err instanceof Error ? err.message : t('integration_ksef_direct.documents.errors.send_failed', 'Send failed'), 'error')
    } finally {
      setSendingId(null)
    }
  }, [runMutation, t, fetchData])

  const columns = React.useMemo<ColumnDef<DocumentRow, unknown>[]>(() => [
    {
      id: 'invoiceNumber',
      accessorKey: 'invoiceNumber',
      header: t('integration_ksef_direct.documents.columns.invoiceNumber', 'Invoice Number'),
      cell: ({ row }) => <span className="font-medium">{row.original.invoiceNumber}</span>,
    },
    {
      id: 'buyer',
      header: t('integration_ksef_direct.documents.columns.buyer', 'Buyer'),
      cell: ({ row }) => (
        <span>
          {row.original.buyerName
            ? `${row.original.buyerName} (${row.original.buyerNip})`
            : row.original.buyerNip}
        </span>
      ),
    },
    {
      id: 'issueDate',
      accessorKey: 'issueDate',
      header: t('integration_ksef_direct.documents.columns.issueDate', 'Issue Date'),
      cell: ({ row }) => new Date(row.original.issueDate).toLocaleDateString(),
    },
    {
      id: 'grossAmount',
      accessorKey: 'grossAmount',
      header: t('integration_ksef_direct.documents.columns.grossAmount', 'Gross Amount'),
      cell: ({ row }) => (
        <span className="tabular-nums">
          {parseFloat(row.original.grossAmount).toLocaleString('pl-PL', { minimumFractionDigits: 2 })}{' '}
          {row.original.currency}
        </span>
      ),
    },
    {
      id: 'status',
      accessorKey: 'status',
      header: t('integration_ksef_direct.documents.columns.status', 'Status'),
      cell: ({ row }) => (
        <StatusBadge variant={STATUS_VARIANT[row.original.status] ?? 'neutral'}>
          {t(`integration_ksef_direct.documents.status.${row.original.status}`, row.original.status)}
        </StatusBadge>
      ),
    },
    {
      id: 'ksefReferenceNumber',
      header: t('integration_ksef_direct.documents.ksef_reference_number', 'KSeF Number'),
      cell: ({ row }) => row.original.ksefReferenceNumber
        ? <span className="font-mono text-sm">{row.original.ksefReferenceNumber}</span>
        : null,
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const { id, status } = row.original
        const isSending = sendingId === id
        if (status === 'draft') {
          return (
            <Button
              size="sm"
              variant="ghost"
              disabled={isSending}
              onClick={() => void handleSend(id)}
              aria-label={t('integration_ksef_direct.documents.send_button', 'Send to KSeF')}
            >
              <Send className="h-4 w-4 mr-1" />
              {t('integration_ksef_direct.documents.send_button', 'Send to KSeF')}
            </Button>
          )
        }
        if (status === 'failed') {
          return (
            <Button
              size="sm"
              variant="ghost"
              disabled={isSending}
              onClick={() => void handleSend(id)}
              aria-label={t('integration_ksef_direct.documents.retry_button', 'Retry send')}
            >
              <RefreshCw className="h-4 w-4 mr-1" />
              {t('integration_ksef_direct.documents.retry_button', 'Retry')}
            </Button>
          )
        }
        return null
      },
    },
  ], [t, sendingId, handleSend])

  return (
    <Page>
      <PageBody>
        <DataTable<DocumentRow>
          columns={columns}
          data={rows}
          isLoading={isLoading}
          actions={(
            <Button asChild>
              <Link href="/backend/integration-ksef-direct/documents/new">
                <Plus className="h-4 w-4 mr-2" />
                {t('integration_ksef_direct.documents.list.actions.new', 'New Document')}
              </Link>
            </Button>
          )}
          emptyTitle={t('integration_ksef_direct.documents.empty.title', 'No KSeF documents yet')}
          emptyDescription={t('integration_ksef_direct.documents.empty.description', 'Add your first document manually or configure KSeF sync.')}
          pagination={{ page, pageSize: PAGE_SIZE, total, totalPages, onPageChange: setPage }}
        />
      </PageBody>
    </Page>
  )
}
