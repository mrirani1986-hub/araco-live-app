import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { date } from '../lib/format';
import { Button, Card, ErrorState, Field, Input, Modal, PageHeader, Spinner, StatusBadge, Table, Tabs, Td, Th } from '../components/ui';

const ROLE_CODES = ['ADMIN', 'STORE_MANAGER', 'REQUESTER', 'PROCUREMENT', 'APPROVER', 'VIEWER'];

export default function Users() {
  const [tab, setTab] = useState<'users' | 'roles'>('users');
  const [editing, setEditing] = useState<any>(null);
  const q = useQuery({ queryKey: ['users'], queryFn: () => api.get('/users') });
  return (
    <div>
      <PageHeader title="Users & roles" actions={tab === 'users' && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing({})}>New user</Button>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'users', label: 'Users' }, { key: 'roles', label: 'Role permissions' }]} />
      {tab === 'users' ? (q.isLoading ? <Spinner /> : q.error ? <ErrorState error={q.error} /> : (
        <Card bodyClass="p-0"><Table>
          <thead><tr><Th>Username</Th><Th>Name</Th><Th>Department</Th><Th>Email</Th><Th>Roles</Th><Th>Status</Th><Th>Created</Th><Th /></tr></thead>
          <tbody>{q.data.map((u: any) => (
            <tr key={u.id}><Td className="font-mono">{u.username}</Td><Td>{u.fullName}</Td><Td>{u.department ?? '—'}</Td><Td>{u.email ?? '—'}</Td><Td className="text-xs">{u.roles.join(', ')}</Td><Td><StatusBadge status={u.active ? 'ACTIVE' : 'INACTIVE'} /></Td><Td>{date(u.createdAt)}</Td><Td><Button variant="ghost" onClick={() => setEditing(u)}>Edit</Button></Td></tr>
          ))}</tbody>
        </Table></Card>
      )) : <RolesTab />}
      {editing && <UserForm user={editing.id ? editing : null} onClose={() => setEditing(null)} />}
    </div>
  );
}

function UserForm({ user, onClose }: { user: any; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { me } = useAuth();
  const [f, setF] = useState({ username: user?.username ?? '', fullName: user?.fullName ?? '', email: user?.email ?? '', department: user?.department ?? '', password: '', roles: user?.roles ?? ['REQUESTER'], active: user?.active ?? true });
  const m = useMutation({
    mutationFn: () => user
      ? api.patch(`/users/${user.id}`, { fullName: f.fullName, email: f.email || null, department: f.department || null, roles: f.roles, active: f.active, password: f.password || undefined })
      : api.post('/users', { username: f.username, fullName: f.fullName, email: f.email || null, department: f.department || null, roles: f.roles, password: f.password }),
    onSuccess: () => { toast.success(user ? 'User updated' : 'User created'); qc.invalidateQueries({ queryKey: ['users'] }); onClose(); },
    onError: (e) => toast.error(e),
  });
  return (
    <Modal open onClose={onClose} title={user ? `Edit ${user.username}` : 'New user'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} disabled={!f.fullName || !f.roles.length || (!user && (!f.username || !f.password))} onClick={() => m.mutate()}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Username" required><Input value={f.username} disabled={!!user} onChange={(e) => setF({ ...f, username: e.target.value })} /></Field>
        <Field label="Full name" required><Input value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Field>
        <Field label="Department"><Input value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} /></Field>
        <Field label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label={user ? 'New password (leave empty to keep)' : 'Password'} required={!user} hint="At least 8 characters with letters and numbers" className="sm:col-span-2"><Input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        <Field label="Roles" className="sm:col-span-2">
          <div className="grid grid-cols-2 gap-1">{ROLE_CODES.map((r) => (
            <label key={r} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.roles.includes(r)} disabled={user?.id === me?.id && r === 'ADMIN'} onChange={(e) => setF({ ...f, roles: e.target.checked ? [...f.roles, r] : f.roles.filter((x: string) => x !== r) })} />{r.replace('_', ' ')}</label>
          ))}</div>
        </Field>
        {user && user.id !== me?.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Active (inactive users cannot sign in)</label>}
      </div>
    </Modal>
  );
}

function RolesTab() {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['roles'], queryFn: () => api.get('/users/roles') });
  if (q.isLoading) return <Spinner />;
  const { roles, permissions } = q.data;
  const toggle = async (role: any, perm: string, on: boolean) => {
    try {
      await api.put(`/users/roles/${role.code}/permissions`, { permissions: on ? [...role.permissions, perm] : role.permissions.filter((p: string) => p !== perm) });
      qc.invalidateQueries({ queryKey: ['roles'] });
      toast.success(`${role.name}: permissions updated`);
    } catch (e) { toast.error(e); }
  };
  return (
    <Card bodyClass="p-0"><Table>
      <thead><tr><Th>Permission</Th>{roles.map((r: any) => <Th key={r.code} className="text-center">{r.code.replace('_', ' ')}<div className="font-normal normal-case">{r.users} users</div></Th>)}</tr></thead>
      <tbody>{permissions.map((p: any) => (
        <tr key={p.code}><Td><div className="font-mono text-xs">{p.code}</div><div className="text-xs text-slate-500">{p.description}</div></Td>
          {roles.map((r: any) => <Td key={r.code} className="text-center"><input type="checkbox" checked={r.permissions.includes(p.code)} disabled={r.code === 'ADMIN'} onChange={(e) => toggle(r, p.code, e.target.checked)} aria-label={`${r.code} ${p.code}`} /></Td>)}</tr>
      ))}</tbody>
    </Table></Card>
  );
}
