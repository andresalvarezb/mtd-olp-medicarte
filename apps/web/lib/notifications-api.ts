import { apiRequest } from './api-client';
import type { NotificationResponse, NotificationType } from '@authorization/contracts';

export type { NotificationType };
export type NotificationStatus = 'PENDIENTE' | 'ENVIADO' | 'FALLIDO' | 'OMITIDO';

export interface NotificationRecipient {
  id: string;
  notificationType: NotificationType;
  organizationId: string;
  email: string;
  active: boolean;
  createdAt: string;
}

export interface NotificationsPage {
  items: NotificationResponse[];
  nextCursor: string | null;
}

export function listNotifications(
  organizationId: string,
  query: { status?: NotificationStatus; notificationType?: NotificationType; limit?: number } = {},
  signal?: AbortSignal,
): Promise<NotificationsPage> {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  if (query.notificationType) params.set('notificationType', query.notificationType);
  params.set('limit', String(query.limit ?? 50));
  return apiRequest<NotificationsPage>(`/admin/notifications?${params.toString()}`, { organizationId, signal });
}

export function retryNotification(organizationId: string, id: string): Promise<{ notificationId: string; status: string }> {
  return apiRequest<{ notificationId: string; status: string }>(`/admin/notifications/${id}/retry`, {
    method: 'POST',
    organizationId,
    idempotencyKey: crypto.randomUUID(),
    body: '{}',
  });
}

export function listNotificationRecipients(
  organizationId: string,
  notificationType?: NotificationType,
  signal?: AbortSignal,
): Promise<NotificationRecipient[]> {
  const qs = notificationType ? `?notificationType=${notificationType}` : '';
  return apiRequest<NotificationRecipient[]>(`/admin/notification-recipients${qs}`, { organizationId, signal });
}

export function createNotificationRecipient(
  organizationId: string,
  body: { notificationType: NotificationType; organizationId: string; email: string },
): Promise<{ id: string; status: string }> {
  return apiRequest<{ id: string; status: string }>('/admin/notification-recipients', {
    method: 'POST',
    organizationId,
    body: JSON.stringify(body),
  });
}

export function deleteNotificationRecipient(organizationId: string, id: string): Promise<{ id: string; status: string }> {
  return apiRequest<{ id: string; status: string }>(`/admin/notification-recipients/${id}`, {
    method: 'DELETE',
    organizationId,
  });
}

export interface DeadLetterJob {
  id: string;
  eventType: string;
  attempts: number;
  lastError: string | null;
}

export function listDeadLetterJobs(organizationId: string, signal?: AbortSignal): Promise<DeadLetterJob[]> {
  return apiRequest<DeadLetterJob[]>('/admin/dead-letter-jobs', { organizationId, signal });
}
