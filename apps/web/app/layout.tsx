import type { Metadata } from 'next';
import { RoleProvider } from '@/components/layout/role-context';
import { AppShell } from '@/components/layout/app-shell';
import './globals.css';

export const metadata: Metadata = {
  title: 'Plataforma MTD - OLP - Medicarte',
  description: 'Base para planificación, abastecimiento, inventario y aplicación de medicamentos.',
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
