import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { query } from './db.js';
import { requireAuth, requireAdmin, signToken } from './auth.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') || '*', credentials: true }));
app.use(express.json());

async function audit(action, userLabel = 'SYSTEM') {
  await query('INSERT INTO audit_log(action, user_label) VALUES ($1, $2)', [action, userLabel]);
}

app.get('/api/health', async (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const result = await query(
    'SELECT id, username, password_hash, role, name, active FROM app_users WHERE lower(username)=lower($1) LIMIT 1',
    [username]
  );

  const user = result.rows[0];
  if (!user || !user.active) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const ok = user.password_hash.startsWith('plain:')
    ? password === user.password_hash.slice(6)
    : await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = signToken(user);
  await audit('USER LOGGED IN', user.role);
  res.json({ token, user: { id: user.id, username: user.username, role: user.role, name: user.name } });
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  res.json({ user: req.user });
});

app.get('/api/dashboard/summary', requireAuth, async (_req, res) => {
  const [fuel, dieselIn, vehicles, trips] = await Promise.all([
    query('SELECT COALESCE(SUM(liters),0) AS total_liters, COALESCE(SUM(liters * cost_per_liter),0) AS total_cost FROM fuel_log'),
    query("SELECT COALESCE(SUM(liters),0) AS diesel_in FROM diesel_tank WHERE type='IN'"),
    query('SELECT COUNT(*)::int AS count FROM vehicles'),
    query('SELECT COUNT(*)::int AS count FROM fuel_log'),
  ]);

  const opening = await query('SELECT opening_stock FROM system_settings LIMIT 1');
  const dieselOut = Number(fuel.rows[0].total_liters || 0);
  const openingStock = Number(opening.rows[0]?.opening_stock || 0);
  const dieselBalance = openingStock + Number(dieselIn.rows[0].diesel_in || 0) - dieselOut;

  res.json({
    totalLiters: Number(fuel.rows[0].total_liters || 0),
    totalFuelCost: Number(fuel.rows[0].total_cost || 0),
    activeVehicles: vehicles.rows[0].count,
    totalTrips: trips.rows[0].count,
    dieselIn: Number(dieselIn.rows[0].diesel_in || 0),
    dieselBalance,
  });
});

app.get('/api/fuel', requireAuth, async (_req, res) => {
  const result = await query('SELECT * FROM fuel_log ORDER BY date DESC, id DESC');
  res.json(result.rows);
});

app.post('/api/fuel', requireAuth, async (req, res) => {
  const { date, vehicleId, driver, fuelType, liters, costPerLiter, odometer, vendor, notes } = req.body;
  const bonNumberRow = await query("SELECT 'BON-' || LPAD((COALESCE(MAX(id),0)+194)::text, 4, '0') AS bon_no FROM fuel_log");
  const bonNo = bonNumberRow.rows[0].bon_no;

  const insert = await query(
    `INSERT INTO fuel_log(date, vehicle_id, driver, fuel_type, liters, cost_per_liter, odometer, vendor, notes, entered_by, bon_no)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [date, vehicleId, driver, fuelType, liters, costPerLiter, odometer, vendor, notes, req.user.role, bonNo]
  );

  await query(
    'INSERT INTO fuel_bons(bon_no, date, vehicle_id, driver, liters, vendor, entered_by) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [bonNo, date, vehicleId, driver, liters, vendor, req.user.role]
  );

  await audit(`FUEL ENTRY ADDED ${bonNo}`, req.user.role);
  res.status(201).json(insert.rows[0]);
});

app.get('/api/fuel-bons', requireAuth, async (_req, res) => {
  const result = await query('SELECT * FROM fuel_bons ORDER BY id DESC');
  res.json(result.rows);
});

app.get('/api/diesel', requireAuth, async (_req, res) => {
  const result = await query('SELECT * FROM diesel_tank ORDER BY date DESC, id DESC');
  res.json(result.rows);
});

app.post('/api/diesel', requireAuth, async (req, res) => {
  const { date, type, liters, costPerLiter, supplier } = req.body;
  const result = await query(
    'INSERT INTO diesel_tank(date, type, liters, cost_per_liter, supplier) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [date, type, liters, costPerLiter, supplier]
  );
  await audit(`DIESEL ${type} ADDED`, req.user.role);
  res.status(201).json(result.rows[0]);
});

app.get('/api/maintenance/oil', requireAuth, async (_req, res) => {
  const result = await query('SELECT * FROM oil_change ORDER BY date DESC, id DESC');
  res.json(result.rows);
});

app.get('/api/maintenance/tire', requireAuth, async (_req, res) => {
  const result = await query('SELECT * FROM tire_change ORDER BY date DESC, id DESC');
  res.json(result.rows);
});

app.get('/api/maintenance/greasing', requireAuth, async (_req, res) => {
  const result = await query('SELECT * FROM greasing ORDER BY date DESC, id DESC');
  res.json(result.rows);
});

app.get('/api/vehicles', requireAuth, async (_req, res) => {
  const result = await query('SELECT * FROM vehicles ORDER BY vehicle_id');
  res.json(result.rows);
});

app.post('/api/vehicles', requireAuth, requireAdmin, async (req, res) => {
  const { vehicleId, department, fuelType, tankCapacity, oilInterval, tireInterval, greasingInterval, truckBrand, driverDefault } = req.body;
  const result = await query(
    `INSERT INTO vehicles(vehicle_id, department, fuel_type, tank_capacity, oil_interval, tire_interval, greasing_interval, truck_brand, driver_default)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [vehicleId, department, fuelType, tankCapacity, oilInterval, tireInterval, greasingInterval, truckBrand, driverDefault]
  );
  await audit(`VEHICLE ${vehicleId} CREATED`, req.user.role);
  res.status(201).json(result.rows[0]);
});

app.get('/api/users', requireAuth, requireAdmin, async (_req, res) => {
  const result = await query('SELECT id, username, role, name, active FROM app_users ORDER BY id');
  res.json(result.rows);
});

app.post('/api/users', requireAuth, requireAdmin, async (req, res) => {
  const { username, password, role, name, active } = req.body;
  const passwordHash = await bcrypt.hash(password, 10);
  const result = await query(
    'INSERT INTO app_users(username, password_hash, role, name, active) VALUES ($1,$2,$3,$4,$5) RETURNING id, username, role, name, active',
    [username, passwordHash, role, name, active]
  );
  await audit(`USER ${username} CREATED`, req.user.role);
  res.status(201).json(result.rows[0]);
});

app.patch('/api/users/:id/toggle', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const result = await query('UPDATE app_users SET active = NOT active WHERE id=$1 RETURNING id, username, role, name, active', [id]);
  await audit(`USER STATUS CHANGED ${id}`, req.user.role);
  res.json(result.rows[0]);
});

app.get('/api/reports/daily', requireAuth, async (_req, res) => {
  const fuel = await query('SELECT vehicle_id, SUM(liters) AS liters FROM fuel_log GROUP BY vehicle_id ORDER BY vehicle_id');
  const maintenance = await query(
    `SELECT
      (SELECT COUNT(*) FROM oil_change) AS oil_count,
      (SELECT COUNT(*) FROM tire_change) AS tire_count,
      (SELECT COUNT(*) FROM greasing) AS greasing_count`
  );
  res.json({ fuelByVehicle: fuel.rows, maintenance: maintenance.rows[0] });
});

app.get('/api/audit', requireAuth, async (_req, res) => {
  const result = await query('SELECT * FROM audit_log ORDER BY id DESC LIMIT 100');
  res.json(result.rows);
});

// ─── Basketball App Routes ─────────────────────────────────────

app.get('/api/bball/drills', (_req, res) => {
  const drills = [
    { id: 'd1', category: 'dribbling', name: 'Basic Dribble',   emoji: '🏀', difficulty: 1, duration: 60,  points: 10 },
    { id: 'd2', category: 'dribbling', name: 'Crossover',       emoji: '🔀', difficulty: 2, duration: 90,  points: 20 },
    { id: 'd3', category: 'dribbling', name: 'Figure-8',        emoji: '8️⃣', difficulty: 2, duration: 90,  points: 20 },
    { id: 'd4', category: 'dribbling', name: 'Speed Dribble',   emoji: '⚡', difficulty: 3, duration: 120, points: 30 },
    { id: 's1', category: 'shooting',  name: 'Free Throw',      emoji: '🎯', difficulty: 1, duration: 60,  points: 10 },
    { id: 's2', category: 'shooting',  name: 'Layup',           emoji: '🚀', difficulty: 2, duration: 90,  points: 20 },
    { id: 's3', category: 'shooting',  name: 'Mid-Range Shot',  emoji: '🏹', difficulty: 2, duration: 90,  points: 20 },
    { id: 's4', category: 'shooting',  name: '3-Point Challenge',emoji: '⭐', difficulty: 3, duration: 120, points: 30 },
    { id: 'p1', category: 'passing',   name: 'Chest Pass',      emoji: '👐', difficulty: 1, duration: 60,  points: 10 },
    { id: 'p2', category: 'passing',   name: 'Bounce Pass',     emoji: '⬇️', difficulty: 1, duration: 60,  points: 10 },
    { id: 'p3', category: 'passing',   name: 'Overhead Pass',   emoji: '🙌', difficulty: 2, duration: 60,  points: 20 },
    { id: 'def1', category: 'defense', name: 'Defensive Stance',emoji: '🛡️', difficulty: 1, duration: 60,  points: 10 },
    { id: 'def2', category: 'defense', name: 'Slide Steps',     emoji: '↔️', difficulty: 2, duration: 90,  points: 20 },
    { id: 'def3', category: 'defense', name: 'Box Out',         emoji: '📦', difficulty: 2, duration: 60,  points: 20 },
    { id: 'c1',  category: 'conditioning', name: 'Jump Rope',   emoji: '🪢', difficulty: 1, duration: 60,  points: 10 },
    { id: 'c2',  category: 'conditioning', name: 'Agility Ladder',emoji:'🪜', difficulty: 2, duration: 90, points: 20 },
    { id: 'c3',  category: 'conditioning', name: 'Sprint Drills',emoji: '🏃', difficulty: 3, duration: 120, points: 30 },
  ];
  res.json(drills);
});

app.post('/api/bball/progress', async (req, res) => {
  const { kidId, drillId, category, points, difficulty } = req.body;
  if (!kidId || !drillId) return res.status(400).json({ error: 'kidId and drillId required' });
  try {
    const result = await query(
      'INSERT INTO bball_sessions(kid_id, drill_id, category, points, difficulty) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [kidId, drillId, category, points, difficulty || 1]
    );
    res.status(201).json(result.rows[0]);
  } catch {
    res.status(500).json({ error: 'Failed to save session' });
  }
});

app.get('/api/bball/progress/:kidId', async (req, res) => {
  const { kidId } = req.params;
  try {
    const result = await query(
      'SELECT * FROM bball_sessions WHERE kid_id=$1 ORDER BY completed_at DESC',
      [kidId]
    );
    const total = await query(
      'SELECT COUNT(*) AS count, COALESCE(SUM(points),0) AS pts FROM bball_sessions WHERE kid_id=$1',
      [kidId]
    );
    res.json({ sessions: result.rows, totalDrills: Number(total.rows[0].count), totalPoints: Number(total.rows[0].pts) });
  } catch {
    res.status(500).json({ error: 'Failed to load progress' });
  }
});

app.post('/api/bball/kids', async (req, res) => {
  const { name, avatar, age } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const result = await query(
      'INSERT INTO bball_kids(name, avatar, age) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING *',
      [name, avatar || '🦁', age || 8]
    );
    res.status(201).json(result.rows[0] || { name, avatar, age });
  } catch {
    res.status(500).json({ error: 'Failed to create kid profile' });
  }
});

app.get('/api/bball/leaderboard', async (_req, res) => {
  try {
    const result = await query(
      `SELECT k.name, k.avatar, COALESCE(SUM(s.points),0) AS total_points, COUNT(s.id) AS total_drills
       FROM bball_kids k LEFT JOIN bball_sessions s ON s.kid_id = k.id
       GROUP BY k.id, k.name, k.avatar ORDER BY total_points DESC LIMIT 10`
    );
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: 'Failed to load leaderboard' });
  }
});

app.listen(PORT, () => {
  console.log(`ARACO backend running on port ${PORT}`);
});
