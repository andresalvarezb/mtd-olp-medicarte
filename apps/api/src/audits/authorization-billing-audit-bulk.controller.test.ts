import 'reflect-metadata';
import type { Server } from 'node:http';

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  ForbiddenException,
  type ExecutionContext,
  type INestApplication,
} from '@nestjs/common';

import { Test } from '@nestjs/testing';
import request from 'supertest';

import type { Scope } from '../common/request-scope';
import { AuthGuard } from '../common/auth.guard';
import { AccessService } from '../identity/access.service';

import { AuthorizationBillingAuditBulkController } from './authorization-billing-audit-bulk.controller';
import { AuthorizationBillingAuditBulkService } from './authorization-billing-audit-bulk.service';

const organizationId = '00000000-0000-4000-8000-000000000011';
const otherOrganizationId = '00000000-0000-4000-8000-000000000012';
const userId = '00000000-0000-4000-8000-000000000013';
const correlationId = '00000000-0000-4000-8000-000000000014';
const jobId = '00000000-0000-4000-8000-000000000015';

describe('ESP-AUD-BULK-001 HTTP permissions', () => {
  let app: INestApplication;
  let organizationCode = 'MTD';
  let allowedPermissions = new Set<string>();

  const realTemplate = new AuthorizationBillingAuditBulkService(
    {} as ConstructorParameters<typeof AuthorizationBillingAuditBulkService>[0],
  );

  const bulk = {
    template: vi.fn((scope: Scope) => realTemplate.template(scope)),
    upload: vi.fn(() => Promise.resolve({ id: jobId, status: 'READY' })),
    getJob: vi.fn(() => Promise.resolve({ id: jobId, status: 'READY' })),
    confirm: vi.fn(() => Promise.resolve({ id: jobId, status: 'COMPLETED' })),
    resultWorkbook: vi.fn(() => Promise.resolve(Buffer.from('resultado'))),
  };

  const access = {
    requirePermission: vi.fn(
      (_user: string, requestedOrg: string, permission: string) => {
        if (
          requestedOrg !== organizationId ||
          !allowedPermissions.has(permission)
        ) {
          throw new ForbiddenException({
            code: 'PERMISSION_DENIED',
            message: 'Permission denied for organization',
          });
        }

        return Promise.resolve({
          id: userId,
          organizations: [{
            id: organizationId,
            code: organizationCode,
            name: organizationCode,
            roles: ['MTD_OPERATOR'],
            permissions: [...allowedPermissions],
            isSystemAdmin: false,
          }],
        });
      },
    ),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthorizationBillingAuditBulkController],
      providers: [
        { provide: AuthorizationBillingAuditBulkService, useValue: bulk },
        { provide: AccessService, useValue: access },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          const req = context.switchToHttp().getRequest<{
            auth: { sub: string; username: string };
            correlationId: string;
          }>();

          req.auth = {
            sub: userId,
            username: 'audit-test',
          };

          req.correlationId = correlationId;

          return true;
        },
      })
      .compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(() => {
    organizationCode = 'MTD';
    allowedPermissions = new Set([
      'application_audits.read',
      'application_audits.manage',
    ]);
    vi.clearAllMocks();
  });

  const path = '/authorization-billing-audits/bulk';

  it('permite descargar plantilla con permiso read', async () => {
    allowedPermissions = new Set(['application_audits.read']);

    await request(app.getHttpServer() as Server)
      .get(`${path}/template.xlsx`)
      .set('x-organization-id', organizationId)
      .expect(200);

    expect(access.requirePermission).toHaveBeenCalledWith(
      userId,
      organizationId,
      'application_audits.read',
    );
  });

  it('rechaza carga masiva sin permiso manage', async () => {
    allowedPermissions = new Set(['application_audits.read']);

    await request(app.getHttpServer() as Server)
      .post(`${path}/jobs`)
      .set('x-organization-id', organizationId)
      .expect(403);

    expect(bulk.upload).not.toHaveBeenCalled();
  });

  it('rechaza confirmación sin permiso manage', async () => {
    allowedPermissions = new Set(['application_audits.read']);

    await request(app.getHttpServer() as Server)
      .post(`${path}/jobs/${jobId}/confirm`)
      .set('x-organization-id', organizationId)
      .expect(403);

    expect(bulk.confirm).not.toHaveBeenCalled();
  });

  it('permite consultar lote con permiso read', async () => {
    allowedPermissions = new Set(['application_audits.read']);

    await request(app.getHttpServer() as Server)
      .get(`${path}/jobs/${jobId}`)
      .set('x-organization-id', organizationId)
      .expect(200);

    expect(access.requirePermission).toHaveBeenCalledWith(
      userId,
      organizationId,
      'application_audits.read',
    );
  });

  it('permite descargar resultado con permiso read', async () => {
    allowedPermissions = new Set(['application_audits.read']);

    await request(app.getHttpServer() as Server)
      .get(`${path}/jobs/${jobId}/result.xlsx`)
      .set('x-organization-id', organizationId)
      .expect(200);

    expect(bulk.resultWorkbook).toHaveBeenCalled();
  });

  it('rechaza organización no autorizada', async () => {
    await request(app.getHttpServer() as Server)
      .get(`${path}/jobs/${jobId}`)
      .set('x-organization-id', otherOrganizationId)
      .expect(403);

    expect(bulk.getJob).not.toHaveBeenCalled();
  });

  it('rechaza organización distinta de MTD', async () => {
    organizationCode = 'OLP';

    await request(app.getHttpServer() as Server)
      .get(`${path}/template.xlsx`)
      .set('x-organization-id', organizationId)
      .expect(403);

    expect(bulk.template).toHaveBeenCalled();
  });

  it('permite confirmar con permiso manage', async () => {
    await request(app.getHttpServer() as Server)
      .post(`${path}/jobs/${jobId}/confirm`)
      .set('x-organization-id', organizationId)
      .expect(200);

    expect(access.requirePermission).toHaveBeenCalledWith(
      userId,
      organizationId,
      'application_audits.manage',
    );

    expect(bulk.confirm).toHaveBeenCalled();
  });
});
