import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type {
  FulfillmentAuditListQuery,
} from '@authorization/contracts';

import type { Scope } from '../common/request-scope';
import { AuthorizationFulfillmentAuditRepository } from './authorization-fulfillment-audit.repository';

@Injectable()
export class AuthorizationFulfillmentAuditService {
  constructor(
    private readonly repository: AuthorizationFulfillmentAuditRepository,
  ) {}

  private assertMtd(scope: Scope) {
    if (scope.organizationCode !== 'MTD') {
      throw new ForbiddenException({
        code: 'FULFILLMENT_AUDIT_MTD_ONLY',
        message: 'Solo MTD puede auditar entregas o aplicaciones.',
      });
    }
  }

  list(query: FulfillmentAuditListQuery, scope: Scope) {
    this.assertMtd(scope);
    return this.repository.list(query, scope);
  }

  async detail(id: string, scope: Scope) {
    this.assertMtd(scope);

    const result = await this.repository.findByAuditId(id);

    if (!result) {
      throw this.notFound();
    }

    return result;
  }

  async start(fulfillmentId: string, scope: Scope) {
    this.assertMtd(scope);
    const result = await this.run(
      () => this.repository.start(fulfillmentId, scope),
    );

    return result && typeof result === 'object' && 'outcome' in result
      ? (result as { audit: unknown }).audit
      : result;
  }

  async approve(id: string, scope: Scope) {
    this.assertMtd(scope);
    const result = await this.run(
      () => this.repository.approve(id, scope),
    );

    return result && typeof result === 'object' && 'outcome' in result
      ? (result as { audit: unknown }).audit
      : result;
  }

  async reject(
    id: string,
    observation: string,
    scope: Scope,
  ) {
    this.assertMtd(scope);
    const result = await this.run(
      () => this.repository.reject(id, observation, scope),
    );

    return result && typeof result === 'object' && 'outcome' in result
      ? (result as { audit: unknown }).audit
      : result;
  }

  private async run<T>(action: () => Promise<T>): Promise<T> {
    try {
      const result = await action();

      if (result && typeof result === 'object' && 'outcome' in result) {
        const outcome = result as {
          outcome: string;
          auditId?: string;
        };

        if (outcome.outcome === 'not_found') {
          throw this.notFound();
        }

        if (outcome.outcome === 'already_exists') {
          throw new ConflictException({
            code: 'FULFILLMENT_AUDIT_ALREADY_EXISTS',
            message: 'El fulfillment ya tiene una auditoría.',
            fields: outcome.auditId
              ? { auditId: [outcome.auditId] }
              : undefined,
          });
        }
      }

      return result;
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof ForbiddenException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }

      const code =
        error instanceof Error
          ? error.message
          : 'FULFILLMENT_AUDIT_INVALID';

      if (
        [
          'FULFILLMENT_AUDIT_TERMINAL',
          'FULFILLMENT_AUDIT_CONCURRENT_DECISION',
        ].includes(code)
      ) {
        throw new ConflictException({
          code,
          message: code,
        });
      }

      throw new BadRequestException({
        code,
        message: code,
      });
    }
  }

  private notFound() {
    return new NotFoundException({
      code: 'FULFILLMENT_AUDIT_NOT_FOUND',
      message: 'No se encontró la auditoría o el fulfillment.',
    });
  }
}
