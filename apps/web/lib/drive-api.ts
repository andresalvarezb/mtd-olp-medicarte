import { apiRequest } from './api-client';

export function getDriveUrl(organizationId: string): Promise<{ url: string | null }> {
  return apiRequest<{ url: string | null }>('/settings/drive', { organizationId });
}

export function updateDriveUrl(organizationId: string, url: string): Promise<{ url: string }> {
  return apiRequest<{ url: string }>('/settings/drive', {
    method: 'PUT',
    organizationId,
    body: JSON.stringify({ url }),
  });
}
