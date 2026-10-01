-- Trucks: model series, MAN type code and engine, used to show which DT catalogue parts fit each truck.
ALTER TABLE "equipment" ADD COLUMN "vehicle_series" TEXT;
ALTER TABLE "equipment" ADD COLUMN "type_code" TEXT;
ALTER TABLE "equipment" ADD COLUMN "engine" TEXT;

-- The two trucks imported from their type plates (source-data/fleet/man-trucks.json)
UPDATE "equipment" SET "vehicle_series" = 'TGS', "type_code" = '39W' WHERE "serial_number" = 'WMA39WZZ4CM599234' AND "vehicle_series" IS NULL;
UPDATE "equipment" SET "vehicle_series" = 'TGA', "type_code" = 'HW3' WHERE "serial_number" = 'WMAHW3ZZ79M540622' AND "vehicle_series" IS NULL;
