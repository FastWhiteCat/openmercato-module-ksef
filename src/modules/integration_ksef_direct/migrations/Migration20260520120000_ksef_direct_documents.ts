import { Migration } from '@mikro-orm/migrations';

export class Migration20260520120000_ksef_direct_documents extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "ksef_direct_documents" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "source" text not null default 'manual', "status" text not null default 'draft', "ksef_reference_number" text null, "seller_nip" text not null, "buyer_nip" text not null, "buyer_name" text null, "invoice_number" text not null, "issue_date" timestamptz not null, "sale_date" timestamptz null, "net_amount" numeric(15,2) not null, "vat_amount" numeric(15,2) not null, "gross_amount" numeric(15,2) not null, "currency" text not null default 'PLN', "line_items" jsonb not null default '[]', "notes" text null, "error_message" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "ksef_direct_documents_organization_id_tenant_id_index" on "ksef_direct_documents" ("organization_id", "tenant_id");`);
    this.addSql(`create index "ksef_direct_documents_organization_id_tenant_id_status_index" on "ksef_direct_documents" ("organization_id", "tenant_id", "status");`);
    this.addSql(`create index "ksef_direct_documents_organization_id_tenant_id_source_index" on "ksef_direct_documents" ("organization_id", "tenant_id", "source");`);
    this.addSql(`create index "ksef_direct_documents_ksef_reference_number_index" on "ksef_direct_documents" ("ksef_reference_number");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "ksef_direct_documents";`);
  }

}
