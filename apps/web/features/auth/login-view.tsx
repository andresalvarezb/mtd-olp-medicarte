'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { InvalidCredentialsError, ProfileError, useRole } from '@/components/layout/role-context';
import { ApiError } from '@/lib/api-client';

export function LoginView() {
  const router = useRouter();
  const { login } = useRole();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void (async () => {
      setError(null);

      if (!username.trim() || !password.trim()) {
        setError('Ingresa usuario y contraseña para continuar.');
        return;
      }

      setSubmitting(true);
      try {
        await login(username.trim().toLowerCase(), password);
        router.replace('/');
      } catch (err) {
        if (err instanceof InvalidCredentialsError) setError(err.message);
        else if (err instanceof ProfileError || err instanceof ApiError) setError(err.message);
        else if (err instanceof Error) setError(err.message);
        else setError('No fue posible iniciar sesión. Intenta nuevamente.');
      } finally {
        setSubmitting(false);
      }
    })();
  };

  return (
    <div className="login">
      <div className="login-card">
        <div className="login-brand">
          <div className="brand-mark">MTD</div>
          <div>
            <h1>OLP - MEDICARTE</h1>
            <p>Plataforma de autorizaciones y dispensación de alto costo</p>
          </div>
        </div>

        <h2>Iniciar sesión</h2>
        <p className="login-hint">
          Autenticación local de la plataforma. Las opciones habilitadas dependen de los permisos de
          tu usuario.
        </p>

        <form onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor="login-username">Usuario</label>
            <input
              id="login-username"
              type="text"
              autoComplete="username"
              placeholder="usuario"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="login-password">Contraseña</label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error ? (
            <div className="login-error" role="alert">
              {error}
            </div>
          ) : null}

          <button type="submit" className="login-submit" disabled={submitting}>
            {submitting ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>

        <div className="login-foot">
          Plataforma de autorizaciones OLP — MEDICARTE. Contacta al administrador si no puedes
          ingresar.
        </div>
      </div>
    </div>
  );
}
