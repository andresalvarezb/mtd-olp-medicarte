'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ROLE_META, type Role } from '@/components/navigation/nav-config';

const ROLE_STORAGE_KEY = 'authz-demo-role';
const SESSION_STORAGE_KEY = 'authz-demo-session';

export type AuthStatus = 'loading' | 'unauthenticated' | 'authenticated';

export interface SessionUser {
  email: string;
  name: string;
  initials: string;
}

interface RoleContextValue {
  role: Role;
  setRole: (role: Role) => void;
  roleLabel: string;
  roleNote: string;
  status: AuthStatus;
  user: SessionUser | null;
  login: (role: Role, email: string) => void;
  logout: () => void;
}

const RoleContext = createContext<RoleContextValue | null>(null);

function initialsForEmail(email: string): string {
  const localPart = email.split('@')[0] ?? '';
  const parts = localPart.split(/[.\-_+ ]+/).filter(Boolean);
  if (parts.length >= 2) {
    const first = parts[0]?.charAt(0) ?? '';
    const second = parts[1]?.charAt(0) ?? '';
    return (first + second).toUpperCase();
  }
  return localPart.slice(0, 2).toUpperCase() || 'UD';
}

function nameForEmail(email: string): string {
  const localPart = email.split('@')[0] ?? '';
  return localPart
    .split(/[.\-_+ ]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<Role>('MTD');
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    const storedRole = window.localStorage.getItem(ROLE_STORAGE_KEY);
    if (storedRole === 'MTD' || storedRole === 'COMPENSAR' || storedRole === 'OLP' || storedRole === 'MEDICARTE') {
      setRoleState(storedRole);
    }

    const storedEmail = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (storedEmail) {
      setUser({
        email: storedEmail,
        name: nameForEmail(storedEmail),
        initials: initialsForEmail(storedEmail),
      });
      setStatus('authenticated');
    } else {
      setStatus('unauthenticated');
    }
  }, []);

  const setRole = useCallback((next: Role) => {
    setRoleState(next);
    window.localStorage.setItem(ROLE_STORAGE_KEY, next);
  }, []);

  const login = useCallback((nextRole: Role, email: string) => {
    setRoleState(nextRole);
    window.localStorage.setItem(ROLE_STORAGE_KEY, nextRole);
    window.localStorage.setItem(SESSION_STORAGE_KEY, email);
    setUser({ email, name: nameForEmail(email), initials: initialsForEmail(email) });
    setStatus('authenticated');
  }, []);

  const logout = useCallback(() => {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  const value = useMemo<RoleContextValue>(
    () => ({
      role,
      setRole,
      roleLabel: ROLE_META[role].label,
      roleNote: ROLE_META[role].note,
      status,
      user,
      login,
      logout,
    }),
    [role, setRole, status, user, login, logout],
  );

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRole(): RoleContextValue {
  const ctx = useContext(RoleContext);
  if (!ctx) {
    throw new Error('useRole debe usarse dentro de RoleProvider');
  }
  return ctx;
}
