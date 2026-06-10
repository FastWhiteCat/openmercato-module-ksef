import { Migration } from '@mikro-orm/migrations';

export class Migration20260520220000_ksef_direct_send_queue extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "ksef_direct_documents" add column "ksef_processing_reference_number" text null;`);
    this.addSql(`alter table "ksef_direct_documents" add column "seller_name" text null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "ksef_direct_documents" drop column "ksef_processing_reference_number";`);
    this.addSql(`alter table "ksef_direct_documents" drop column "seller_name";`);
  }

}
