'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ROLES, ROLE_META, type Role } from '@/components/navigation/nav-config';
import { useRole } from '@/components/layout/role-context';

export function LoginView() {
  const router = useRouter();
  const { login } = useRole();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [selectedRole, setSelectedRole] = useState<Role>('MTD');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!email.trim() || !password.trim()) {
      setError('Ingresa correo y contraseña para continuar.');
      return;
    }

    setSubmitting(true);
    login(selectedRole, email.trim());
    router.replace('/');
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
          Prototipo visual: las credenciales no se validan contra un proveedor de identidad.
        </p>

        <form onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor="login-email">Correo electrónico</label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
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

          <div className="field">
            <label htmlFor="login-role">Vista de demostración</label>
            <select
              id="login-role"
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value as Role)}
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_META[role].selectLabel}
                </option>
              ))}
            </select>
            <p className="field-note">{ROLE_META[selectedRole].note}</p>
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
