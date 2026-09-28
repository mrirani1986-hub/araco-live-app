-- Fast partial / fuzzy search on the catalogue
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS parts_search_text_trgm ON parts USING gin (search_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS parts_part_number_trgm ON parts USING gin (part_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS suppliers_name_trgm ON suppliers USING gin (name gin_trgm_ops);

-- Ledgers are append-only: history can never be silently changed.
CREATE OR REPLACE FUNCTION forbid_modification() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: this table is append-only', TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_modification();
CREATE TRIGGER inventory_transactions_append_only BEFORE UPDATE OR DELETE ON inventory_transactions
  FOR EACH ROW EXECUTE FUNCTION forbid_modification();
CREATE TRIGGER approvals_append_only BEFORE UPDATE OR DELETE ON approvals
  FOR EACH ROW EXECUTE FUNCTION forbid_modification();
CREATE TRIGGER source_records_append_only BEFORE UPDATE OR DELETE ON source_records
  FOR EACH ROW EXECUTE FUNCTION forbid_modification();

-- Quantities can never go negative / received can never exceed ordered.
ALTER TABLE inventory ADD CONSTRAINT inventory_on_hand_non_negative CHECK (on_hand >= 0);
ALTER TABLE inventory ADD CONSTRAINT inventory_reserved_non_negative CHECK (reserved >= 0);
ALTER TABLE purchase_order_items ADD CONSTRAINT poi_received_le_ordered CHECK (qty_received >= 0 AND qty_received <= quantity);
ALTER TABLE purchase_order_items ADD CONSTRAINT poi_qty_positive CHECK (quantity > 0);
ALTER TABLE purchase_requisition_items ADD CONSTRAINT pri_qty_positive CHECK (quantity > 0);
ALTER TABLE cart_items ADD CONSTRAINT cart_qty_positive CHECK (quantity > 0);
