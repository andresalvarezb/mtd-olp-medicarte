import { randomUUID } from 'node:crypto';
import {
  ForbiddenException,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Scope } from '../common/request-scope';
import { pointAccessKindFor } from '../common/request-scope';
import { AccessService } from '../identity/access.service';
import { InventoryAvailabilityRepository } from './inventory-availability.repository';
import {
  automaticReconciliationActorSchema,
  automaticReconciliationErrorCode,
  automaticReconciliationOptionsSchema,
  parseAutomaticReconciliationSchedule,
  type AutomaticReconciliationActor,
  type AutomaticReconciliationInput,
  type AutomaticReconciliationProductResult,
} from './inventory-availability-reconciliation.contract';

type Item = Readonly<{ commercialCode: string }> & (
  AutomaticReconciliationProductResult |
  Readonly<{ status: 'FAILED'; errorCode: string }>
);

const RETRYABLE = new Set(['40001', '40P01', '55P03']);

@Injectable()
export class InventoryAvailabilityReconciliationService
implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(InventoryAvailabilityReconciliationService.name);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private cursor: string | undefined;
  private schedule: ReturnType<typeof parseAutomaticReconciliationSchedule>;

  constructor(
    private readonly repository: InventoryAvailabilityRepository,
    private readonly access: AccessService,
  ) {}

  private async resolveScope(actor: AutomaticReconciliationActor): Promise<Scope> {
    // Authoritative, live permissions. No fabricated or automatically selected administrator.
    const profile = await this.access.requirePermission(
      actor.userId, actor.organizationId, 'inventory.allocate',
    );
    const organization = profile.organizations.find((item) => item.id === actor.organizationId);
    if (
      organization?.code !== 'MTD' ||
      organization.isSystemAdmin !== true ||
      !organization.roles.includes('MTD_ADMIN')
    ) {
      throw new ForbiddenException({ code: 'AUTO_RECONCILIATION_MTD_ADMIN_REQUIRED' });
    }
    return {
      userId: profile.id,
      organizationId: organization.id,
      organizationCode: organization.code,
      correlationId: actor.correlationId,
      readSensitive: false,
      isFoundationAdmin: true,
      canCrossOrganizationOperationalExport: false,
      pointAccessKind: pointAccessKindFor(organization.code, organization.roles),
    };
  }

  async runPage(actorInput: AutomaticReconciliationActor, input: AutomaticReconciliationInput = {}) {
    const actor = automaticReconciliationActorSchema.parse(actorInput);
    const options = automaticReconciliationOptionsSchema.parse(input);
    await this.resolveScope(actor);
    const startedAt = new Date().toISOString();
    const page = await this.repository.listAutomaticReconciliationProducts(options);
    const items: Item[] = [];

    for (const commercialCode of page.commercialCodes) {
      let finished = false;
      for (let attempt = 0; attempt < 3 && !finished; attempt += 1) {
        // Recheck authorization on every product and retry, before opening its transaction.
        // An access failure stops the page; it is not treated as a stock error.
        const scope = await this.resolveScope(actor);
        try {
          const result = await this.repository.reconcileAutomaticProduct(scope, commercialCode, options);
          items.push({ commercialCode, ...result });
          finished = true;
        } catch (error) {
          const errorCode = automaticReconciliationErrorCode(error);
          if (RETRYABLE.has(errorCode) && attempt < 2) {
            await new Promise<void>((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
            continue;
          }
          items.push({ commercialCode, status: 'FAILED', errorCode });
          finished = true;
        }
      }
    }

    const failed = items.filter((item) => item.status === 'FAILED').length;
    const busy = items.filter((item) => item.status === 'BUSY').length;
    const assignedQuantity = items.reduce(
      (total, item) => total + ('result' in item ? item.result.assignedQuantity : 0), 0,
    );
    const plannedQuantity = items.reduce(
      (total, item) => total + ('result' in item ? item.result.plannedQuantity ?? 0 : 0), 0,
    );
    const summary = {
      status: failed > 0 ? 'PARTIAL_FAILURE' : busy > 0 ? 'BUSY' : 'COMPLETED',
      dryRun: options.dryRun,
      correlationId: actor.correlationId,
      startedAt,
      completedAt: new Date().toISOString(),
      scanned: items.length,
      failed,
      busy,
      assignedQuantity,
      plannedQuantity,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
    this.logger.log(JSON.stringify({ event: 'AUTO_AVAILABILITY_RECONCILIATION_PAGE', ...summary }));
    return { ...summary, items };
  }

  onApplicationBootstrap(): void {
    try {
      this.schedule = parseAutomaticReconciliationSchedule(process.env);
    } catch {
      // Invalid settings disable this reconciler, not the entire API.
      this.logger.error(JSON.stringify({ event: 'AUTO_AVAILABILITY_RECONCILER_INVALID_CONFIG' }));
      return;
    }
    if (!this.schedule) return;
    this.logger.log(JSON.stringify({
      event: 'AUTO_AVAILABILITY_RECONCILER_ENABLED',
      dryRun: this.schedule.dryRun,
      intervalMs: this.schedule.intervalMs,
      batchSize: this.schedule.limit,
    }));
    this.scheduleNext(5_000);
  }

  private scheduleNext(delay: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => { void this.tick(); }, delay);
    this.timer.unref();
  }

  private async tick(): Promise<void> {
    const settings = this.schedule;
    if (this.stopped || !settings) return;
    let delay = settings.intervalMs;
    try {
      const result = await this.runPage({
        userId: settings.userId,
        organizationId: settings.organizationId,
        correlationId: randomUUID(),
      }, {
        dryRun: settings.dryRun,
        limit: settings.limit,
        ...(this.cursor ? { cursor: this.cursor } : {}),
      });
      this.cursor = result.hasMore && result.nextCursor ? result.nextCursor : undefined;
      if (result.hasMore) delay = 1_000;
      // Failed/busy products are not marked "fixed". They are retried on the next sweep.
    } catch (error) {
      this.cursor = undefined;
      this.logger.error(JSON.stringify({
        event: 'AUTO_AVAILABILITY_RECONCILIATION_FAILED',
        errorCode: automaticReconciliationErrorCode(error),
      }));
    } finally {
      this.scheduleNext(delay);
    }
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }
}
