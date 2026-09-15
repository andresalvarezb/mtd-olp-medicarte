import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CancelPatientScheduleRequest,
  CreatePatientScheduleRequest,
  DispensingPointResponse,
  LateHandling,
  PatientScheduleHistoryEntry,
  PatientScheduleListQuery,
  PatientScheduleResponse,
  ReschedulePatientScheduleRequest,
  ScheduleAuthorizationOption,
  ScheduleAuthorizationSearchQuery,
  ScheduleTimingPreviewResponse,
  UpdatePatientScheduleRequest,
} from '@authorization/contracts';
import {
  PatientScheduleLateHandlingError,
  PatientScheduleTransitionError,
  assertLateHandling,
  assertPatientScheduleTransition,
  calculateAuthorizationPriority,
  classifyScheduleTiming,
  evaluateScheduleAuthorizationEligibility,
  normalizeCommercialCode,
  scheduleToday,
} from '@authorization/domain';
import {
  ClinicalAuthorizationRepository,
  type SchedulingAuthorization,
} from '../clinical/clinical-authorization.repository';
import type { Scope } from '../common/request-scope';
import {
  PatientScheduleRepository,
  isScheduleDuplicateError,
  type PatientScheduleScope,
  type PatientScheduleTransaction,
  type PlanningPeriodContext,
} from './patient-schedule.repository';

@Injectable()
export class PatientScheduleService {
  constructor(
    private readonly repository: PatientScheduleRepository,
    private readonly clinical: ClinicalAuthorizationRepository,
  ) {}

  async create(input: {
    body: CreatePatientScheduleRequest;
    actor: Scope;
  }): Promise<PatientScheduleResponse> {
    const scope = toPatientScheduleScope(input.actor);
    const item = await this.requireSchedulingAuthorization(
      input.body.authorizationItemId,
      scope,
      input.body.commercialCode,
    );
    await this.requirePeriodForDate(input.body.scheduledDate);
    const point = await this.repository.findDispensingPointById(input.body.dispensingPointId);
    if (!point) throw dispensingPointNotFound();

    // La escritura es autoritativa: el repository revalida en transacción con
    // locks y devuelve errores estructurados ante estado obsoleto.
    const outcome = await this.repository.create({
      request: toCreateInput(input.body, item.commercialCode),
      actor: input.actor,
    });
    return unwrapPersistenceOutcome(outcome);
  }

  async createInTx(
    tx: PatientScheduleTransaction,
    input: {
      body: CreatePatientScheduleRequest;
      actor: Scope;
    },
  ): Promise<PatientScheduleResponse> {
    try {
      const outcome = await this.repository.createInTx(tx, {
        request: toCreateInput(input.body, normalizeCommercialCode(input.body.commercialCode)),
        actor: input.actor,
      });
      return unwrapPersistenceOutcome(outcome);
    } catch (error) {
      if (isScheduleDuplicateError(error)) {
        throw new ConflictException({
          code: 'PATIENT_SCHEDULE_DUPLICATE',
          message: 'An active schedule already exists for the same authorization, point and date',
        });
      }
      throw error;
    }
  }

  async list(query: PatientScheduleListQuery, actor: Scope): Promise<PatientScheduleResponse[]> {
    return this.repository.list(query, toPatientScheduleScope(actor));
  }

  async findById(id: string, actor: Scope): Promise<PatientScheduleResponse> {
    const schedule = await this.repository.findById(id, toPatientScheduleScope(actor));
    if (!schedule) throw patientScheduleNotFound();
    return schedule;
  }

  async findByAuthorization(
    authorizationItemId: string,
    actor: Scope,
  ): Promise<PatientScheduleResponse[]> {
    return this.repository.findByAuthorization(authorizationItemId, toPatientScheduleScope(actor));
  }

  async findByPatient(patientDocument: string, actor: Scope): Promise<PatientScheduleResponse[]> {
    return this.repository.findByPatient(patientDocument, toPatientScheduleScope(actor));
  }

  async listByPeriod(planningPeriodId: string, actor: Scope): Promise<PatientScheduleResponse[]> {
    return this.repository.listByPeriod(planningPeriodId, toPatientScheduleScope(actor));
  }

  async listByPoint(dispensingPointId: string, actor: Scope): Promise<PatientScheduleResponse[]> {
    return this.repository.listByPoint(dispensingPointId, toPatientScheduleScope(actor));
  }

  async listHistory(id: string, actor: Scope): Promise<PatientScheduleHistoryEntry[]> {
    const schedule = await this.findById(id, actor);
    return this.repository.listHistory(schedule.id, toPatientScheduleScope(actor));
  }

  async update(input: {
    id: string;
    body: UpdatePatientScheduleRequest;
    actor: Scope;
  }): Promise<PatientScheduleResponse> {
    const current = await this.findById(input.id, input.actor);
    assertNotCancelled(current.status);
    const changesDate =
      input.body.scheduledDate !== undefined && input.body.scheduledDate !== current.scheduledDate;
    const pointId = input.body.dispensingPointId ?? current.dispensingPointId;
    if (input.body.dispensingPointId !== undefined) {
      const point = await this.repository.findDispensingPointById(pointId);
      if (!point) throw dispensingPointNotFound();
    }
    if (changesDate) {
      await this.requirePeriodForDate(input.body.scheduledDate as string);
      assertScheduleTransition(current.status, 'RESCHEDULED');
    }
    const outcome = await this.repository.applyMutation({
      id: current.id,
      expectedRevision: input.body.expectedRevision,
      changeType: changesDate ? 'RESCHEDULED' : 'UPDATED',
      requested: {
        ...(input.body.scheduledDate === undefined
          ? {}
          : { scheduledDate: input.body.scheduledDate }),
        ...(input.body.dispensingPointId === undefined
          ? {}
          : { dispensingPointId: input.body.dispensingPointId }),
        ...(input.body.quantity === undefined ? {} : { quantity: input.body.quantity }),
        ...(input.body.lateHandling === undefined
          ? {}
          : { requestedHandling: input.body.lateHandling }),
      },
      actor: input.actor,
    });
    return unwrapPersistenceOutcome(outcome);
  }

  async reschedule(input: {
    id: string;
    body: ReschedulePatientScheduleRequest;
    actor: Scope;
  }): Promise<PatientScheduleResponse> {
    const current = await this.findById(input.id, input.actor);
    assertNotCancelled(current.status);
    assertScheduleTransition(current.status, 'RESCHEDULED');
    await this.requirePeriodForDate(input.body.scheduledDate);
    if (input.body.dispensingPointId !== undefined) {
      const point = await this.repository.findDispensingPointById(input.body.dispensingPointId);
      if (!point) throw dispensingPointNotFound();
    }
    const outcome = await this.repository.applyMutation({
      id: current.id,
      expectedRevision: input.body.expectedRevision,
      changeType: 'RESCHEDULED',
      requested: {
        scheduledDate: input.body.scheduledDate,
        ...(input.body.dispensingPointId === undefined
          ? {}
          : { dispensingPointId: input.body.dispensingPointId }),
        ...(input.body.lateHandling === undefined
          ? {}
          : { requestedHandling: input.body.lateHandling }),
      },
      actor: input.actor,
    });
    return unwrapPersistenceOutcome(outcome);
  }

  async cancel(input: {
    id: string;
    body: CancelPatientScheduleRequest;
    actor: Scope;
  }): Promise<PatientScheduleResponse> {
    const current = await this.findById(input.id, input.actor);
    assertNotCancelled(current.status);
    assertScheduleTransition(current.status, 'CANCELLED');
    const outcome = await this.repository.applyMutation({
      id: current.id,
      expectedRevision: input.body.expectedRevision,
      changeType: 'CANCELLED',
      actor: input.actor,
    });
    return unwrapPersistenceOutcome(outcome);
  }

  async searchAuthorizations(
    query: ScheduleAuthorizationSearchQuery,
    actor: Scope,
  ): Promise<ScheduleAuthorizationOption[]> {
    const scope = toSchedulingSearchScope(actor);
    const items = await this.clinical.searchForScheduling({
      ...scope,
      ...(query.authorization === undefined ? {} : { authorization: query.authorization }),
      ...(query.patientDocument === undefined ? {} : { patientDocument: query.patientDocument }),
      ...(query.commercialCode === undefined ? {} : { commercialCode: query.commercialCode }),
      limit: query.limit,
    });
    return items.map(toScheduleAuthorizationOption);
  }

  async timingPreview(scheduledDate: string, actor: Scope): Promise<ScheduleTimingPreviewResponse> {
    void actor;
    const period = await this.requirePeriodForDate(scheduledDate);
    const scheduleTiming = classifyScheduleTiming(period, new Date());
    const nextPeriod =
      scheduleTiming === 'LATE' ? await this.repository.findNextPeriod(period.endDate) : null;
    return {
      planningPeriodId: period.id,
      planningPeriodStartDate: period.startDate,
      planningPeriodEndDate: period.endDate,
      schedulingCutoffAt: period.schedulingCutoffAt,
      scheduleTiming,
      lateHandlingRequired: scheduleTiming === 'LATE',
      nextPlanningPeriodId: nextPeriod?.id ?? null,
    };
  }

  async listDispensingPoints(): Promise<DispensingPointResponse[]> {
    return this.repository.listDispensingPoints();
  }

  private resolveLateHandling(
    timing: 'ON_TIME' | 'LATE',
    requested: LateHandling | null,
  ): LateHandling | null {
    try {
      assertLateHandling(timing, requested);
    } catch (error) {
      if (error instanceof PatientScheduleLateHandlingError) {
        throw new BadRequestException({
          code: error.code,
          message: error.message,
          fields: { lateHandling: [error.message] },
        });
      }
      throw error;
    }
    return timing === 'LATE' ? requested : null;
  }

  private async resolveDeferredPeriod(
    period: PlanningPeriodContext,
    lateHandling: LateHandling | null,
  ): Promise<string | null> {
    if (lateHandling !== 'NEXT_PERIOD') return null;
    const next = await this.repository.findNextPeriod(period.endDate);
    if (!next) {
      throw new ConflictException({
        code: 'PATIENT_SCHEDULE_NEXT_PERIOD_NOT_FOUND',
        message: 'There is no next planning period to defer the schedule to',
      });
    }
    return next.id;
  }

  private async requireSchedulingAuthorization(
    id: string,
    scope: PatientScheduleScope,
    commercialCode: string,
  ): Promise<SchedulingAuthorization> {
    const item = await this.clinical.findForSchedulingById(id, {
      organizationId: scope.organizationId,
      bypassOrganizationScope: scope.bypassOrganizationScope,
    });
    if (!item) throw authorizationNotFound();
    if (item.commercialCode !== normalizeCommercialCode(commercialCode)) {
      throw new BadRequestException({
        code: 'PATIENT_SCHEDULE_AUTHORIZATION_CODE_MISMATCH',
        message: 'The commercial code does not belong to the authorization item',
        fields: { commercialCode: ['The code does not match the authorization item'] },
      });
    }
    const eligibility = evaluateScheduleAuthorizationEligibility({
      enablementStatus: item.enablementStatus,
      coverageType: item.coverageType,
      directionStatus: item.directionStatus,
      expirationDate: item.authorizationExpiresOn,
      todayBogota: scheduleToday(),
    });
    if (!eligibility.eligible) {
      throw new ConflictException({
        code: eligibility.code ?? 'PATIENT_SCHEDULE_AUTHORIZATION_NOT_SCHEDULABLE',
        message: eligibility.message ?? 'The authorization is not schedulable',
      });
    }
    return item;
  }

  private async requirePeriodForDate(scheduledDate: string): Promise<PlanningPeriodContext> {
    const period = await this.repository.findPeriodForDate(scheduledDate);
    if (!period) {
      throw new BadRequestException({
        code: 'PATIENT_SCHEDULE_PERIOD_NOT_FOUND',
        message: 'There is no planning period covering the scheduled date',
        fields: { scheduledDate: ['No planning period covers the scheduled date'] },
      });
    }
    return period;
  }
}

function toCreateInput(
  body: CreatePatientScheduleRequest,
  commercialCode: string,
): {
  authorizationItemId: string;
  commercialCode: string;
  dispensingPointId: string;
  scheduledDate: string;
  quantity: number;
  requestedLateHandling: LateHandling | null;
} {
  return {
    authorizationItemId: body.authorizationItemId,
    commercialCode,
    dispensingPointId: body.dispensingPointId,
    scheduledDate: body.scheduledDate,
    quantity: body.quantity,
    requestedLateHandling: body.lateHandling ?? null,
  };
}

export function toPatientScheduleScope(actor: Scope): PatientScheduleScope {
  return {
    organizationId: actor.organizationId,
    bypassOrganizationScope: actor.organizationCode === 'MTD' || actor.isFoundationAdmin,
  };
}

export function toSchedulingSearchScope(actor: Scope) {
  return {
    organizationId: actor.organizationId,
    bypassOrganizationScope: actor.organizationCode === 'MTD' || actor.isFoundationAdmin,
  };
}

export function toScheduleAuthorizationOption(
  item: SchedulingAuthorization,
): ScheduleAuthorizationOption {
  const authorizationExpiresOn = item.authorizationExpiresOn;
  const { daysUntilExpiration, priorityLevel } = calculateAuthorizationPriority(
    authorizationExpiresOn,
    scheduleToday(),
  );
  const eligibility = evaluateScheduleAuthorizationEligibility({
    enablementStatus: item.enablementStatus,
    coverageType: item.coverageType,
    directionStatus: item.directionStatus,
    expirationDate: authorizationExpiresOn,
    todayBogota: scheduleToday(),
  });
  return {
    authorizationItemId: item.id,
    authorizationNumber: item.authorizationNumber,
    authorizationKey: item.authorizationKey,
    commercialCode: item.commercialCode,
    authorizedQuantity: item.authorizedQuantity,
    patientDocument: item.patientDocument,
    patientName: item.patientName,
    coverageType: item.coverageType,
    directionStatus: item.directionStatus,
    enablementStatus: item.enablementStatus,
    authorizationExpiresOn,
    daysUntilExpiration,
    priorityLevel,
    canSchedule: eligibility.eligible,
    blockingCode: eligibility.code,
  };
}

function unwrapPersistenceOutcome(
  outcome: Awaited<ReturnType<PatientScheduleRepository['applyMutation']>>,
): PatientScheduleResponse {
  switch (outcome.outcome) {
    case 'created':
    case 'updated':
    case 'unchanged':
      return outcome.schedule;
    case 'not_found':
      throw patientScheduleNotFound();
    case 'version_conflict':
      throw new ConflictException({
        code: 'VERSION_CONFLICT',
        message: 'The patient schedule changed during the operation',
        fields: { currentVersion: [String(outcome.current.revision)] },
      });
    case 'authorization_not_found':
      throw authorizationNotFound();
    case 'commercial_code_mismatch':
      throw commercialCodeMismatch();
    case 'authorization_conflict':
      throw new ConflictException({ code: outcome.code, message: outcome.message });
    case 'period_not_found':
      throw periodNotFound();
    case 'duplicate_schedule':
      throw new ConflictException({
        code: 'PATIENT_SCHEDULE_DUPLICATE',
        message: 'An active schedule already exists for the same authorization, point and date',
      });
    case 'late_handling_required':
      throw lateHandlingRequired(outcome.timing);
    case 'invalid_late_handling':
      throw lateHandlingInvalid(outcome.timing);
    case 'next_period_not_found':
      throw nextPeriodNotFound();
  }
}

function assertNotCancelled(status: string): void {
  if (status === 'CANCELLED') {
    throw new ConflictException({
      code: 'PATIENT_SCHEDULE_INVALID_TRANSITION',
      message: 'A cancelled patient schedule cannot be modified',
    });
  }
}

export function assertScheduleTransition(from: string, to: string): void {
  try {
    assertPatientScheduleTransition(from as never, to as never);
  } catch (error) {
    if (error instanceof PatientScheduleTransitionError) {
      throw new ConflictException({ code: error.code, message: error.message });
    }
    throw error;
  }
}

function patientScheduleNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'PATIENT_SCHEDULE_NOT_FOUND',
    message: 'Patient schedule not found',
  });
}

function authorizationNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'PATIENT_SCHEDULE_AUTHORIZATION_NOT_FOUND',
    message: 'Authorization item not found or out of scope',
  });
}

function commercialCodeMismatch(): BadRequestException {
  return new BadRequestException({
    code: 'PATIENT_SCHEDULE_AUTHORIZATION_CODE_MISMATCH',
    message: 'The commercial code does not belong to the authorization item',
    fields: { commercialCode: ['The code does not match the authorization item'] },
  });
}

function periodNotFound(): BadRequestException {
  return new BadRequestException({
    code: 'PATIENT_SCHEDULE_PERIOD_NOT_FOUND',
    message: 'There is no planning period covering the scheduled date',
    fields: { scheduledDate: ['No planning period covers the scheduled date'] },
  });
}

function lateHandlingRequired(timing: string): BadRequestException {
  return new BadRequestException({
    code: 'PATIENT_SCHEDULE_LATE_HANDLING_REQUIRED',
    message: `A ${timing} schedule requires an explicit late handling decision`,
    fields: { lateHandling: ['Late handling is required for LATE schedules'] },
  });
}

function lateHandlingInvalid(timing: string): BadRequestException {
  return new BadRequestException({
    code: 'PATIENT_SCHEDULE_LATE_HANDLING_REQUIRED',
    message: `Late handling is not allowed for a ${timing} schedule`,
    fields: { lateHandling: ['Late handling is only allowed for LATE schedules'] },
  });
}

function nextPeriodNotFound(): ConflictException {
  return new ConflictException({
    code: 'PATIENT_SCHEDULE_NEXT_PERIOD_NOT_FOUND',
    message: 'There is no next planning period to defer the schedule to',
  });
}

function dispensingPointNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'PATIENT_SCHEDULE_DISPENSING_POINT_NOT_FOUND',
    message: 'Dispensing point not found',
  });
}
