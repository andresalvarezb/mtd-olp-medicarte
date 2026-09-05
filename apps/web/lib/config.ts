import type { Role } from '@/components/navigation/nav-config';

const API_VERSION_PATH = '/api/v1';

/**
 * Normaliza la URL base de la API aceptando tanto el hostname raíz
 * (p. ej. RENDER_EXTERNAL_URL de Render) como una URL que ya incluye /api/v1.
 */
export function normalizeApiBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  return trimmed.endsWith(API_VERSION_PATH) ? trimmed : `${trimmed}${API_VERSION_PATH}`;
}

export const API_BASE_URL = normalizeApiBaseUrl(
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001',
);

export const IMPORT_MAX_FILE_BYTES = 20 * 1024 * 1024;

/** UUIDs sembrados por packages/database/migrations/0000_foundation.sql */
export const ORGANIZATION_IDS: Record<Role, string> = {
  MTD: '10000000-0000-4000-8000-000000000001',
  MTD_GENERAL: '10000000-0000-4000-8000-000000000001',
  MTD_AUDITORIA: '10000000-0000-4000-8000-000000000001',
  COMPENSAR: '10000000-0000-4000-8000-000000000002',
  OLP: '10000000-0000-4000-8000-000000000003',
  MEDICARTE: '10000000-0000-4000-8000-000000000004',
  READ_ONLY: '10000000-0000-4000-8000-000000000001',
};
