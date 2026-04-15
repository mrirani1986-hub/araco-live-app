
CREATE TABLE IF NOT EXISTS app_users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN','MAZEN','RABIH','MOHAMMAD')),
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vehicles (
  id SERIAL PRIMARY KEY,
  vehicle_id TEXT UNIQUE NOT NULL,
  department TEXT NOT NULL,
  fuel_type TEXT NOT NULL,
  tank_capacity NUMERIC(12,2) NOT NULL DEFAULT 0,
  oil_interval NUMERIC(12,2) NOT NULL DEFAULT 0,
  tire_interval NUMERIC(12,2) NOT NULL DEFAULT 0,
  greasing_interval NUMERIC(12,2) NOT NULL DEFAULT 0,
  truck_brand TEXT NOT NULL,
  driver_default TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS fuel_log (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  vehicle_id TEXT NOT NULL,
  driver TEXT NOT NULL,
  fuel_type TEXT NOT NULL,
  liters NUMERIC(12,2) NOT NULL DEFAULT 0,
  cost_per_liter NUMERIC(12,2) NOT NULL DEFAULT 0,
  odometer NUMERIC(12,2) NOT NULL DEFAULT 0,
  vendor TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  entered_by TEXT NOT NULL,
  bon_no TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fuel_bons (
  id SERIAL PRIMARY KEY,
  bon_no TEXT NOT NULL UNIQUE,
  date DATE NOT NULL,
  vehicle_id TEXT NOT NULL,
  driver TEXT NOT NULL,
  liters NUMERIC(12,2) NOT NULL DEFAULT 0,
  vendor TEXT NOT NULL DEFAULT '',
  entered_by TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS diesel_tank (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('IN','OUT')),
  liters NUMERIC(12,2) NOT NULL DEFAULT 0,
  cost_per_liter NUMERIC(12,2) NOT NULL DEFAULT 0,
  supplier TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS oil_change (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  vehicle_id TEXT NOT NULL,
  odometer NUMERIC(12,2) NOT NULL DEFAULT 0,
  oil_type TEXT NOT NULL,
  quantity NUMERIC(12,2) NOT NULL DEFAULT 0,
  provider TEXT NOT NULL DEFAULT '',
  cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tire_change (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  vehicle_id TEXT NOT NULL,
  odometer NUMERIC(12,2) NOT NULL DEFAULT 0,
  tire_position TEXT NOT NULL,
  tire_type TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT '',
  cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS greasing (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  vehicle_id TEXT NOT NULL,
  odometer NUMERIC(12,2) NOT NULL DEFAULT 0,
  grease_type TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT '',
  cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS system_settings (
  id SERIAL PRIMARY KEY,
  company_name TEXT NOT NULL DEFAULT 'ARACO READY MIX',
  location TEXT NOT NULL DEFAULT 'JIEH',
  opening_stock NUMERIC(12,2) NOT NULL DEFAULT 19500,
  maintenance_alerts BOOLEAN NOT NULL DEFAULT TRUE,
  allow_import BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  action TEXT NOT NULL,
  user_label TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO system_settings (company_name, location, opening_stock, maintenance_alerts, allow_import)
SELECT 'ARACO READY MIX', 'JIEH', 19500, TRUE, TRUE
WHERE NOT EXISTS (SELECT 1 FROM system_settings);

INSERT INTO app_users (username, password_hash, role, name, active)
SELECT 'admin', 'plain:661986', 'ADMIN', 'Admin', TRUE
WHERE NOT EXISTS (SELECT 1 FROM app_users WHERE username='admin');
INSERT INTO app_users (username, password_hash, role, name, active)
SELECT 'mazen', 'plain:1234', 'MAZEN', 'Mazen', TRUE
WHERE NOT EXISTS (SELECT 1 FROM app_users WHERE username='mazen');
INSERT INTO app_users (username, password_hash, role, name, active)
SELECT 'rabih', 'plain:1234', 'RABIH', 'Rabih Nakhal', TRUE
WHERE NOT EXISTS (SELECT 1 FROM app_users WHERE username='rabih');
INSERT INTO app_users (username, password_hash, role, name, active)
SELECT 'mohammad', 'plain:1234', 'MOHAMMAD', 'Mohammad Al Irani', TRUE
WHERE NOT EXISTS (SELECT 1 FROM app_users WHERE username='mohammad');

INSERT INTO vehicles (vehicle_id, department, fuel_type, tank_capacity, oil_interval, tire_interval, greasing_interval, truck_brand, driver_default)
SELECT * FROM (VALUES
('M02', 'MIXER', 'Diesel', 400, 10000, 45000, 7000, 'MAN', 'MOKHTAR ITANI'),
('M11', 'MIXER', 'Diesel', 400, 10000, 45000, 7000, 'ACTROS', 'ABED AL REHOMAN KRAYT'),
('G10', 'PUMP', 'Diesel', 350, 8000, 35000, 5000, 'MAN', 'ABDOULLAH KHAYAT'),
('BOBCAT', 'BOBCAT', 'Diesel', 90, 250, 0, 0, 'BOBCAT', 'ABED AL HADI'),
('G02', 'GENERATOR', 'Diesel', 300, 350, 0, 0, 'PERKINS', 'OPERATOR')
) AS v(vehicle_id, department, fuel_type, tank_capacity, oil_interval, tire_interval, greasing_interval, truck_brand, driver_default)
WHERE NOT EXISTS (SELECT 1 FROM vehicles);

INSERT INTO diesel_tank (date, type, liters, cost_per_liter, supplier)
SELECT * FROM (VALUES
('2026-04-10', 'IN', 5000, 1.33, 'Supplier A'),
('2026-04-12', 'IN', 3500, 1.31, 'Supplier B')
) AS t(date, type, liters, cost_per_liter, supplier)
WHERE NOT EXISTS (SELECT 1 FROM diesel_tank);

INSERT INTO fuel_log (date, vehicle_id, driver, fuel_type, liters, cost_per_liter, odometer, vendor, notes, entered_by, bon_no)
SELECT * FROM (VALUES
('2026-04-13', 'M02', 'MOKHTAR ITANI', 'Diesel', 195, 1.50, 161951, 'Station A', '', 'ADMIN', 'BON-0194'),
('2026-04-13', 'M11', 'ABED AL REHOMAN KRAYT', 'Diesel', 97, 1.50, 284716, 'Station B', '', 'RABIH', 'BON-0195'),
('2026-04-14', 'G10', 'ABDOULLAH KHAYAT', 'Diesel', 140, 1.48, 39272, 'Internal Workshop', '', 'ADMIN', 'BON-0196')
) AS f(date, vehicle_id, driver, fuel_type, liters, cost_per_liter, odometer, vendor, notes, entered_by, bon_no)
WHERE NOT EXISTS (SELECT 1 FROM fuel_log);

INSERT INTO fuel_bons (bon_no, date, vehicle_id, driver, liters, vendor, entered_by)
SELECT bon_no, date, vehicle_id, driver, liters, vendor, entered_by FROM fuel_log
WHERE NOT EXISTS (SELECT 1 FROM fuel_bons);

INSERT INTO oil_change (date, vehicle_id, odometer, oil_type, quantity, provider, cost)
SELECT * FROM (VALUES
('2026-04-10', 'M02', 161930, '15W-40', 42, 'Internal Workshop', 0),
('2026-04-11', 'G10', 39272, '15W-40', 60, 'Internal Workshop', 0)
) AS o(date, vehicle_id, odometer, oil_type, quantity, provider, cost)
WHERE NOT EXISTS (SELECT 1 FROM oil_change);

INSERT INTO tire_change (date, vehicle_id, odometer, tire_position, tire_type, provider, cost)
SELECT * FROM (VALUES
('2026-04-11', 'M11', 284700, 'Front Left', '11R22.5', 'Dealer', 220)
) AS t(date, vehicle_id, odometer, tire_position, tire_type, provider, cost)
WHERE NOT EXISTS (SELECT 1 FROM tire_change);

INSERT INTO greasing (date, vehicle_id, odometer, grease_type, provider, cost)
SELECT * FROM (VALUES
('2026-04-09', 'M02', 161930, 'EP2', 'Internal Workshop', 0)
) AS g(date, vehicle_id, odometer, grease_type, provider, cost)
WHERE NOT EXISTS (SELECT 1 FROM greasing);

INSERT INTO audit_log (action, user_label)
SELECT 'SYSTEM INITIALIZED', 'ADMIN'
WHERE NOT EXISTS (SELECT 1 FROM audit_log);
