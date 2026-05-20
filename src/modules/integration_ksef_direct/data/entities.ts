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
