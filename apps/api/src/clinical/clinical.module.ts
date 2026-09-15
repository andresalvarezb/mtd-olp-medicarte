import { DynamicModule, Module } from '@nestjs/common';
import type { createDatabase } from '@authorization/database';
import { DATABASE } from '../tokens';
import { ClinicalAuthorizationRepository } from './clinical-authorization.repository';

type Database = ReturnType<typeof createDatabase>;

@Module({
  providers: [ClinicalAuthorizationRepository],
  exports: [ClinicalAuthorizationRepository],
})
export class ClinicalModule {
  static register(database: Database): DynamicModule {
    return {
      module: ClinicalModule,
      providers: [{ provide: DATABASE, useValue: database }],
      exports: [ClinicalAuthorizationRepository],
    };
  }
}
