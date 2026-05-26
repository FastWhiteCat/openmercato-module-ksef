import { Migration } from '@mikro-orm/migrations';

export class Migration20260521120000_ksef_direct_received_documents extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "ksef_direct_received_documents" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "ksef_reference_number" text not null, "raw_xml" text null, "invoice_number" text null, "seller_nip" text null, "seller_name" text null, "issue_date" date null, "currency" text null, "net_amount" numeric(15,2) null, "vat_amount" numeric(15,2) null, "gross_amount" numeric(15,2) null, "status" text not null default 'pending_download', "error_message" text null, "upo_download_url" text null, "invoice_download_url" text null, "synced_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "ksef_direct_received_documents_organization_id_tenant_id_index" on "ksef_direct_received_documents" ("organization_id", "tenant_id");`);
    this.addSql(`create index "ksef_direct_received_documents_organization_id_tenant_id_status_index" on "ksef_direct_received_documents" ("organization_id", "tenant_id", "status");`);
    this.addSql(`alter table "ksef_direct_received_documents" add constraint "ksef_direct_received_documents_organization_id_ksef_reference_number_unique" unique ("organization_id", "ksef_reference_number");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "ksef_direct_received_documents";`);
  }

}
