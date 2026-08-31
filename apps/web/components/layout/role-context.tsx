'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ROLES, ROLE_META, type Role } from '@/components/navigation/nav-config';
import { authenticate, clearSession } from '@/lib/auth';
import { ApiError, apiRequest } from '@/lib/api-client';
import type { MeResponse } from '@authorization/contracts';

export class InvalidCredentialsError extends Error {
  constructor() {
    super('Credenciales inválidas. Verifica tu usuario y contraseña.');
  }
}

export class ProfileError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

const ME_STORAGE_KEY = 'authz-api-me';

function readStoredMe(): MeResponse | null {
  if (typeof window === 'undefined') return null;
  const raw = window.sessionStorage.getItem(ME_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MeResponse;
  } catch {
    return null;
  }
}

async function fetchProfile(): Promise<MeResponse> {
  const profile = await apiRequest<MeResponse>('/me');
  if (!profile.organizations.length) {
    throw new ProfileError(
      'El usuario no tiene organizaciones activas asignadas.',
      'LOCAL_USER_INACTIVE',
    );
  }
  return profile;
}

/** Organizaciones del perfil que corresponden a roles de navegación, en orden de prioridad. */
export function rolesFromProfile(me: MeResponse | null): Role[] {
  if (!me) return [];
  const scoped = new Set(me.organizations.map((organization) => organization.code));
  return ROLES.filter((role) => scoped.has(role));
}

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

export type AuthStatus = 'loading' | 'unauthenticated' | 'authenticated';

export interface SessionUser {
  email: string;
  name: string;
  initials: string;
}

interface RoleContextValue {
  /** Rol principal (primera organización del perfil). */
  role: Role;
  /** Todos los roles derivados de las credenciales del usuario. */
  roles: Role[];
  roleLabel: string;
  roleNote: string;
  status: AuthStatus;
  user: SessionUser | null;
  me: MeResponse | null;
  organizationId: string;
  hasPermission: (permission: string) => boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const RoleContext = createContext<RoleContextValue | null>(null);

/** Limpia claves de sesiones antiguas (incluido el modo demostración). */
function clearLegacyStorage(): void {
  window.localStorage.removeItem('authz-demo-role');
  window.localStorage.removeItem('authz-demo-session');
}

function userFromMe(me: MeResponse): SessionUser {
  const email = me.email;
  const name = me.displayName?.trim() || nameForEmail(email);
  const nameInitials = name
    .split(/[.\-_+ ]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
  return { email, name, initials: nameInitials || initialsForEmail(email) };
}

export function RoleProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    clearLegacyStorage();
    const storedMe = readStoredMe();
    if (storedMe) {
      setMe(storedMe);
      setUser(userFromMe(storedMe));
      setStatus('authenticated');
    } else {
      clearSession();
      setStatus('unauthenticated');
    }
  }, []);

  const roles = useMemo(() => rolesFromProfile(me), [me]);
  const role = roles[0] ?? 'MTD';

  const login = useCallback(async (email: string, password: string): Promise<void> => {
    try {
      await authenticate(email, password);
    } catch (error) {
      if (error instanceof Error && error.name === 'InvalidCredentialsError')
        throw new InvalidCredentialsError();
      if (error instanceof Error && error.name === 'KeycloakUnavailableError') throw error;
      throw error instanceof Error ? error : new Error('Fallo de autenticación');
    }
    let profile: MeResponse;
    try {
      profile = await fetchProfile();
    } catch (error) {
      clearSession();
      if (error instanceof ProfileError) throw error;
      if (error instanceof ApiError && error.code === 'LOCAL_USER_INACTIVE') {
        throw new ProfileError(
          'El usuario local no está activo o no tiene organizaciones asignadas.',
          error.code,
        );
      }
      if (error instanceof ApiError) throw new ProfileError(error.message, error.code);
      throw new ProfileError(
        'No fue posible consultar el perfil en la API.',
        'PROFILE_UNAVAILABLE',
      );
    }
    if (!rolesFromProfile(profile).length) {
      clearSession();
      throw new ProfileError(
        'Tu usuario no tiene permisos sobre ninguna organización activa. Contacta al administrador.',
        'NO_ACCESS',
      );
    }
    window.sessionStorage.setItem(ME_STORAGE_KEY, JSON.stringify(profile));
    setMe(profile);
    setUser(userFromMe(profile));
    setStatus('authenticated');
  }, []);

  const logout = useCallback(() => {
    window.sessionStorage.removeItem(ME_STORAGE_KEY);
    clearLegacyStorage();
    clearSession();
    setUser(null);
    setMe(null);
    setStatus('unauthenticated');
  }, []);

  const organizationId = useMemo(() => {
    const scoped = me?.organizations.find((organization) => organization.code === role);
    return scoped?.id ?? me?.organizations[0]?.id ?? '';
  }, [me, role]);

  const hasPermission = useCallback(
    (permission: string) => {
      if (!me) return false;
      return me.organizations.some((organization) => organization.permissions.includes(permission));
    },
    [me],
  );

  const value = useMemo<RoleContextValue>(
    () => ({
      role,
      roles,
      roleLabel: roles.map((r) => ROLE_META[r].label).join(' · ') || ROLE_META[role].label,
      roleNote: roles.map((r) => ROLE_META[r].note).join(' ') || ROLE_META[role].note,
      status,
      user,
      me,
      organizationId,
      hasPermission,
      login,
      logout,
    }),
    [role, roles, status, user, me, organizationId, hasPermission, login, logout],
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
