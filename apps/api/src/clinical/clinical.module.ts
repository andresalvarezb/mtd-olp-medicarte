import { DynamicModule, Module } from '@nestjs/common';
import type { createDatabase } from '@authorization/database';
import { DATABASE } from '../tokens';
import {
  ClinicalAuthorizationRepository,
  LegacyAuthorizationHistoryRepository,
} from './clinical-authorization.repository';

type Database = ReturnType<typeof createDatabase>;

@Module({
  providers: [ClinicalAuthorizationRepository, LegacyAuthorizationHistoryRepository],
  exports: [ClinicalAuthorizationRepository, LegacyAuthorizationHistoryRepository],
})
export class ClinicalModule {
  static register(database: Database): DynamicModule {
    return {
      module: ClinicalModule,
      providers: [{ provide: DATABASE, useValue: database }],
      exports: [ClinicalAuthorizationRepository, LegacyAuthorizationHistoryRepository],
    };
  }
}
