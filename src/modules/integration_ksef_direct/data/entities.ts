import { Entity, PrimaryKey, Property, Index, Unique } from '@mikro-orm/decorators/legacy'

export interface KsefDirectStoredLineItem {
  description: string
  quantity: number
  unit: string
  unitNetPrice: number
  vatRate: string
  netAmount: number
  vatAmount: number
  grossAmount: number
}

@Entity({ tableName: 'ksef_direct_documents' })
@Index({ properties: ['organizationId', 'tenantId'] })
@Index({ properties: ['organizationId', 'tenantId', 'status'] })
@Index({ properties: ['organizationId', 'tenantId', 'source'] })
@Index({ properties: ['ksefReferenceNumber'] })
export class KsefDirectDocument {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'source', type: 'text', default: 'manual' })
  source: 'manual' | 'ksef_sync' | 'sales_invoice' = 'manual'

  @Property({ name: 'status', type: 'text', default: 'draft' })
  status: 'draft' | 'queued' | 'sending' | 'sent' | 'failed' = 'draft'

  @Property({ name: 'ksef_reference_number', type: 'text', nullable: true })
  ksefReferenceNumber?: string | null

  @Property({ name: 'seller_nip', type: 'text' })
  sellerNip!: string

  @Property({ name: 'buyer_nip', type: 'text' })
  buyerNip!: string

  @Property({ name: 'buyer_name', type: 'text', nullable: true })
  buyerName?: string | null

  @Property({ name: 'invoice_number', type: 'text' })
  invoiceNumber!: string

  @Property({ name: 'issue_date', type: Date })
  issueDate!: Date

  @Property({ name: 'sale_date', type: Date, nullable: true })
  saleDate?: Date | null

  @Property({ name: 'net_amount', type: 'string', columnType: 'numeric(15,2)' })
  netAmount!: string

  @Property({ name: 'vat_amount', type: 'string', columnType: 'numeric(15,2)' })
  vatAmount!: string

  @Property({ name: 'gross_amount', type: 'string', columnType: 'numeric(15,2)' })
  grossAmount!: string

  @Property({ name: 'currency', type: 'text', default: 'PLN' })
  currency: string = 'PLN'

  @Property({ name: 'line_items', type: 'json', columnType: 'jsonb' })
  lineItems: KsefDirectStoredLineItem[] = []

  @Property({ name: 'notes', type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'ksef_processing_reference_number', type: 'text', nullable: true })
  ksefProcessingReferenceNumber?: string | null

  @Property({ name: 'seller_name', type: 'text', nullable: true })
  sellerName?: string | null

  @Property({ name: 'seller_address_l1', type: 'text', nullable: true })
  sellerAddressL1?: string | null

  @Property({ name: 'seller_city', type: 'text', nullable: true })
  sellerCity?: string | null

  @Property({ name: 'seller_country', type: 'text', nullable: true })
  sellerCountry?: string | null

  @Property({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string | null

  @Property({ name: 'created_at', type: Date })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'ksef_direct_received_documents' })
@Index({ properties: ['organizationId', 'tenantId'] })
@Index({ properties: ['organizationId', 'tenantId', 'status'] })
@Unique({ properties: ['organizationId', 'ksefReferenceNumber'] })
export class KsefDirectReceivedDocument {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'ksef_reference_number', type: 'text' })
  ksefReferenceNumber!: string

  @Property({ name: 'raw_xml', type: 'text', nullable: true })
  rawXml?: string | null

  @Property({ name: 'invoice_number', type: 'text', nullable: true })
  invoiceNumber?: string | null

  @Property({ name: 'seller_nip', type: 'text', nullable: true })
  sellerNip?: string | null

  @Property({ name: 'seller_name', type: 'text', nullable: true })
  sellerName?: string | null

  @Property({ name: 'issue_date', type: 'string', columnType: 'date', nullable: true })
  issueDate?: string | null

  @Property({ name: 'currency', type: 'text', nullable: true })
  currency?: string | null

  @Property({ name: 'net_amount', type: 'string', columnType: 'numeric(15,2)', nullable: true })
  netAmount?: string | null

  @Property({ name: 'vat_amount', type: 'string', columnType: 'numeric(15,2)', nullable: true })
  vatAmount?: string | null

  @Property({ name: 'gross_amount', type: 'string', columnType: 'numeric(15,2)', nullable: true })
  grossAmount?: string | null

  @Property({ name: 'status', type: 'text', default: 'pending_download' })
  status: 'pending_download' | 'downloaded' | 'failed' = 'pending_download'

  @Property({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string | null

  @Property({ name: 'upo_download_url', type: 'text', nullable: true })
  upoDownloadUrl?: string | null

  @Property({ name: 'invoice_download_url', type: 'text', nullable: true })
  invoiceDownloadUrl?: string | null

  @Property({ name: 'synced_at', type: Date, nullable: true })
  syncedAt?: Date | null

  @Property({ name: 'created_at', type: Date })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'ksef_direct_connections' })
@Index({ properties: ['status', 'updatedAt'] })
@Unique({ properties: ['organizationId', 'tenantId'] })
export class KsefDirectConnection {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'status', type: 'text', default: 'unconfigured' })
  status: 'unconfigured' | 'checking' | 'connected' | 'error' = 'unconfigured'

  @Property({ name: 'last_checked_at', type: Date, nullable: true })
  lastCheckedAt?: Date | null

  @Property({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string | null

  @Property({ name: 'error_code', type: 'text', nullable: true })
  errorCode?: string | null

  @Property({ name: 'created_at', type: Date })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
