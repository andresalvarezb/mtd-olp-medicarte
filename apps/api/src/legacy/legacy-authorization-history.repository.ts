import { Inject, Injectable } from '@nestjs/common';
import type { LegacyAuthorizationHistory } from '@authorization/domain';
import type { createDatabase } from '@authorization/database';
import { DATABASE } from '../tokens';

type Database = ReturnType<typeof createDatabase>;

type LegacyAuthorizationHistoryRow = {
  id: string;
  numero_autorizacion: string;
  codigo_medicamento: string;
  lugar_dispensacion: string | null;
  fecha_programada: string | null;
  fecha_dispensacion: string | null;
  fecha_aplicacion: string | null;
  cod_autorizacion_medicarte: string | null;
  orden_compra: string | null;
  process_status: string | null;
  operation_status: string | null;
  operational_version: number;
  updated_at: Date;
};

/**
 * ESP-016 historical adapter. Read-only compatibility for pre-cutover
 * authorization_items operational columns. Does not create modern lineage.
 */
@Injectable()
export class LegacyAuthorizationHistoryRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async findById(id: string): Promise<LegacyAuthorizationHistory | null> {
    const result = await this.database.pool.query<LegacyAuthorizationHistoryRow>(
      `select id, numero_autorizacion, codigo_medicamento,
              lugar_dispensacion, to_char(fecha_programada, 'YYYY-MM-DD') as fecha_programada,
              to_char(fecha_dispensacion, 'YYYY-MM-DD') as fecha_dispensacion,
              to_char(fecha_aplicacion, 'YYYY-MM-DD') as fecha_aplicacion,
              cod_autorizacion_medicarte, orden_compra, process_status,
              operation_status, operational_version, updated_at
         from authorization_items
        where id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      numeroAutorizacion: row.numero_autorizacion,
      commercialCode: row.codigo_medicamento,
      lugarDispensacion: row.lugar_dispensacion,
      fechaProgramada: row.fecha_programada,
      fechaDispensacion: row.fecha_dispensacion,
      fechaAplicacion: row.fecha_aplicacion,
      codAutorizacionMedicarte: row.cod_autorizacion_medicarte,
      ordenCompra: row.orden_compra,
      processStatus: row.process_status,
      operationStatus: row.operation_status,
      operationalVersion: row.operational_version,
      updatedAt: row.updated_at,
    };
  }
}
