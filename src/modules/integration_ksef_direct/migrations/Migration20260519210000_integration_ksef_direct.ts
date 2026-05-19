import { Migration } from '@mikro-orm/migrations';

export class Migration20260519210000_integration_ksef_direct extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "ksef_direct_connections" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "status" text not null default 'unconfigured', "last_checked_at" timestamptz null, "error_message" text null, "error_code" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "ksef_direct_connections_status_updated_at_index" on "ksef_direct_connections" ("status", "updated_at");`);
    this.addSql(`alter table "ksef_direct_connections" add constraint "ksef_direct_connections_organization_id_tenant_id_unique" unique ("organization_id", "tenant_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "ksef_direct_connections";`);
  }

}
