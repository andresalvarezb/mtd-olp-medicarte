import type { Metadata } from 'next';
import './styles.css';

export const metadata: Metadata = {
  title: 'Authorization Platform',
  description: 'Secure authorization operations platform',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
