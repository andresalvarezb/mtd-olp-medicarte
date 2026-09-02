'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ROLES, ROLE_META, type Role } from '@/components/navigation/nav-config';
import {
  InvalidCredentialsError,
  SESSION_EXPIRED_EVENT,
  authenticate,
  clearSession,
  getSession,
} from '@/lib/auth';
import { ApiError, apiRequest } from '@/lib/api-client';
import type { MeResponse } from '@authorization/contracts';

export { InvalidCredentialsError };

export class ProfileError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ProfileError';
  }
}

const ME_STORAGE_KEY = 'authz-api-me';

function storeMe(profile: MeResponse | null): void {
  if (typeof window === 'undefined') return;
  if (profile) window.sessionStorage.setItem(ME_STORAGE_KEY, JSON.stringify(profile));
  else window.sessionStorage.removeItem(ME_STORAGE_KEY);
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
  const result = new Set<Role>();
  for (const organization of me.organizations) {
    for (const role of organization.roles) {
      if (role === 'MTD_ADMIN' || role === 'MTD_OPERATOR') result.add('MTD');
      if (role === 'MTD_GENERAL') result.add('MTD_GENERAL');
      if (role === 'MTD_AUDITORIA') result.add('MTD_AUDITORIA');
    }
    if (organization.code === 'COMPENSAR') result.add('COMPENSAR');
    if (organization.code === 'OLP') result.add('OLP');
    if (organization.code === 'MEDICARTE') result.add('MEDICARTE');
  }
  return ROLES.filter((candidate) => result.has(candidate));
}

function initialsForName(name: string, fallback: string): string {
  const source = name.trim() || fallback;
  const parts = source.split(/[.\-_+ ]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]!.charAt(0) + parts[1]!.charAt(0)).toUpperCase();
  return source.slice(0, 2).toUpperCase() || 'UD';
}

export type AuthStatus = 'loading' | 'unauthenticated' | 'authenticated';

export interface SessionUser {
  username: string;
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
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  /** La API manda cambiar la contraseña (reset administrativo o bootstrap). */
  mustChangePassword: boolean;
  /** Baja el flag tras un cambio de contraseña exitoso. */
  markPasswordChanged: () => void;
}

const RoleContext = createContext<RoleContextValue | null>(null);

/** Limpia claves del antiguo modo demostración (prototipo). */
function clearLegacyStorage(): void {
  window.localStorage.removeItem('authz-demo-role');
  window.localStorage.removeItem('authz-demo-session');
  window.sessionStorage.removeItem('authz-api-me');
}

function userFromMe(me: MeResponse): SessionUser {
  return {
    username: me.username,
    name: me.displayName?.trim() || me.username,
    initials: initialsForName(me.displayName ?? '', me.username),
  };
}

export function RoleProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);

  const resetSession = useCallback(() => {
    storeMe(null);
    clearSession();
    setUser(null);
    setMe(null);
    setMustChangePassword(false);
    setStatus('unauthenticated');
  }, []);

  useEffect(() => {
    clearLegacyStorage();
    // ADR-026: la sesión sobrevive al recargado, pero el perfil se REVALIDA
    // contra /me: si el usuario fue deshabilitado o eliminado, el efecto es
    // inmediato.
    if (!getSession()) {
      setStatus('unauthenticated');
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const profile = await fetchProfile();
        if (cancelled) return;
        storeMe(profile);
        setMe(profile);
        setUser(userFromMe(profile));
        setMustChangePassword(profile.mustChangePassword);
        setStatus('authenticated');
      } catch {
        if (cancelled) return;
        resetSession();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resetSession]);

  useEffect(() => {
    const onExpired = (): void => resetSession();
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [resetSession]);

  const roles = useMemo(() => rolesFromProfile(me), [me]);
  const role = roles[0] ?? 'MTD';

  const login = useCallback(async (username: string, password: string): Promise<void> => {
    await authenticate(username, password);
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
    storeMe(profile);
    setMe(profile);
    setUser(userFromMe(profile));
    setMustChangePassword(profile.mustChangePassword);
    setStatus('authenticated');
  }, []);

  const logout = useCallback((): void => {
    resetSession();
    if (typeof window !== 'undefined') clearLegacyStorage();
  }, [resetSession]);

  /** Tras un cambio de contraseña exitoso baja el flag de cambio obligatorio. */
  const markPasswordChanged = useCallback((): void => {
    setMustChangePassword(false);
    setMe((current) => {
      if (!current) return current;
      const updated = { ...current, mustChangePassword: false };
      storeMe(updated);
      return updated;
    });
  }, []);

  const organizationId = useMemo(() => {
    const scoped =
      me?.organizations.find((organization) =>
        organization.roles.some((candidate) =>
          role === 'MTD' ? ['MTD_ADMIN', 'MTD_OPERATOR'].includes(candidate) : candidate === role,
        ),
      ) ?? me?.organizations.find((organization) => organization.code === role);
    return scoped?.id ?? me?.organizations[0]?.id ?? '';
  }, [me, role]);

  const hasPermission = useCallback(
    (permission: string) => {
      if (!me) return false;
      const active = me.organizations.find((organization) => organization.id === organizationId);
      return active?.permissions.includes(permission) ?? false;
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
      mustChangePassword,
      markPasswordChanged,
    }),
    [
      role,
      roles,
      status,
      user,
      me,
      organizationId,
      hasPermission,
      login,
      logout,
      mustChangePassword,
      markPasswordChanged,
    ],
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
