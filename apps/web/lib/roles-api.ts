import { apiRequest } from './api-client';
import type {
  CreateRoleRequest,
  RoleAccessResponse,
  RoleSummary,
  RolesResponse,
  UpdateRoleRequest,
  UpdateRoleAccessRequest,
} from '@authorization/contracts';

export type {
  CreateRoleRequest,
  RoleAccessResponse,
  RoleSummary,
  RolesResponse,
  UpdateRoleRequest,
  UpdateRoleAccessRequest,
};

export function listRoles(organizationId: string, signal?: AbortSignal): Promise<RolesResponse> {
  return apiRequest<RolesResponse>('/roles', { organizationId, signal });
}

export function getRoleAccess(
  organizationId: string,
  roleCode: string,
  signal?: AbortSignal,
): Promise<RoleAccessResponse> {
  return apiRequest<RoleAccessResponse>(`/roles/${encodeURIComponent(roleCode)}/access`, {
    organizationId,
    signal,
  });
}

export function updateRoleAccess(
  organizationId: string,
  roleCode: string,
  body: UpdateRoleAccessRequest,
): Promise<RoleAccessResponse> {
  return apiRequest<RoleAccessResponse>(`/roles/${encodeURIComponent(roleCode)}/access`, {
    method: 'PUT',
    organizationId,
    body: JSON.stringify(body),
  });
}

export function createRole(organizationId: string, body: CreateRoleRequest): Promise<RoleSummary> {
  return apiRequest<RoleSummary>('/roles', {
    method: 'POST',
    organizationId,
    body: JSON.stringify(body),
  });
}

export function updateRole(
  organizationId: string,
  roleCode: string,
  body: UpdateRoleRequest,
): Promise<RoleSummary> {
  return apiRequest<RoleSummary>(`/roles/${encodeURIComponent(roleCode)}`, {
    method: 'PATCH',
    organizationId,
    body: JSON.stringify(body),
  });
}

export function deleteRole(organizationId: string, roleCode: string): Promise<{ deleted: true }> {
  return apiRequest<{ deleted: true }>(`/roles/${encodeURIComponent(roleCode)}`, {
    method: 'DELETE',
    organizationId,
  });
}
