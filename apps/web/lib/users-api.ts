import { apiRequest } from './api-client';
import type {
  CreateUserRequest,
  ResetUserPasswordRequest,
  UpdateUserRequest,
  UserResponse,
} from '@authorization/contracts';

export type { UserResponse };

export function listUsers(
  organizationId: string,
  signal?: AbortSignal,
): Promise<{ items: UserResponse[] }> {
  return apiRequest<{ items: UserResponse[] }>('/users', { organizationId, signal });
}

export function createUser(organizationId: string, body: CreateUserRequest): Promise<UserResponse> {
  return apiRequest<UserResponse>('/users', {
    method: 'POST',
    organizationId,
    body: JSON.stringify(body),
  });
}

export function updateUser(
  organizationId: string,
  userId: string,
  body: UpdateUserRequest,
): Promise<UserResponse> {
  return apiRequest<UserResponse>(`/users/${userId}`, {
    method: 'PATCH',
    organizationId,
    body: JSON.stringify(body),
  });
}

export function resetUserPassword(
  organizationId: string,
  userId: string,
  body: ResetUserPasswordRequest,
): Promise<UserResponse> {
  return apiRequest<UserResponse>(`/users/${userId}/reset-password`, {
    method: 'POST',
    organizationId,
    body: JSON.stringify(body),
  });
}

export function addAssignment(
  organizationId: string,
  userId: string,
  body: { organizationId: string; roleCode: string },
): Promise<UserResponse> {
  return apiRequest<UserResponse>(`/users/${userId}/assignments`, {
    method: 'PUT',
    organizationId,
    body: JSON.stringify(body),
  });
}

export function revokeAssignment(
  organizationId: string,
  userId: string,
  targetOrganizationId: string,
): Promise<UserResponse> {
  return apiRequest<UserResponse>(`/users/${userId}/assignments/${targetOrganizationId}`, {
    method: 'DELETE',
    organizationId,
  });
}

export function changeOwnPassword(body: {
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  return apiRequest<void>('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
