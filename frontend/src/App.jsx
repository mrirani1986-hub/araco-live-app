import React, { useEffect, useMemo, useState } from 'react';
import { api } from './api';

function Card({ title, children, right }) {
  return (
    <div className="card">
      <div className="card-head">
        <h3>{title}</h3>
        {right}
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('araco_token') || '');
  const [user, setUser] = useState(null);
  const [summary, setSummary] = useState(null);
  const [fuel, setFuel] = useState([]);
  const [bons, setBons] = useState([]);
  const [diesel, setDiesel] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [audit, setAudit] = useState([]);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [loginForm, setLoginForm] = useState({ username: 'admin', password: '661986' });
  const [fuelForm, setFuelForm] = useState({ date: new Date().toISOString().slice(0,10), vehicleId: 'M02', driver: '', fuelType: 'Diesel', liters: '', costPerLiter: '', odometer: '', vendor: '', notes: '' });
  const [dieselForm, setDieselForm] = useState({ date: new Date().toISOString().slice(0,10), type: 'IN', liters: '', costPerLiter: '', supplier: '' });
  const [vehicleForm, setVehicleForm] = useState({ vehicleId: '', department: '', fuelType: 'Diesel', tankCapacity: '', oilInterval: '', tireInterval: '', greasingInterval: '', truckBrand: '', driverDefault: '' });
  const [error, setError] = useState('');

  async function loadAll() {
    const [summaryData, fuelData, bonsData, dieselData, vehiclesData, auditData] = await Promise.all([
      api('/dashboard/summary'),
      api('/fuel'),
      api('/fuel-bons'),
      api('/diesel'),
      api('/vehicles'),
      api('/audit'),
    ]);
    setSummary(summaryData);
    setFuel(fuelData);
    setBons(bonsData);
    setDiesel(dieselData);
    setVehicles(vehiclesData);
    setAudit(auditData);
  }

  useEffect(() => {
    if (!token) return;
    api('/auth/me')
      .then((data) => setUser(data.user))
      .then(loadAll)
      .catch(() => {
        localStorage.removeItem('araco_token');
        setToken('');
        setUser(null);
      });
  }, [token]);

  const filteredFuel = useMemo(() => fuel.slice(0, 20), [fuel]);

  async function login(e) {
    e.preventDefault();
    setError('');
    try {
      const result = await api('/auth/login', { method: 'POST', body: JSON.stringify(loginForm) });
      localStorage.setItem('araco_token', result.token);
      setToken(result.token);
      setUser(result.user);
    } catch {
      setError('Login failed');
    }
  }

  async function saveFuel(e) {
    e.preventDefault();
    await api('/fuel', { method: 'POST', body: JSON.stringify(fuelForm) });
    setFuelForm({ ...fuelForm, liters: '', costPerLiter: '', odometer: '', vendor: '', notes: '' });
    await loadAll();
    setActiveTab('fuel');
  }

  async function saveDiesel(e) {
    e.preventDefault();
    await api('/diesel', { method: 'POST', body: JSON.stringify(dieselForm) });
    setDieselForm({ ...dieselForm, liters: '', costPerLiter: '', supplier: '' });
    await loadAll();
  }

  async function saveVehicle(e) {
    e.preventDefault();
    await api('/vehicles', { method: 'POST', body: JSON.stringify(vehicleForm) });
    setVehicleForm({ vehicleId: '', department: '', fuelType: 'Diesel', tankCapacity: '', oilInterval: '', tireInterval: '', greasingInterval: '', truckBrand: '', driverDefault: '' });
    await loadAll();
  }

  function logout() {
    localStorage.removeItem('araco_token');
    setToken('');
    setUser(null);
  }

  if (!token || !user) {
    return (
      <div className="login-shell">
        <div className="hero">
          <h1>ARACO READY MIX</h1>
          <p>Production deployment starter for fleet and fuel operations.</p>
        </div>
        <form className="login-card" onSubmit={login}>
          <h2>Login</h2>
          <input placeholder="Username" value={loginForm.username} onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })} />
          <input type="password" placeholder="Password" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} />
          <button type="submit">Enter System</button>
          {error ? <div className="error">{error}</div> : null}
          <div className="muted">Demo: admin/661986</div>
        </form>
      </div>
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">ARACO READY MIX</div>
        <div className="muted">{user.name} • {user.role}</div>
        <nav>
          {[
            ['dashboard', 'Dashboard'],
            ['entry', 'Fuel Entry'],
            ['fuel', 'Fuel Log'],
            ['bons', 'Fuel Bons'],
            ['diesel', 'Diesel Tank'],
            ['fleet', 'Fleet'],
            ['audit', 'Audit'],
          ].map(([key, label]) => (
            <button key={key} className={activeTab === key ? 'nav-btn active' : 'nav-btn'} onClick={() => setActiveTab(key)}>{label}</button>
          ))}
        </nav>
        <button className="logout" onClick={logout}>Logout</button>
      </aside>

      <main className="content">
        {activeTab === 'dashboard' && summary && (
          <>
            <div className="grid stats-grid">
              <Stat label="Total Liters" value={summary.totalLiters} />
              <Stat label="Fuel Cost" value={`$${Number(summary.totalFuelCost).toFixed(2)}`} />
              <Stat label="Active Vehicles" value={summary.activeVehicles} />
              <Stat label="Trips" value={summary.totalTrips} />
              <Stat label="Diesel In" value={summary.dieselIn} />
              <Stat label="Diesel Balance" value={summary.dieselBalance} />
            </div>
            <Card title="Recent Fuel Entries">
              <table>
                <thead><tr><th>Date</th><th>Vehicle</th><th>Driver</th><th>Liters</th><th>Bon</th></tr></thead>
                <tbody>
                  {filteredFuel.map((row) => (
                    <tr key={row.id}><td>{row.date}</td><td>{row.vehicle_id}</td><td>{row.driver}</td><td>{row.liters}</td><td>{row.bon_no}</td></tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </>
        )}

        {activeTab === 'entry' && (
          <Card title="Fuel Entry">
            <form className="form-grid" onSubmit={saveFuel}>
              <input type="date" value={fuelForm.date} onChange={(e) => setFuelForm({ ...fuelForm, date: e.target.value })} />
              <select value={fuelForm.vehicleId} onChange={(e) => setFuelForm({ ...fuelForm, vehicleId: e.target.value })}>
                {vehicles.map((v) => <option key={v.vehicle_id} value={v.vehicle_id}>{v.vehicle_id}</option>)}
              </select>
              <input placeholder="Driver" value={fuelForm.driver} onChange={(e) => setFuelForm({ ...fuelForm, driver: e.target.value })} />
              <input placeholder="Fuel Type" value={fuelForm.fuelType} onChange={(e) => setFuelForm({ ...fuelForm, fuelType: e.target.value })} />
              <input type="number" placeholder="Liters" value={fuelForm.liters} onChange={(e) => setFuelForm({ ...fuelForm, liters: e.target.value })} />
              <input type="number" step="0.01" placeholder="Cost / Liter" value={fuelForm.costPerLiter} onChange={(e) => setFuelForm({ ...fuelForm, costPerLiter: e.target.value })} />
              <input type="number" placeholder="Odometer" value={fuelForm.odometer} onChange={(e) => setFuelForm({ ...fuelForm, odometer: e.target.value })} />
              <input placeholder="Vendor" value={fuelForm.vendor} onChange={(e) => setFuelForm({ ...fuelForm, vendor: e.target.value })} />
              <textarea placeholder="Notes" value={fuelForm.notes} onChange={(e) => setFuelForm({ ...fuelForm, notes: e.target.value })} />
              <button type="submit">Save Fuel Entry</button>
            </form>
          </Card>
        )}

        {activeTab === 'fuel' && (
          <Card title="Fuel Log">
            <table>
              <thead><tr><th>Date</th><th>Vehicle</th><th>Driver</th><th>Liters</th><th>Cost/L</th><th>Bon</th><th>User</th></tr></thead>
              <tbody>
                {fuel.map((row) => (
                  <tr key={row.id}><td>{row.date}</td><td>{row.vehicle_id}</td><td>{row.driver}</td><td>{row.liters}</td><td>{row.cost_per_liter}</td><td>{row.bon_no}</td><td>{row.entered_by}</td></tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        {activeTab === 'bons' && (
          <div className="grid cards-grid">
            {bons.map((row) => (
              <Card key={row.id} title={row.bon_no} right={<button onClick={() => window.print()}>Print</button>}>
                <div className="stack"><div>Date: {row.date}</div><div>Vehicle: {row.vehicle_id}</div><div>Driver: {row.driver}</div><div>Liters: {row.liters}</div><div>Vendor: {row.vendor}</div></div>
              </Card>
            ))}
          </div>
        )}

        {activeTab === 'diesel' && (
          <div className="grid two-col">
            <Card title="Diesel Tank">
              <form className="form-grid" onSubmit={saveDiesel}>
                <input type="date" value={dieselForm.date} onChange={(e) => setDieselForm({ ...dieselForm, date: e.target.value })} />
                <select value={dieselForm.type} onChange={(e) => setDieselForm({ ...dieselForm, type: e.target.value })}>
                  <option value="IN">IN</option>
                  <option value="OUT">OUT</option>
                </select>
                <input type="number" placeholder="Liters" value={dieselForm.liters} onChange={(e) => setDieselForm({ ...dieselForm, liters: e.target.value })} />
                <input type="number" step="0.01" placeholder="Cost / Liter" value={dieselForm.costPerLiter} onChange={(e) => setDieselForm({ ...dieselForm, costPerLiter: e.target.value })} />
                <input placeholder="Supplier" value={dieselForm.supplier} onChange={(e) => setDieselForm({ ...dieselForm, supplier: e.target.value })} />
                <button type="submit">Add Diesel Transaction</button>
              </form>
            </Card>
            <Card title="Diesel History">
              <table>
                <thead><tr><th>Date</th><th>Type</th><th>Liters</th><th>Supplier</th></tr></thead>
                <tbody>{diesel.map((row) => <tr key={row.id}><td>{row.date}</td><td>{row.type}</td><td>{row.liters}</td><td>{row.supplier}</td></tr>)}</tbody>
              </table>
            </Card>
          </div>
        )}

        {activeTab === 'fleet' && (
          <div className="grid two-col">
            <Card title="Vehicles">
              <table>
                <thead><tr><th>Vehicle</th><th>Dept</th><th>Brand</th><th>Default Driver</th></tr></thead>
                <tbody>{vehicles.map((row) => <tr key={row.vehicle_id}><td>{row.vehicle_id}</td><td>{row.department}</td><td>{row.truck_brand}</td><td>{row.driver_default}</td></tr>)}</tbody>
              </table>
            </Card>
            {user.role === 'ADMIN' && (
              <Card title="Add Vehicle">
                <form className="form-grid" onSubmit={saveVehicle}>
                  <input placeholder="Vehicle ID" value={vehicleForm.vehicleId} onChange={(e) => setVehicleForm({ ...vehicleForm, vehicleId: e.target.value })} />
                  <input placeholder="Department" value={vehicleForm.department} onChange={(e) => setVehicleForm({ ...vehicleForm, department: e.target.value })} />
                  <input placeholder="Fuel Type" value={vehicleForm.fuelType} onChange={(e) => setVehicleForm({ ...vehicleForm, fuelType: e.target.value })} />
                  <input placeholder="Tank Capacity" value={vehicleForm.tankCapacity} onChange={(e) => setVehicleForm({ ...vehicleForm, tankCapacity: e.target.value })} />
                  <input placeholder="Oil Interval" value={vehicleForm.oilInterval} onChange={(e) => setVehicleForm({ ...vehicleForm, oilInterval: e.target.value })} />
                  <input placeholder="Tire Interval" value={vehicleForm.tireInterval} onChange={(e) => setVehicleForm({ ...vehicleForm, tireInterval: e.target.value })} />
                  <input placeholder="Greasing Interval" value={vehicleForm.greasingInterval} onChange={(e) => setVehicleForm({ ...vehicleForm, greasingInterval: e.target.value })} />
                  <input placeholder="Truck Brand" value={vehicleForm.truckBrand} onChange={(e) => setVehicleForm({ ...vehicleForm, truckBrand: e.target.value })} />
                  <input placeholder="Default Driver" value={vehicleForm.driverDefault} onChange={(e) => setVehicleForm({ ...vehicleForm, driverDefault: e.target.value })} />
                  <button type="submit">Create Vehicle</button>
                </form>
              </Card>
            )}
          </div>
        )}

        {activeTab === 'audit' && (
          <Card title="Audit Trail">
            <table>
              <thead><tr><th>Time</th><th>Action</th><th>User</th></tr></thead>
              <tbody>{audit.map((row) => <tr key={row.id}><td>{row.created_at}</td><td>{row.action}</td><td>{row.user_label}</td></tr>)}</tbody>
            </table>
          </Card>
        )}
      </main>
    </div>
  );
}
