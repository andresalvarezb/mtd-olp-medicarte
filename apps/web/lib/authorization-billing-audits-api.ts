import type {
  AuthorizationBillingAuditDecisionRequest,
  AuthorizationBillingAuditResponse,
} from '@authorization/contracts';

import {
  apiRequest,
} from './api-client';


export type {
  AuthorizationBillingAuditDecisionRequest,
  AuthorizationBillingAuditResponse,
};


export function getAuthorizationBillingAudit(
  organizationId:
    string,
  authorizationItemId:
    string,
) {
  return apiRequest<AuthorizationBillingAuditResponse>(
    `/authorization-billing-audits/authorization/${authorizationItemId}`,
    {
      organizationId,
    },
  );
}


export function startAuthorizationBillingAudit(
  organizationId:
    string,
  authorizationItemId:
    string,
) {
  return apiRequest<AuthorizationBillingAuditResponse>(
    `/authorization-billing-audits/authorization/${authorizationItemId}/start`,
    {
      method:
        'POST',

      organizationId,

      body:
        JSON.stringify(
          {},
        ),
    },
  );
}


export function decideAuthorizationBillingAudit(
  organizationId:
    string,
  auditId:
    string,
  body:
    AuthorizationBillingAuditDecisionRequest,
) {
  return apiRequest<AuthorizationBillingAuditResponse>(
    `/authorization-billing-audits/${auditId}/decision`,
    {
      method:
        'POST',

      organizationId,

      body:
        JSON.stringify(
          body,
        ),
    },
  );
}


export function searchAuthorizationBillingAuditDriveEvidence(
  organizationId:
    string,
  auditId:
    string,
) {
  return apiRequest<AuthorizationBillingAuditResponse>(
    `/authorization-billing-audits/${auditId}/evidence/drive/search`,
    {
      method:
        'POST',

      organizationId,

      body:
        JSON.stringify(
          {},
        ),
    },
  );
}

export function getAuthorizationBillingAuditEvidenceContent(
  organizationId:
    string,
  auditId:
    string,
  evidenceId:
    string,
) {
  return apiRequest<Blob>(
    `/authorization-billing-audits/${auditId}/evidence/${evidenceId}/content`,
    {
      organizationId,
    },
  );
}
