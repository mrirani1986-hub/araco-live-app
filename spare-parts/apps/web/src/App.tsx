import { useState, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3, Boxes, ClipboardCheck, ClipboardList, Factory, FileText, LayoutDashboard, LogOut, Menu, PackageCheck, ScrollText,
  Settings as SettingsIcon, ShoppingCart, Truck, Users as UsersIcon, Wrench, X,
} from 'lucide-react';
import { useAuth } from './lib/auth';
import { api } from './lib/api';
import { Spinner, cx } from './components/ui';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Parts from './pages/Parts';
import PartDetail from './pages/PartDetail';
import Machines from './pages/Machines';
import Cart from './pages/Cart';
import PrList from './pages/PrList';
import PrDetail from './pages/PrDetail';
import PoList from './pages/PoList';
import PoDetail from './pages/PoDetail';
import PoFromPr from './pages/PoFromPr';
import PoNew from './pages/PoNew';
import Receiving from './pages/Receiving';
import GrnDetail from './pages/GrnDetail';
import Inventory from './pages/Inventory';
import Suppliers from './pages/Suppliers';
import SupplierDetail from './pages/SupplierDetail';
import Reports from './pages/Reports';
import Users from './pages/Users';
import Settings from './pages/Settings';
import AuditLog from './pages/AuditLog';

interface NavItem { to: string; label: string; icon: ReactNode; perm?: string[] }
const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" /> },
  { to: '/parts', label: 'Parts', icon: <Wrench className="h-4 w-4" />, perm: ['parts.view'] },
  { to: '/machines', label: 'Machines', icon: <Factory className="h-4 w-4" />, perm: ['parts.view'] },
  { to: '/inventory', label: 'Inventory', icon: <Boxes className="h-4 w-4" />, perm: ['inventory.view'] },
  { to: '/requests', label: 'Requests / PR', icon: <ClipboardList className="h-4 w-4" />, perm: ['pr.create', 'pr.view_all', 'pr.view_approved', 'pr.approve'] },
  { to: '/purchase-orders', label: 'Purchase Orders', icon: <FileText className="h-4 w-4" />, perm: ['po.view'] },
  { to: '/receiving', label: 'Receiving', icon: <PackageCheck className="h-4 w-4" />, perm: ['grn.view', 'grn.create'] },
  { to: '/suppliers', label: 'Suppliers', icon: <Truck className="h-4 w-4" />, perm: ['suppliers.view'] },
  { to: '/reports', label: 'Reports', icon: <BarChart3 className="h-4 w-4" />, perm: ['reports.view'] },
  { to: '/users', label: 'Users', icon: <UsersIcon className="h-4 w-4" />, perm: ['users.manage'] },
  { to: '/settings', label: 'Settings', icon: <SettingsIcon className="h-4 w-4" />, perm: ['settings.manage', 'import.run', 'backup.run'] },
  { to: '/audit', label: 'Audit Log', icon: <ScrollText className="h-4 w-4" />, perm: ['audit.view'] },
];

function Shell({ children }: { children: ReactNode }) {
  const { me, can, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const cart = useQuery({ queryKey: ['cart'], queryFn: () => api.get('/cart'), enabled: can('cart.use') });
  const pending = useQuery({ queryKey: ['pending'], queryFn: () => api.get('/prs/pending'), enabled: can('pr.approve'), refetchInterval: 60_000 });
  const items = NAV.filter((n) => !n.perm || can(...n.perm));
  const sidebar = (
    <nav className="flex flex-col gap-0.5 p-2">
      {items.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.to === '/'} onClick={() => setOpen(false)}
          className={({ isActive }) => cx('flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium', isActive ? 'bg-white/15 text-white' : 'text-brand-100 hover:bg-white/10 hover:text-white')}>
          {n.icon}<span className="flex-1">{n.label}</span>
          {n.to === '/requests' && pending.data?.length ? <span className="rounded-full bg-amber-400 px-1.5 text-xs font-bold text-amber-950">{pending.data.length}</span> : null}
        </NavLink>
      ))}
    </nav>
  );
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col bg-brand-800 lg:flex">
        <Link to="/" className="flex items-center gap-2 border-b border-white/10 px-4 py-4 text-white">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-white/15"><Wrench className="h-4 w-4" /></div>
          <div className="leading-tight"><div className="text-sm font-bold">ARACO</div><div className="text-[11px] text-brand-200">Spare Parts &amp; Procurement</div></div>
        </Link>
        <div className="flex-1 overflow-y-auto">{sidebar}</div>
        <div className="border-t border-white/10 p-3 text-xs text-brand-200">{me?.fullName}<div className="text-[11px] text-brand-300">{me?.roles.join(', ')}</div></div>
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div className="w-64 bg-brand-800">
            <div className="flex items-center justify-between px-4 py-3 text-white"><span className="font-bold">ARACO Spare Parts</span><button onClick={() => setOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></button></div>
            {sidebar}
          </div>
          <div className="flex-1 bg-black/40" onClick={() => setOpen(false)} />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="app-top sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/95 px-3 backdrop-blur sm:px-5">
          <button className="lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
          <form className="flex-1" onSubmit={(e) => { e.preventDefault(); const q = new FormData(e.currentTarget).get('q'); nav(`/parts?q=${encodeURIComponent(String(q ?? ''))}`); }}>
            <input key={loc.pathname} name="q" placeholder="Search parts: number, name, machine, supplier…" className="w-full max-w-xl rounded-md border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm focus:border-brand-500 focus:bg-white focus:outline-none" />
          </form>
          {can('pr.approve') && (pending.data?.length ?? 0) > 0 && (
            <Link to="/requests?tab=approvals" className="hidden items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-200 sm:flex">
              <ClipboardCheck className="h-4 w-4" />{pending.data.length} to approve
            </Link>
          )}
          {can('cart.use') && (
            <Link to="/cart" className="relative rounded-md p-2 text-slate-600 hover:bg-slate-100" aria-label="Request cart">
              <ShoppingCart className="h-5 w-5" />
              {cart.data?.count > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-brand-700 px-1 text-[11px] font-bold text-white">{cart.data.count}</span>}
            </Link>
          )}
          <button onClick={async () => { await logout(); nav('/login'); }} className="flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100" title="Sign out">
            <LogOut className="h-4 w-4" /><span className="hidden sm:inline">Sign out</span>
          </button>
        </header>
        <main className="mx-auto w-full max-w-[1500px] flex-1 p-3 sm:p-5">{children}</main>
      </div>
    </div>
  );
}

function Guard({ perm, children }: { perm?: string[]; children: ReactNode }) {
  const { can } = useAuth();
  if (perm && !can(...perm)) return <div className="rounded-lg border bg-white p-8 text-center text-slate-600">You do not have access to this page.</div>;
  return <>{children}</>;
}

export default function App() {
  const { me, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Spinner />;
  if (!me) {
    if (loc.pathname !== '/login') return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
    return <Login />;
  }
  if (loc.pathname === '/login') return <Navigate to="/" replace />;
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/parts" element={<Guard perm={['parts.view']}><Parts /></Guard>} />
        <Route path="/parts/:id" element={<Guard perm={['parts.view']}><PartDetail /></Guard>} />
        <Route path="/machines" element={<Guard perm={['parts.view']}><Machines /></Guard>} />
        <Route path="/machines/:id" element={<Guard perm={['parts.view']}><Machines /></Guard>} />
        <Route path="/cart" element={<Guard perm={['cart.use']}><Cart /></Guard>} />
        <Route path="/requests" element={<PrList />} />
        <Route path="/requests/:id" element={<PrDetail />} />
        <Route path="/purchase-orders" element={<Guard perm={['po.view']}><PoList /></Guard>} />
        <Route path="/purchase-orders/new" element={<Guard perm={['po.create']}><PoNew /></Guard>} />
        <Route path="/purchase-orders/from-pr/:prId" element={<Guard perm={['po.create']}><PoFromPr /></Guard>} />
        <Route path="/purchase-orders/:id" element={<Guard perm={['po.view', 'grn.create']}><PoDetail /></Guard>} />
        <Route path="/receiving" element={<Guard perm={['grn.view', 'grn.create']}><Receiving /></Guard>} />
        <Route path="/receiving/:id" element={<Guard perm={['grn.view', 'grn.create']}><GrnDetail /></Guard>} />
        <Route path="/inventory" element={<Guard perm={['inventory.view']}><Inventory /></Guard>} />
        <Route path="/suppliers" element={<Guard perm={['suppliers.view']}><Suppliers /></Guard>} />
        <Route path="/suppliers/:id" element={<Guard perm={['suppliers.view']}><SupplierDetail /></Guard>} />
        <Route path="/reports" element={<Guard perm={['reports.view']}><Reports /></Guard>} />
        <Route path="/users" element={<Guard perm={['users.manage']}><Users /></Guard>} />
        <Route path="/settings" element={<Guard perm={['settings.manage', 'import.run', 'backup.run']}><Settings /></Guard>} />
        <Route path="/audit" element={<Guard perm={['audit.view']}><AuditLog /></Guard>} />
        <Route path="*" element={<div className="p-8 text-center text-slate-500">Page not found. <Link className="text-brand-700 underline" to="/">Go to dashboard</Link></div>} />
      </Routes>
    </Shell>
  );
}
