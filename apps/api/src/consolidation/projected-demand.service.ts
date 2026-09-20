import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DemandConsolidationError } from '@authorization/domain';
import type {
  ConsolidateProjectedDemandResponse,
  ProjectedDemandCoverageProjectionResponse,
  ProjectedDemandListQuery,
  ProjectedDemandLineResponse,
  ProjectedDemandSourceResponse,
} from '@authorization/contracts';
import type { Scope } from '../common/request-scope';
import { ProjectedDemandRepository } from './projected-demand.repository';

@Injectable()
export class ProjectedDemandService {
  constructor(private readonly repository: ProjectedDemandRepository) {}

  /**
   * consolidatePeriod(periodId): el repository ejecuta la consolidación con
   * locks + reconciliación + verificación de invariantes + auditoría en una
   * única transacción. La fuente es el cargue de autorizaciones habilitadas.
   */
  async consolidate(periodId: string, actor: Scope): Promise<ConsolidateProjectedDemandResponse> {
    let outcome;
    try {
      outcome = await this.repository.consolidate({
        periodId,
        actor: this.toActor(actor),
      });
    } catch (error) {
      throw translateConsolidationError(error);
    }
    if (outcome.outcome === 'period_not_found') throw periodNotFound();
    return outcome.summary;
  }

  list(query: ProjectedDemandListQuery, actor: Scope): Promise<ProjectedDemandLineResponse[]> {
    void actor;
    return this.repository.list(query);
  }

  async findById(id: string): Promise<ProjectedDemandLineResponse> {
    const line = await this.repository.findById(id);
    if (!line) throw lineNotFound();
    return line;
  }

  async listSources(lineId: string): Promise<ProjectedDemandSourceResponse[]> {
    const line = await this.findById(lineId);
    return this.repository.listSources(line);
  }

  async coverageProjection(lineId: string): Promise<ProjectedDemandCoverageProjectionResponse> {
    const line = await this.findById(lineId);

    if (line.dispensingPointId !== null) {
      throw new ConflictException({
        code: 'PROJECTED_DEMAND_COVERAGE_PROJECTION_LEGACY_NOT_SUPPORTED',
        message: 'Coverage projection is available only for modern fungible authorization demand',
      });
    }

    return this.repository.coverageProjection(line);
  }

  private toActor(actor: Scope): DemandConsolidationActorLike {
    return {
      userId: actor.userId,
      organizationId: actor.organizationId,
      correlationId: actor.correlationId,
    };
  }
}

type DemandConsolidationActorLike = {
  userId: string;
  organizationId: string;
  correlationId: string;
};

function periodNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'PROJECTED_DEMAND_PERIOD_NOT_FOUND',
    message: 'Planning period not found',
  });
}

function lineNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'PROJECTED_DEMAND_LINE_NOT_FOUND',
    message: 'Projected demand line not found',
  });
}

function translateConsolidationError(error: unknown): Error {
  if (error instanceof ConflictException || error instanceof NotFoundException) return error;
  if (error instanceof DemandConsolidationError) {
    return new ConflictException({
      code: error.code,
      message: error.message,
      fields: { authorizationItemId: [error.patientScheduleId] },
    });
  }
  return error instanceof Error ? error : new Error('Unknown consolidation error');
}
