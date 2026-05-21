import { Migration } from '@mikro-orm/migrations';

export class Migration20260521130000_ksef_received_download_urls extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "ksef_direct_received_documents" add column if not exists "upo_download_url" text null;`);
    this.addSql(`alter table "ksef_direct_received_documents" add column if not exists "invoice_download_url" text null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "ksef_direct_received_documents" drop column if exists "upo_download_url";`);
    this.addSql(`alter table "ksef_direct_received_documents" drop column if exists "invoice_download_url";`);
  }

}
