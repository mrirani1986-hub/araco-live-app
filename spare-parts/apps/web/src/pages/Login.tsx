import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Wrench } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, Field, Input } from '../components/ui';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { refresh } = useAuth();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-br from-brand-800 to-brand-600 p-4">
      <form className="w-full max-w-sm rounded-xl bg-white p-7 shadow-2xl" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError('');
        try {
          await api.post('/auth/login', { username, password });
          await refresh();
          const next = sp.get('next');
          nav(next && next.startsWith('/') && !next.startsWith('//') ? next : '/', { replace: true });
        } catch (err) { setError(err instanceof Error ? err.message : 'Sign-in failed'); } finally { setBusy(false); }
      }}>
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-lg bg-brand-700 text-white"><Wrench className="h-5 w-5" /></div>
          <div><div className="text-lg font-bold text-slate-900">ARACO Spare Parts</div><div className="text-xs text-slate-500">Catalogue · Procurement · Inventory</div></div>
        </div>
        <div className="space-y-3">
          <Field label="Username"><Input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required /></Field>
          <Field label="Password"><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
          {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{error}</div>}
          <Button variant="primary" type="submit" loading={busy} className="w-full py-2">Sign in</Button>
        </div>
      </form>
    </div>
  );
}
