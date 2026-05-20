import { Migration } from '@mikro-orm/migrations';

export class Migration20260520230000_ksef_direct_seller_per_document extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "ksef_direct_documents" add column "seller_address_l1" text null;`);
    this.addSql(`alter table "ksef_direct_documents" add column "seller_city" text null;`);
    this.addSql(`alter table "ksef_direct_documents" add column "seller_country" text null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "ksef_direct_documents" drop column "seller_address_l1";`);
    this.addSql(`alter table "ksef_direct_documents" drop column "seller_city";`);
    this.addSql(`alter table "ksef_direct_documents" drop column "seller_country";`);
  }

}
