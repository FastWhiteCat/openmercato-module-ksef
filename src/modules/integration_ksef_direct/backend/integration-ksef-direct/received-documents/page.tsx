"use client"

import * as React from 'react'
import { Copy, Search } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@open-mercato/ui/primitives/dialog'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'

import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export const pageMetadata = {
  requireAuth: true,
  requireFeatures: ['integration_ksef_direct.received_documents.view'],
  pageTitleKey: 'integration_ksef_direct.received_documents.title',
}

const PAGE_SIZE = 50

type ReceivedDocumentRow = {
  id: string
  ksefReferenceNumber: string
  invoiceNumber: string | null
  sellerNip: string | null
  sellerName: string | null
  issueDate: string | null
  currency: string | null
  grossAmount: string | null
  status: string
  errorMessage: string | null
  syncedAt: string | null
  createdAt: string
}

type ReceivedDocumentDetail = ReceivedDocumentRow & {
  netAmount: string | null
  vatAmount: string | null
  rawXml: string | null
  updatedAt: string
}

type ApiResponse = {
  items: ReceivedDocumentRow[]
  total: number
  page: number
  pageSize: number
}

const STATUS_VARIANT: Record<string, 'warning' | 'success' | 'error'> = {
  pending_download: 'warning',
  downloaded: 'success',
  failed: 'error',
}

// ─── Detail Modal ────────────────────────────────────────────────────────────

function DetailModal({
  documentId,
  onClose,
}: {
  documentId: string
  onClose: () => void
}) {
  const t = useT()
  const [doc, setDoc] = React.useState<ReceivedDocumentDetail | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [copied, setCopied] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiCall<ReceivedDocumentDetail>(`/api/integration-ksef-direct/received-documents/${documentId}`)
      .then((res) => {
        if (!cancelled && res.ok && res.result) setDoc(res.result)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [documentId])

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  async function handleCopy() {
    if (!doc?.rawXml) return
    try {
      await navigator.clipboard.writeText(doc.rawXml)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  return (
    <Dialog open onOpenChange={(open: boolean) => { if (!open) onClose() }}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {doc?.invoiceNumber ?? doc?.ksefReferenceNumber ?? t('integration_ksef_direct.received_documents.title', 'Received Document')}
          </DialogTitle>
        </DialogHeader>

        {loading && (
          <p className="text-sm text-muted-foreground py-4">
            {t('integration_ksef_direct.received_documents.loading', 'Loading...')}
          </p>
        )}

        {doc && !loading && (
          <div className="flex flex-col gap-4 overflow-y-auto">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <div>
                <dt className="text-muted-foreground">{t('integration_ksef_direct.received_documents.column.ksef_reference', 'KSeF Ref.')}</dt>
                <dd className="font-mono break-all">{doc.ksefReferenceNumber}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('integration_ksef_direct.received_documents.column.invoice_number', 'Invoice No.')}</dt>
                <dd>{doc.invoiceNumber ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('integration_ksef_direct.received_documents.column.seller_nip', 'Seller NIP')}</dt>
                <dd>{doc.sellerNip ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('integration_ksef_direct.received_documents.column.seller_name', 'Seller')}</dt>
                <dd>{doc.sellerName ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('integration_ksef_direct.received_documents.column.issue_date', 'Issue Date')}</dt>
                <dd>{doc.issueDate ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('integration_ksef_direct.received_documents.column.gross_amount', 'Gross Amount')}</dt>
                <dd>
                  {doc.grossAmount != null
                    ? `${parseFloat(doc.grossAmount).toLocaleString('pl-PL', { minimumFractionDigits: 2 })} ${doc.currency ?? 'PLN'}`
                    : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('integration_ksef_direct.received_documents.column.status', 'Status')}</dt>
                <dd>
                  <StatusBadge variant={STATUS_VARIANT[doc.status] ?? 'warning'}>
                    {t(`integration_ksef_direct.received_documents.status.${doc.status}`, doc.status)}
                  </StatusBadge>
                </dd>
              </div>
              {doc.errorMessage && (
                <div className="col-span-2">
                  <dt className="text-muted-foreground">Error</dt>
                  <dd className="text-status-destructive-text">{doc.errorMessage}</dd>
                </div>
              )}
            </dl>

            {doc.rawXml && (
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">XML</span>
                  <Button size="sm" variant="ghost" onClick={handleCopy} aria-label="Copy XML">
                    <Copy className="size-4 mr-1" />
                    {copied
                      ? t('integration_ksef_direct.received_documents.xml_copied', 'Copied')
                      : t('integration_ksef_direct.received_documents.copy_xml', 'Copy XML')}
                  </Button>
                </div>
                <pre className="text-xs font-mono bg-muted rounded p-3 overflow-auto max-h-64 whitespace-pre-wrap break-all">
                  {doc.rawXml}
                </pre>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── Fetch Dialog ─────────────────────────────────────────────────────────────

function FetchDialog({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const t = useT()
  const [reference, setReference] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [isSubmitting, setSubmitting] = React.useState(false)

  const { runMutation } = useGuardedMutation<{ entityType: string }>({
    contextId: 'integration_ksef_direct:fetch-received-document',
  })

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void handleSubmit()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })

  async function handleSubmit() {
    setError(null)
    setSubmitting(true)
    try {
      await runMutation({
        operation: async () => {
          const result = await apiCall('/api/integration-ksef-direct/received-documents/fetch', {
            method: 'POST',
            body: JSON.stringify({ ksefReferenceNumber: reference }),
          })
          if (!result.ok) {
            const body = result.result as Record<string, unknown>
            throw new Error(typeof body?.error === 'string' ? body.error : 'Error')
          }
          return result.result
        },
        context: { entityType: 'integration_ksef_direct.received_document' },
        mutationPayload: { entityType: 'integration_ksef_direct.received_document' },
      })
      flash(t('integration_ksef_direct.received_documents.fetch_success', 'Document fetched successfully.'), 'success')
      onClose()
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open: boolean) => { if (!open) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('integration_ksef_direct.received_documents.dialog_fetch.title', 'Fetch Document by KSeF Reference')}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <FormField label={t('integration_ksef_direct.received_documents.column.ksef_reference', 'KSeF Reference Number')} required>
            <Input
              value={reference}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReference(e.target.value)}
              placeholder="e.g. 1234567890..."
              className="font-mono"
            />
          </FormField>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} type="button">
            {t('integration_ksef_direct.received_documents.cancel', 'Cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting || !reference.trim()} type="button">
            {t('integration_ksef_direct.received_documents.dialog_fetch.submit', 'Fetch')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ReceivedDocumentsPage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [rows, setRows] = React.useState<ReceivedDocumentRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [isLoading, setLoading] = React.useState(false)
  const [fetchDialogOpen, setFetchDialogOpen] = React.useState(false)
  const [detailId, setDetailId] = React.useState<string | null>(null)

  const fetchData = React.useCallback(async () => {
    setLoading(true)
    try {
      const result = await apiCall<ApiResponse>(
        `/api/integration-ksef-direct/received-documents?page=${page}&pageSize=${PAGE_SIZE}`,
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

  const columns = React.useMemo<ColumnDef<ReceivedDocumentRow, unknown>[]>(() => [
    {
      id: 'sellerNip',
      accessorKey: 'sellerNip',
      header: t('integration_ksef_direct.received_documents.column.seller_nip', 'Seller NIP'),
      cell: ({ row }) => row.original.sellerNip ?? '—',
    },
    {
      id: 'sellerName',
      accessorKey: 'sellerName',
      header: t('integration_ksef_direct.received_documents.column.seller_name', 'Seller'),
      cell: ({ row }) => row.original.sellerName ?? '—',
    },
    {
      id: 'invoiceNumber',
      accessorKey: 'invoiceNumber',
      header: t('integration_ksef_direct.received_documents.column.invoice_number', 'Invoice No.'),
      cell: ({ row }) => row.original.invoiceNumber ?? '—',
    },
    {
      id: 'issueDate',
      accessorKey: 'issueDate',
      header: t('integration_ksef_direct.received_documents.column.issue_date', 'Issue Date'),
      cell: ({ row }) => row.original.issueDate ?? '—',
    },
    {
      id: 'grossAmount',
      header: t('integration_ksef_direct.received_documents.column.gross_amount', 'Gross Amount'),
      cell: ({ row }) => row.original.grossAmount != null
        ? (
            <span className="tabular-nums">
              {parseFloat(row.original.grossAmount).toLocaleString('pl-PL', { minimumFractionDigits: 2 })}{' '}
              {row.original.currency ?? 'PLN'}
            </span>
          )
        : '—',
    },
    {
      id: 'status',
      accessorKey: 'status',
      header: t('integration_ksef_direct.received_documents.column.status', 'Status'),
      cell: ({ row }) => (
        <StatusBadge variant={STATUS_VARIANT[row.original.status] ?? 'warning'}>
          {t(`integration_ksef_direct.received_documents.status.${row.original.status}`, row.original.status)}
        </StatusBadge>
      ),
    },
    {
      id: 'ksefReferenceNumber',
      accessorKey: 'ksefReferenceNumber',
      header: t('integration_ksef_direct.received_documents.column.ksef_reference', 'KSeF Ref.'),
      cell: ({ row }) => (
        <span className="font-mono text-sm truncate max-w-48 block" title={row.original.ksefReferenceNumber}>
          {row.original.ksefReferenceNumber}
        </span>
      ),
    },
  ], [t])

  const toolbar = (
    <Button
      variant="outline"
      size="sm"
      onClick={() => setFetchDialogOpen(true)}
    >
      <Search className="size-4 mr-2" />
      {t('integration_ksef_direct.received_documents.fetch_button', 'Fetch by reference')}
    </Button>
  )

  return (
    <Page>
      <PageBody>
        <DataTable<ReceivedDocumentRow>
          entityId="ksef_direct_received_document"
          columns={columns}
          data={rows}
          isLoading={isLoading}
          actions={toolbar}
          emptyState={t('integration_ksef_direct.received_documents.empty', 'No received documents found.')}
          pagination={{ page, pageSize: PAGE_SIZE, total, totalPages, onPageChange: setPage }}
          onRowClick={(row) => setDetailId(row.id)}
        />
      </PageBody>

      {fetchDialogOpen && (
        <FetchDialog
          onClose={() => setFetchDialogOpen(false)}
          onSuccess={() => void fetchData()}
        />
      )}

      {detailId && (
        <DetailModal
          documentId={detailId}
          onClose={() => setDetailId(null)}
        />
      )}
    </Page>
  )
}
