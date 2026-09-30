-- Several companies: PRs and POs record the company they are for.
ALTER TABLE "companies" ADD COLUMN "logo_key" TEXT;
ALTER TABLE "purchase_requisitions" ADD COLUMN "company_id" INTEGER;
ALTER TABLE "purchase_orders" ADD COLUMN "company_id" INTEGER;
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "purchase_requisitions_company_id_idx" ON "purchase_requisitions"("company_id");
CREATE INDEX "purchase_orders_company_id_idx" ON "purchase_orders"("company_id");

-- Existing PRs and POs were all raised for the main company (the first one).
UPDATE "purchase_requisitions" SET "company_id" = (SELECT MIN("id") FROM "companies") WHERE "company_id" IS NULL;
UPDATE "purchase_orders" SET "company_id" = (SELECT MIN("id") FROM "companies") WHERE "company_id" IS NULL;

-- Second company requested by the owner. Only added to an installation that already has its main
-- company, so a new empty database still gets ARACO as the main (first) company from the seed.
INSERT INTO "companies" ("code", "name", "currency")
SELECT 'SKYLINE', 'Skyline Contracting', COALESCE((SELECT "currency" FROM "companies" ORDER BY "id" LIMIT 1), 'USD')
WHERE EXISTS (SELECT 1 FROM "companies") AND NOT EXISTS (SELECT 1 FROM "companies" WHERE "code" = 'SKYLINE');
