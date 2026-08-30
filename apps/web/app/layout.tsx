import type { Metadata } from 'next';
import { RoleProvider } from '@/components/layout/role-context';
import { AppShell } from '@/components/layout/app-shell';
import './globals.css';

export const metadata: Metadata = {
  title: 'Plataforma de Autorizaciones y Dispensación',
  description: 'Plataforma de autorizaciones y dispensación de alto costo — OLP / MEDICARTE',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>
        <RoleProvider>
          <AppShell>{children}</AppShell>
        </RoleProvider>
      </body>
    </html>
  );
}
