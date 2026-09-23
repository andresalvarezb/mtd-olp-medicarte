import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type {
  FulfillAuthorizationRequest,
} from '@authorization/contracts';

import {
  AuthorizationFulfillmentError,
} from '@authorization/domain';

import type {
  Scope,
} from '../common/request-scope';

import {
  throwIfPointAccessDenied,
} from '../common/point-access';

import {
  AuthorizationFulfillmentRepository,
} from './authorization-fulfillment.repository';

@Injectable()
export class AuthorizationFulfillmentService {
  constructor(
    private readonly repository:
      AuthorizationFulfillmentRepository,
  ) {}

  async fulfill(
    authorizationItemId: string,
    body: FulfillAuthorizationRequest,
    scope: Scope,
    source: 'UI' | 'XLSX' = 'UI',
  ) {
    if (
      scope.organizationCode !==
      'MEDICARTE'
    ) {
      throw new ForbiddenException({
        code:
          'AUTHORIZATION_FULFILLMENT_MEDICARTE_ONLY',

        message:
          'Solo Medicarte puede registrar la entrega o aplicación del producto.',
      });
    }

    try {
      const result =
        await this.repository.fulfill(
          authorizationItemId,
          body,
          scope,
          source,
        );

      if (
        'outcome' in result &&
        result.outcome ===
          'not_found'
      ) {
        throw new NotFoundException({
          code:
            'AUTHORIZATION_NOT_FOUND',

          message:
            'La autorización no existe o no está disponible para la organización.',
        });
      }

      return result;
    } catch (error) {
      throwIfPointAccessDenied(
        error,
      );

      if (
        error instanceof
          NotFoundException ||
        error instanceof
          ForbiddenException
      ) {
        throw error;
      }

      if (
        error instanceof
        AuthorizationFulfillmentError
      ) {
        throw new BadRequestException({
          code:
            error.code,

          message:
            error.message,
        });
      }

      const code =
        error instanceof Error
          ? error.message
          : 'AUTHORIZATION_FULFILLMENT_INVALID';

      if (
        [
          'AUTHORIZATION_FULFILLMENT_ALREADY_CLOSED',
          'AUTHORIZATION_FULFILLMENT_ALREADY_APPLIED',
          'AUTHORIZATION_FULFILLMENT_INSUFFICIENT_INVENTORY',
        ].includes(code)
      ) {
        throw new ConflictException({
          code,

          message:
            code ===
            'AUTHORIZATION_FULFILLMENT_INSUFFICIENT_INVENTORY'
              ? 'No existe inventario físico suficiente para completar la operación.'
              : 'La autorización ya cuenta con un cierre operativo.',
        });
      }

      if (
        code.startsWith(
          'AUTHORIZATION_FULFILLMENT_',
        )
      ) {
        throw new BadRequestException({
          code,

          message:
            error instanceof Error
              ? error.message
              : code,
        });
      }

      throw error;
    }
  }
}
