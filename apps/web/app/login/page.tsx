import type { Metadata } from 'next';
import { LoginView } from '@/features/auth/login-view';

export const metadata: Metadata = {
  title: 'Iniciar sesión — Plataforma de Autorizaciones y Dispensación',
};

export default function LoginPage() {
  return <LoginView />;
}
