import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreatePlanningPeriodRequest,
  PlanningPeriodListQuery,
  PlanningPeriodResponse,
  PlanningPeriodStatus,
  UpdatePlanningPeriodRequest,
} from '@authorization/contracts';
import {
  validatePlanningPeriodDates,
  type PlanningPeriodValidationIssue,
} from '@authorization/domain';
import {
  PlanningPeriodRepository,
  type PlanningPeriodActor,
  type PlanningPeriodChanges,
} from './planning-period.repository';

const VALIDATION_MESSAGES: Record<string, string> = {
  PLANNING_PERIOD_INVALID_RANGE: 'start_date must be less than or equal to end_date',
  PLANNING_PERIOD_INVALID_DEADLINE_ORDER:
    'scheduling_cutoff_at must be less than or equal to purchase_order_deadline_at',
  PLANNING_PERIOD_DELIVERY_BEFORE_DEADLINE:
    'purchase_order_deadline_at must not be after expected_delivery_date',
};

const CHECK_CONSTRAINT_CODES: Record<string, string> = {
  planning_periods_date_range_check: 'PLANNING_PERIOD_INVALID_RANGE',
  planning_periods_deadline_order_check: 'PLANNING_PERIOD_INVALID_DEADLINE_ORDER',
  planning_periods_delivery_after_purchase_check: 'PLANNING_PERIOD_DELIVERY_BEFORE_DEADLINE',
};

@Injectable()
export class PlanningPeriodService {
  constructor(private readonly repository: PlanningPeriodRepository) {}

  async create(input: {
    body: CreatePlanningPeriodRequest;
    actor: PlanningPeriodActor;
  }): Promise<PlanningPeriodResponse> {
    const issues = validatePlanningPeriodDates(input.body);
    if (issues.length > 0) throw validationException(issues);
    try {
      return await this.repository.create({ values: input.body, actor: input.actor });
    } catch (error) {
      throw translatePersistenceError(error);
    }
  }

  list(query: PlanningPeriodListQuery): Promise<PlanningPeriodResponse[]> {
    return this.repository.list({
      ...(query.status === undefined ? {} : { status: query.status }),
      limit: query.limit,
    });
  }

  async findById(id: string): Promise<PlanningPeriodResponse> {
    const period = await this.repository.findById(id);
    if (!period) throw planningPeriodNotFound();
    return period;
  }

  async update(input: {
    id: string;
    body: UpdatePlanningPeriodRequest;
    actor: PlanningPeriodActor;
  }): Promise<PlanningPeriodResponse> {
    const changes: PlanningPeriodChanges = {
      ...(input.body.startDate === undefined ? {} : { startDate: input.body.startDate }),
      ...(input.body.endDate === undefined ? {} : { endDate: input.body.endDate }),
      ...(input.body.schedulingCutoffAt === undefined
        ? {}
        : { schedulingCutoffAt: input.body.schedulingCutoffAt }),
      ...(input.body.purchaseOrderDeadlineAt === undefined
        ? {}
        : { purchaseOrderDeadlineAt: input.body.purchaseOrderDeadlineAt }),
      ...(input.body.expectedDeliveryDate === undefined
        ? {}
        : { expectedDeliveryDate: input.body.expectedDeliveryDate }),
    };
    try {
      const outcome = await this.repository.update({
        id: input.id,
        expectedVersion: input.body.expectedVersion,
        changes,
        actor: input.actor,
      });
      switch (outcome.outcome) {
        case 'updated':
          return outcome.period;
        case 'not_found':
          throw planningPeriodNotFound();
        case 'version_conflict':
          throw versionConflict(outcome.current.version);
        case 'frozen':
          throw new ConflictException({
            code: 'PLANNING_PERIOD_STRUCTURAL_FROZEN',
            message: `Planning period date fields are frozen: ${outcome.fields.join(', ')}`,
            fields: { frozenFields: outcome.fields },
          });
        case 'invalid_dates':
          throw validationException(outcome.issues);
      }
    } catch (error) {
      throw translatePersistenceError(error);
    }
  }

  async transition(input: {
    id: string;
    to: PlanningPeriodStatus;
    expectedVersion: number;
    actor: PlanningPeriodActor;
  }): Promise<PlanningPeriodResponse> {
    try {
      const outcome = await this.repository.transition(input);
      switch (outcome.outcome) {
        case 'transitioned':
          return outcome.period;
        case 'not_found':
          throw planningPeriodNotFound();
        case 'version_conflict':
          throw versionConflict(outcome.current.version);
        case 'invalid_transition':
          throw new ConflictException({
            code: 'PLANNING_PERIOD_INVALID_TRANSITION',
            message: `Transition ${outcome.from} -> ${outcome.to} is not allowed`,
          });
      }
    } catch (error) {
      throw translatePersistenceError(error);
    }
  }
}

function planningPeriodNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'PLANNING_PERIOD_NOT_FOUND',
    message: 'Planning period not found',
  });
}

function versionConflict(currentVersion: number): ConflictException {
  return new ConflictException({
    code: 'VERSION_CONFLICT',
    message: 'The planning period changed during the operation',
    fields: { currentVersion: [String(currentVersion)] },
  });
}

function validationException(
  issues: readonly PlanningPeriodValidationIssue[],
): BadRequestException {
  const first = issues[0];
  return new BadRequestException({
    code: first?.code ?? 'PLANNING_PERIOD_INVALID',
    message: first?.message ?? 'Invalid planning period dates',
    fields: Object.fromEntries(issues.map((issue) => [issue.field, [issue.message]])),
  });
}

type PostgresErrorShape = { code: string; constraint?: string; message?: string };

/**
 * Drizzle 0.44 envuelve los errores del driver en `DrizzleQueryError`, por lo
 * que la causa PostgreSQL real vive en la cadena `cause`.
 */
function findPostgresError(error: unknown): PostgresErrorShape | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== 'object' || current === null) return null;
    const candidate = current as {
      code?: unknown;
      constraint?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (typeof candidate.code === 'string') {
      const result: PostgresErrorShape = { code: candidate.code };
      if (typeof candidate.constraint === 'string') result.constraint = candidate.constraint;
      if (typeof candidate.message === 'string') result.message = candidate.message;
      return result;
    }
    current = candidate.cause;
  }
  return null;
}

function translatePersistenceError(error: unknown): Error {
  if (error instanceof BadRequestException || error instanceof ConflictException) return error;
  if (error instanceof NotFoundException) return error;
  const pg = findPostgresError(error);
  if (!pg) return error instanceof Error ? error : new Error('Unknown planning period error');

  if (pg.code === '23P01' || pg.constraint === 'planning_periods_no_overlap') {
    return new ConflictException({
      code: 'PLANNING_PERIOD_OVERLAP',
      message: 'The planning period overlaps an existing period',
    });
  }
  const checkCode = pg.constraint ? CHECK_CONSTRAINT_CODES[pg.constraint] : undefined;
  if (checkCode) {
    return new BadRequestException({
      code: checkCode,
      message: VALIDATION_MESSAGES[checkCode] ?? 'Invalid planning period dates',
    });
  }
  if (pg.code === 'P0001' && (pg.message ?? '').includes('frozen')) {
    return new ConflictException({
      code: 'PLANNING_PERIOD_STRUCTURAL_FROZEN',
      message: 'Planning period range dates are frozen after planning',
    });
  }
  return error instanceof Error ? error : new Error('Unknown planning period error');
}
