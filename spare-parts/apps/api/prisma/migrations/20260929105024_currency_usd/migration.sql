-- AlterTable
ALTER TABLE "companies" ALTER COLUMN "currency" SET DEFAULT 'USD';

-- AlterTable
ALTER TABLE "parts" ALTER COLUMN "currency" SET DEFAULT 'USD';

-- AlterTable
ALTER TABLE "purchase_requisitions" ALTER COLUMN "currency" SET DEFAULT 'USD';

-- AlterTable
ALTER TABLE "supplier_parts" ALTER COLUMN "currency" SET DEFAULT 'USD';

-- AlterTable
ALTER TABLE "suppliers" ALTER COLUMN "currency" SET DEFAULT 'USD';

-- Company currency SAR -> USD.
-- Only the currency LABEL of records without amounts changes. Prices, requisitions, orders, receipts and stock values
-- that were already entered keep their currency (relabelling an amount would misstate its value).
UPDATE "settings" SET "value" = '"USD"'::jsonb WHERE "key" = 'currency' AND "value" = '"SAR"'::jsonb;
UPDATE "companies" SET "currency" = 'USD' WHERE "currency" = 'SAR';
UPDATE "parts" SET "currency" = 'USD' WHERE "currency" = 'SAR' AND "standard_price" IS NULL;
UPDATE "supplier_parts" SET "currency" = 'USD' WHERE "currency" = 'SAR' AND "price" IS NULL;
UPDATE "suppliers" s SET "currency" = 'USD'
 WHERE s."currency" = 'SAR'
   AND NOT EXISTS (SELECT 1 FROM "supplier_parts" sp WHERE sp."supplier_id" = s."id" AND sp."price" IS NOT NULL)
   AND NOT EXISTS (SELECT 1 FROM "purchase_orders" po WHERE po."supplier_id" = s."id");
