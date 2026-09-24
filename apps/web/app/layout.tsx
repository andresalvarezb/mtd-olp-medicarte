import type { Metadata } from 'next';
import { Poppins } from 'next/font/google';
import { RoleProvider } from '@/components/layout/role-context';
import { AppShell } from '@/components/layout/app-shell';
import './globals.css';

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-poppins',
});

export const metadata: Metadata = {
  title: 'Operación de alto costo | MTD',
  description:
    'Gestión operacional de autorizaciones, abastecimiento, inventario y aplicación de medicamentos.',
  icons: {
    icon: '/icon.png',
    shortcut: '/icon.png',
    apple: '/icon.png',
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className={poppins.variable}>
      <body className={poppins.className}>
        <RoleProvider>
          <AppShell>{children}</AppShell>
        </RoleProvider>
      </body>
    </html>
  );
}
