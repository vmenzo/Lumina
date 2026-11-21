'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken } from '@/lib/api';
import type { RolePolicy, User } from '@/types';

interface AuthCtx {
  user: User | null;
  policy: RolePolicy | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setSession: (token: string, user: User) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthCtx>({
  user: null,
  policy: null,
  loading: true,
  refresh: async () => {},
  setSession: async () => {},
  logout: async () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [policy, setPolicy] = useState<RolePolicy | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const tok = getToken();
    if (!tok) {
      setUser(null);
      setPolicy(null);
      setLoading(false);
      return;
    }
    try {
      const res = await api.me();
      setUser(res.user);
      setPolicy(res.policy);
    } catch {
      setToken(null);
      setUser(null);
      setPolicy(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setSession = useCallback(
    async (token: string, u: User) => {
      setToken(token);
      setUser(u);
      await refresh();
    },
    [refresh]
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // ignore
    }
    setToken(null);
    setUser(null);
    setPolicy(null);
  }, []);

  const value = useMemo(
    () => ({ user, policy, loading, refresh, setSession, logout }),
    [user, policy, loading, refresh, setSession, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => useContext(AuthContext);
