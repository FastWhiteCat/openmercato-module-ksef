"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2 } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { SectionHeader, CollapsibleSection } from '@open-mercato/ui/backend/SectionHeader'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export const pageMetadata = { features: ['integration_ksef_direct.documents.create'] }

const VAT_RATES = ['0', '5', '8', '23', 'ZW', 'NP'] as const
const CURRENCIES = ['PLN', 'EUR', 'USD', 'GBP'] as const
const VAT_RATE_MULTIPLIERS: Record<string, number> = { '0': 0, '5': 5, '8': 8, '23': 23, ZW: 0, NP: 0 }

type LineItemState = {
  description: string
  quantity: string
  unit: string
  unitNetPrice: string
  vatRate: string
}

type Totals = { net: number; vat: number; gross: number }

function round2(v: number) { return Math.round(v * 100) / 100 }

function computeTotals(items: LineItemState[]): Totals {
  let net = 0, vat = 0
  for (const item of items) {
    const qty = parseFloat(item.quantity) || 0
    const price = parseFloat(item.unitNetPrice) || 0
    const lineNet = round2(qty * price)
    const rate = VAT_RATE_MULTIPLIERS[item.vatRate] ?? 0
    const lineVat = round2(lineNet * rate / 100)
    net += lineNet
    vat += lineVat
  }
  net = round2(net)
  vat = round2(vat)
  return { net, vat, gross: round2(net + vat) }
}

function emptyLine(): LineItemState {
  return { description: '', quantity: '1', unit: 'szt', unitNetPrice: '0.00', vatRate: '23' }
}

export default function NewKsefDirectDocumentPage() {
  const t = useT()
  const router = useRouter()

  const [buyerNip, setBuyerNip] = React.useState('')
  const [buyerName, setBuyerName] = React.useState('')
  const [invoiceNumber, setInvoiceNumber] = React.useState('')
  const today = new Date().toISOString().split('T')[0]
  const [issueDate, setIssueDate] = React.useState(today)
  const [saleDate, setSaleDate] = React.useState(today)
  const [currency, setCurrency] = React.useState('PLN')
  const [lineItems, setLineItems] = React.useState<LineItemState[]>([emptyLine()])
  const [notes, setNotes] = React.useState('')
  const [sellerName, setSellerName] = React.useState('')
  const [sellerAddressL1, setSellerAddressL1] = React.useState('')
  const [sellerCity, setSellerCity] = React.useState('')
  const [sellerCountry, setSellerCountry] = React.useState('PL')
  const [submitError, setSubmitError] = React.useState<string | null>(null)
  const [isMutating, setIsMutating] = React.useState(false)

  const { runMutation } = useGuardedMutation<{ entityType: string }>({
    contextId: 'integration_ksef_direct:new-document',
  })

  const totals = React.useMemo(() => computeTotals(lineItems), [lineItems])

  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        void handleSubmit()
      }
      if (e.key === 'Escape') router.back()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, buyerNip, buyerName, invoiceNumber, issueDate, saleDate, currency, lineItems, notes, sellerName, sellerAddressL1, sellerCity, sellerCountry])

  function addLine() {
    setLineItems((prev) => [...prev, emptyLine()])
  }

  function removeLine(index: number) {
    if (lineItems.length <= 1) return
    setLineItems((prev) => prev.filter((_, i) => i !== index))
  }

  function updateLine(index: number, field: keyof LineItemState, value: string) {
    setLineItems((prev) => prev.map((item, i) => i === index ? { ...item, [field]: value } : item))
  }

  async function handleSubmit() {
    setSubmitError(null)
    setIsMutating(true)
    const body = {
      buyerNip,
      buyerName: buyerName || undefined,
      invoiceNumber,
      issueDate,
      saleDate: saleDate || undefined,
      currency,
      lineItems: lineItems.map((item) => ({
        description: item.description,
        quantity: parseFloat(item.quantity) || 0,
        unit: item.unit,
        unitNetPrice: parseFloat(item.unitNetPrice) || 0,
        vatRate: item.vatRate,
      })),
      notes: notes || undefined,
      sellerName: sellerName || undefined,
      sellerAddressL1: sellerAddressL1 || undefined,
      sellerCity: sellerCity || undefined,
      sellerCountry: sellerCountry || undefined,
    }

    try {
      await runMutation({
        operation: async () => {
          const result = await apiCall('/api/integration-ksef-direct/documents', {
            method: 'POST',
            body: JSON.stringify(body),
            headers: { 'Content-Type': 'application/json' },
          })
          if (!result.ok) {
            const err = (result.result as Record<string, unknown>)?.error
            throw new Error(typeof err === 'string' ? err : t('integration_ksef_direct.documents.form.error', 'Submission failed'))
          }
          return result.result
        },
        context: { entityType: 'integration_ksef_direct.document' },
        mutationPayload: { entityType: 'integration_ksef_direct.document' },
      })
      flash(t('integration_ksef_direct.documents.form.success', 'Document created successfully.'), 'success')
      router.push('/backend/integration-ksef-direct/documents')
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : t('integration_ksef_direct.documents.form.error', 'Submission failed'))
    } finally {
      setIsMutating(false)
    }
  }

  return (
    <Page>
      <PageBody>
        <h1 className="text-xl font-semibold mb-6">
          {t('integration_ksef_direct.documents.form.title_new', 'New KSeF Document')}
        </h1>

        {submitError && (
          <Alert variant="destructive" className="mb-6">
            <AlertDescription>{submitError}</AlertDescription>
          </Alert>
        )}

        <SectionHeader title={t('integration_ksef_direct.documents.form.section.buyer', 'Buyer')} />
        <div className="grid grid-cols-2 gap-4 mb-6">
          <FormField label={t('integration_ksef_direct.documents.form.buyer_nip', 'Buyer NIP')} required>
            <input
              type="text"
              className="w-full border border-input rounded-md px-3 py-2 text-sm"
              value={buyerNip}
              onChange={(e) => setBuyerNip(e.target.value)}
              placeholder="1234567890"
              maxLength={10}
            />
          </FormField>
          <FormField label={t('integration_ksef_direct.documents.form.buyer_name', 'Buyer Name')}>
            <input
              type="text"
              className="w-full border border-input rounded-md px-3 py-2 text-sm"
              value={buyerName}
              onChange={(e) => setBuyerName(e.target.value)}
            />
          </FormField>
        </div>

        <SectionHeader title={t('integration_ksef_direct.documents.form.section.invoice', 'Invoice Details')} />
        <div className="grid grid-cols-2 gap-4 mb-6">
          <FormField label={t('integration_ksef_direct.documents.form.invoice_number', 'Invoice Number')} required>
            <input
              type="text"
              className="w-full border border-input rounded-md px-3 py-2 text-sm"
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
            />
          </FormField>
          <FormField label={t('integration_ksef_direct.documents.form.currency', 'Currency')}>
            <select
              className="w-full border border-input rounded-md px-3 py-2 text-sm"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </FormField>
          <FormField label={t('integration_ksef_direct.documents.form.issue_date', 'Issue Date')} required>
            <input
              type="date"
              className="w-full border border-input rounded-md px-3 py-2 text-sm"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
            />
          </FormField>
          <FormField label={t('integration_ksef_direct.documents.form.sale_date', 'Sale Date')}>
            <input
              type="date"
              className="w-full border border-input rounded-md px-3 py-2 text-sm"
              value={saleDate}
              onChange={(e) => setSaleDate(e.target.value)}
            />
          </FormField>
        </div>

        <SectionHeader
          title={`${t('integration_ksef_direct.documents.form.line_items', 'Line Items')} (${lineItems.length})`}
          className="mt-6"
        />
        <div className="space-y-3 mb-4">
          {lineItems.map((item, index) => (
            <div key={index} className="grid grid-cols-12 gap-2 items-end border border-border rounded-md p-3">
              <div className="col-span-4">
                <FormField label={t('integration_ksef_direct.documents.form.line_items.description', 'Description')} required>
                  <input
                    type="text"
                    className="w-full border border-input rounded-md px-3 py-2 text-sm"
                    value={item.description}
                    onChange={(e) => updateLine(index, 'description', e.target.value)}
                  />
                </FormField>
              </div>
              <div className="col-span-2">
                <FormField label={t('integration_ksef_direct.documents.form.line_items.quantity', 'Qty')}>
                  <input
                    type="number"
                    min="0.001"
                    step="any"
                    className="w-full border border-input rounded-md px-3 py-2 text-sm"
                    value={item.quantity}
                    onChange={(e) => updateLine(index, 'quantity', e.target.value)}
                  />
                </FormField>
              </div>
              <div className="col-span-1">
                <FormField label={t('integration_ksef_direct.documents.form.line_items.unit', 'Unit')}>
                  <input
                    type="text"
                    className="w-full border border-input rounded-md px-3 py-2 text-sm"
                    value={item.unit}
                    onChange={(e) => updateLine(index, 'unit', e.target.value)}
                  />
                </FormField>
              </div>
              <div className="col-span-2">
                <FormField label={t('integration_ksef_direct.documents.form.line_items.unit_net_price', 'Net Price')}>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="w-full border border-input rounded-md px-3 py-2 text-sm"
                    value={item.unitNetPrice}
                    onChange={(e) => updateLine(index, 'unitNetPrice', e.target.value)}
                  />
                </FormField>
              </div>
              <div className="col-span-2">
                <FormField label={t('integration_ksef_direct.documents.form.line_items.vat_rate', 'VAT')}>
                  <select
                    className="w-full border border-input rounded-md px-3 py-2 text-sm"
                    value={item.vatRate}
                    onChange={(e) => updateLine(index, 'vatRate', e.target.value)}
                  >
                    {VAT_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
                  </select>
                </FormField>
              </div>
              <div className="col-span-1 flex justify-end pb-1">
                <IconButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={t('integration_ksef_direct.documents.form.line_items.remove', 'Remove line')}
                  onClick={() => removeLine(index)}
                  disabled={lineItems.length <= 1}
                >
                  <Trash2 className="size-4" />
                </IconButton>
              </div>
            </div>
          ))}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addLine} className="mb-6">
          <Plus className="size-4 mr-2" aria-hidden />
          {t('integration_ksef_direct.documents.form.line_items.add', 'Add Line')}
        </Button>

        <SectionHeader title={t('integration_ksef_direct.documents.form.section.summary', 'Summary')} />
        <div className="grid grid-cols-3 gap-4 mb-6">
          <FormField label={t('integration_ksef_direct.documents.form.net_amount', 'Net Amount')}>
            <input
              type="text"
              readOnly
              className="w-full border border-input rounded-md px-3 py-2 text-sm bg-muted"
              value={`${totals.net.toFixed(2)} ${currency}`}
            />
          </FormField>
          <FormField label={t('integration_ksef_direct.documents.form.vat_amount', 'VAT Amount')}>
            <input
              type="text"
              readOnly
              className="w-full border border-input rounded-md px-3 py-2 text-sm bg-muted"
              value={`${totals.vat.toFixed(2)} ${currency}`}
            />
          </FormField>
          <FormField label={t('integration_ksef_direct.documents.form.gross_amount', 'Gross Amount')}>
            <input
              type="text"
              readOnly
              className="w-full border border-input rounded-md px-3 py-2 text-sm bg-muted font-semibold"
              value={`${totals.gross.toFixed(2)} ${currency}`}
            />
          </FormField>
        </div>

        <SectionHeader title={t('integration_ksef_direct.documents.form.section.seller', 'Seller')} className="mt-6" />
        <div className="mb-4">
          <FormField label={t('integration_ksef_direct.documents.form.seller_name', 'Seller Name')} required>
            <input
              type="text"
              className="w-full border border-input rounded-md px-3 py-2 text-sm"
              value={sellerName}
              onChange={(e) => setSellerName(e.target.value)}
              maxLength={512}
            />
          </FormField>
        </div>

        <CollapsibleSection title={t('integration_ksef_direct.documents.form.section.seller_address', 'Seller Address (optional)')} className="mb-6">
          <div className="grid grid-cols-2 gap-4 pt-3">
            <FormField label={t('integration_ksef_direct.documents.form.seller_address_l1', 'Street and number')}>
              <input
                type="text"
                className="w-full border border-input rounded-md px-3 py-2 text-sm"
                value={sellerAddressL1}
                onChange={(e) => setSellerAddressL1(e.target.value)}
                maxLength={512}
              />
            </FormField>
            <FormField label={t('integration_ksef_direct.documents.form.seller_city', 'City')}>
              <input
                type="text"
                className="w-full border border-input rounded-md px-3 py-2 text-sm"
                value={sellerCity}
                onChange={(e) => setSellerCity(e.target.value)}
                maxLength={256}
              />
            </FormField>
            <FormField label={t('integration_ksef_direct.documents.form.seller_country', 'Country')}>
              <input
                type="text"
                className="w-full border border-input rounded-md px-3 py-2 text-sm"
                value={sellerCountry}
                onChange={(e) => setSellerCountry(e.target.value)}
                maxLength={2}
                placeholder="PL"
              />
            </FormField>
          </div>
        </CollapsibleSection>

        <FormField label={t('integration_ksef_direct.documents.form.notes', 'Notes')} className="mb-6">
          <textarea
            rows={3}
            className="w-full border border-input rounded-md px-3 py-2 text-sm"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </FormField>

        <div className="flex gap-3">
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={isMutating}
          >
            {t('integration_ksef_direct.documents.form.submit', 'Save Document')}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.back()}>
            {t('common.cancel', 'Cancel')}
          </Button>
        </div>
      </PageBody>
    </Page>
  )
}
