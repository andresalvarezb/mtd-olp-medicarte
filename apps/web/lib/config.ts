import type { Role } from '@/components/navigation/nav-config';

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

export const OIDC_ISSUER =
  process.env.NEXT_PUBLIC_OIDC_ISSUER ?? 'http://localhost:8080/realms/authorization';

export const OIDC_CLIENT_ID = process.env.NEXT_PUBLIC_OIDC_CLIENT_ID ?? 'authorization-web';

export const IMPORT_MAX_FILE_BYTES = 20 * 1024 * 1024;

/** UUIDs sembrados por packages/database/migrations/0000_foundation.sql */
export const ORGANIZATION_IDS: Record<Role, string> = {
  MTD: '10000000-0000-4000-8000-000000000001',
  COMPENSAR: '10000000-0000-4000-8000-000000000002',
  OLP: '10000000-0000-4000-8000-000000000003',
  MEDICARTE: '10000000-0000-4000-8000-000000000004',
};
