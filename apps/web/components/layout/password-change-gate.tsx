'use client';

import { useState } from 'react';
import { useRole } from '@/components/layout/role-context';
import { changeOwnPassword } from '@/lib/users-api';
import { usePathname, useRouter } from 'next/navigation';

/**
 * ADR-026: cuando la API marca must_change_password (alta administrativa o
 * bootstrap), la app queda bloqueada hasta que el usuario defina su propia
 * contraseña mediante POST /auth/change-password.
 */
export function PasswordChangeGate() {
  const { mustChangePassword, logout, markPasswordChanged } = useRole();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  if (!mustChangePassword || pathname === '/login') {
    return null;
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (newPassword.length < 12) {
      setError('La nueva contraseña debe tener al menos 12 caracteres.');
      return;
    }
    setBusy(true);
    setError(null);
    void changeOwnPassword({ currentPassword, newPassword })
      .then(() => {
        markPasswordChanged();
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'No fue posible cambiar la contraseña.'),
      )
      .finally(() => setBusy(false));
  };

  const handleExit = () => {
    logout();
    router.replace('/login');
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Cambio de contraseña obligatorio"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.62)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
        padding: 16,
      }}
    >
      <div
        className="login-card"
        style={{ position: 'static', width: 'min(420px, 100%)', margin: 0 }}
      >
        <h2>Cambio de contraseña obligatorio</h2>
        <p className="login-hint">
          Un administrador restableció tu contraseña. Define una nueva para continuar.
        </p>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="gate-current">Contraseña actual</label>
            <input
              id="gate-current"
              className="control"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="gate-new">Nueva contraseña (mínimo 12 caracteres)</label>
            <input
              id="gate-new"
              className="control"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </div>
          {error ? (
            <div className="login-error" role="alert">
              {error}
            </div>
          ) : null}
          <button type="submit" className="login-submit" disabled={busy}>
            {busy ? 'Guardando…' : 'Cambiar contraseña'}
          </button>
        </form>
        <button
          type="button"
          className="btn"
          style={{ marginTop: 10, width: '100%' }}
          onClick={handleExit}
        >
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}
