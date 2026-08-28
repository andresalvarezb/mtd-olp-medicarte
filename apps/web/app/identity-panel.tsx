'use client';

import { useEffect, useState } from 'react';
import Keycloak from 'keycloak-js';
import { meResponseSchema, type MeResponse } from '@authorization/contracts';
import { Button } from '@authorization/ui';

const oidcUrl = process.env.NEXT_PUBLIC_OIDC_URL;
const realm = process.env.NEXT_PUBLIC_OIDC_REALM;
const clientId = process.env.NEXT_PUBLIC_OIDC_CLIENT_ID;
const apiUrl = process.env.NEXT_PUBLIC_API_URL;

export function IdentityPanel() {
  const [keycloak, setKeycloak] = useState<Keycloak>();
  const [profile, setProfile] = useState<MeResponse>();
  const [status, setStatus] = useState('Preparando inicio de sesión seguro…');

  useEffect(() => {
    if (!oidcUrl || !realm || !clientId || !apiUrl) {
      setStatus('La configuración pública de OIDC/API está incompleta.');
      return;
    }
    const client = new Keycloak({ url: oidcUrl, realm, clientId });
    setKeycloak(client);
    void client
      .init({ onLoad: 'check-sso', pkceMethod: 'S256', checkLoginIframe: false })
      .then(async (authenticated) => {
        if (!authenticated || !client.token) {
          setStatus('Identidad no autenticada');
          return;
        }
        const response = await fetch(`${apiUrl}/api/v1/me`, {
          headers: { authorization: `Bearer ${client.token}` },
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('No fue posible cargar el alcance local');
        setProfile(meResponseSchema.parse(await response.json()));
        setStatus('Sesión verificada por OIDC y autorización local');
      })
      .catch(() => setStatus('No fue posible verificar la identidad'));
  }, []);

  return (
    <section className="identity" aria-live="polite">
      <span className="status-dot" />
      <p className="status">{status}</p>
      {profile ? (
        <>
          <h2>{profile.displayName}</h2>
          <p>{profile.email}</p>
          <div className="scope-list">
            {profile.organizations.map((organization) => (
              <article key={organization.id}>
                <strong>{organization.name}</strong>
                <span>{organization.roles.join(' · ')}</span>
              </article>
            ))}
          </div>
          <Button className="secondary" onClick={() => void keycloak?.logout({ redirectUri: window.location.origin })}>
            Cerrar sesión
          </Button>
        </>
      ) : (
        <Button className="primary" disabled={!keycloak} onClick={() => void keycloak?.login()}>
          Ingresar con identidad corporativa
        </Button>
      )}
    </section>
  );
}
