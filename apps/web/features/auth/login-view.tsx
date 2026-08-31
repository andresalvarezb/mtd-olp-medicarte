'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { InvalidCredentialsError, ProfileError, useRole } from '@/components/layout/role-context';
import { ApiError } from '@/lib/api-client';

export function LoginView() {
  const router = useRouter();
  const { login } = useRole();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void (async () => {
      setError(null);

      if (!email.trim() || !password.trim()) {
        setError('Ingresa usuario y contraseña para continuar.');
        return;
      }

      setSubmitting(true);
      try {
        await login(email.trim(), password);
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
          Autenticación contra Keycloak (realm <code>authorization</code>). Las opciones habilitadas
          dependen de los permisos de tu usuario.
        </p>

        <form onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor="login-email">Usuario o correo electrónico</label>
            <input
              id="login-email"
              type="text"
              autoComplete="username"
              placeholder="usuario@organizacion.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
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
          Prototipo — no procesa información real ni contiene datos de pacientes.
        </div>
      </div>
    </div>
  );
}
