-- Engine of the two MAN trucks: D 2066 LF, as given by the owner (the engine is not on the door type plate).
-- Only fills an empty engine (never overwrites one entered in the app) and records the change in the audit log.
WITH changed AS (
  UPDATE "equipment" SET "engine" = 'D 2066 LF'
  WHERE "serial_number" IN ('WMA39WZZ4CM599234', 'WMAHW3ZZ79M540622') AND "engine" IS NULL
  RETURNING "id", "code"
)
INSERT INTO "audit_logs" ("action", "doc_type", "doc_id", "doc_number", "old_value", "new_value", "comment")
SELECT 'EQUIPMENT_EDITED', 'EQUIPMENT', "id", "code", '{"engine": null}'::jsonb, '{"engine": "D 2066 LF"}'::jsonb,
       'Engine type given by the owner (not on the type plate)'
FROM changed;
