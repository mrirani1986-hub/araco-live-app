import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export interface Me {
  id: number;
  username: string;
  fullName: string;
  department: string | null;
  roles: string[];
  permissions: string[];
}

interface AuthCtx {
  me: Me | null;
  loading: boolean;
  can: (...perms: string[]) => boolean;
  hasRole: (role: string) => boolean;
  refresh: () => Promise<unknown>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>(null as never);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery<Me | null>({
    queryKey: ['me'],
    queryFn: () => api.get<Me>('/auth/me').catch((e) => { if (e.status === 401) return null; throw e; }),
    staleTime: 60_000,
    retry: false,
  });
  useEffect(() => {
    const h = () => qc.setQueryData(['me'], null);
    window.addEventListener('araco:unauthorized', h);
    return () => window.removeEventListener('araco:unauthorized', h);
  }, [qc]);
  const me = q.data ?? null;
  const value: AuthCtx = {
    me,
    loading: q.isLoading,
    can: (...perms) => !!me && perms.some((p) => me.permissions.includes(p)),
    hasRole: (r) => !!me?.roles.includes(r),
    refresh: () => q.refetch(),
    logout: async () => { await api.post('/auth/logout'); qc.clear(); qc.setQueryData(['me'], null); },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
