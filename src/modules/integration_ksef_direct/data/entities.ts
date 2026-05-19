import { Entity, PrimaryKey, Property, Index, Unique } from '@mikro-orm/decorators/legacy'

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
