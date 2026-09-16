import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { ApiConfig } from '@authorization/config';
import { API_CONFIG } from '../tokens';
import { ReconciliationOperationsService } from './reconciliation-operations.service';

@Injectable()
export class ReconciliationSchedulerWorker implements OnModuleInit, OnApplicationShutdown {
  private timer: NodeJS.Timeout | undefined = undefined;
  private running = false;

  constructor(
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    private readonly operations: ReconciliationOperationsService,
  ) {}

  onModuleInit(): void {
    if (this.config.RECONCILIATION_SCHEDULER_ENABLED) {
      this.timer = setInterval(
        () => void this.tick(),
        this.config.RECONCILIATION_SCHEDULER_TICK_MS,
      );
      void this.tick();
    }
  }

  async tick(): Promise<void> {
    if (!this.config.RECONCILIATION_SCHEDULER_ENABLED) {
      return;
    }
    if (this.running) return;
    this.running = true;
    try {
      await this.operations.tickScheduler(
        this.config.RECONCILIATION_OPERATION_LEASE_SECONDS,
        this.config.RECONCILIATION_MAX_ATTEMPTS,
      );
    } catch {
      // Handled inside tickScheduler
    } finally {
      this.running = false;
    }
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
