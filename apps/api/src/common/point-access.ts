import { ForbiddenException } from '@nestjs/common';
import { POINT_ACCESS_DENIED, PointAccessDeniedError } from '@authorization/domain';

export function pointAccessDeniedException(): ForbiddenException {
  return new ForbiddenException({
    code: POINT_ACCESS_DENIED,
    message: 'The dispensing point is outside the actor data scope',
  });
}

export function throwIfPointAccessDenied(error: unknown): void {
  if (error instanceof PointAccessDeniedError) {
    throw pointAccessDeniedException();
  }
}
