import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { createDatabase } from '@authorization/database';
import { DATABASE } from '../tokens';
import {
  buildTariffPreview,
  type ActiveTariffProduct,
  type TariffPreview,
  type TariffPreviewRow,
} from './tariff-annex-xlsx';

type Database = ReturnType<typeof createDatabase>;
type Transaction = Parameters<Parameters<Database['db']['transaction']>[0]>[0];

export type TariffAnnexActor = Readonly<{
  userId: string;
  organizationId: string;
  correlationId: string;
}>;

export type TariffPrepareOutcome =
  | {
      outcome: 'prepared';
      importId: string;
      preview: TariffPreview;
    }
  | {
      outcome: 'not_found';
    }
  | {
      outcome: 'invalid_status';
      status: string;
    }
  | {
      outcome: 'source_not_found';
    };

export type TariffConfirmOutcome =
  | {
      outcome: 'completed';
      importId: string;
      preview: TariffPreview;
      created: number;
      updated: number;
      unchanged: number;
      rejected: number;
    }
  | {
      outcome: 'not_found';
    }
  | {
      outcome: 'invalid_status';
      status: string;
    }
  | {
      outcome: 'override_required';
    };

type PreparedImportRow = {
  id: string;
  row_number: number;
  codigo_producto: string | null;
  result_code: string;
  product_id: string | null;
  tarifa_unidad_raw: string | null;
  tarifa_unidad_canonical: string | null;
  anomaly_code: string | null;
  raw_data: Record<string, unknown>;
  provenance: {
    phase?: string;
    action?: string;
    state?: string;
  } | null;
};

type RevisionMaxRow = {
  max_revision: number | null;
};

type AppliedProductRow = ProductRow & {
  organization_id: string;
};

type TariffImportRow = {
  id: string;
  organization_id: string;
  status: string;
  preview_anomalous: number;
  preview: TariffPreview | null;
};

type SourceFileRow = {
  content: Buffer | null;
};

type ProductRow = {
  id: string;
  codigo_producto: string;
  tarifa_unidad: string | null;
  tarifa_unidad_canonical: string | null;
  numero_expediente_invima: string | null;
  consecutivo_invima_presentacion: string | null;
  descripcion_generica: string | null;
  descripcion_comercial: string | null;
  laboratorio: string | null;
  tipo_inclusion: string | null;
  version: number;
  active: boolean;
};

@Injectable()
export class TariffAnnexRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async prepareImport(input: {
    importId: string;
    actor: TariffAnnexActor;
  }): Promise<TariffPrepareOutcome> {
    return this.database.db.transaction(async (tx) => {
      const importRow = await this.lockImport(tx, input.importId, input.actor.organizationId);

      if (!importRow) {
        return { outcome: 'not_found' };
      }

      if (importRow.status === 'PREPARED') {
        const preview = await this.loadPersistedPreview(tx, importRow.id);

        return {
          outcome: 'prepared',
          importId: importRow.id,
          preview,
        };
      }

      if (!['UPLOADED', 'VALIDATING'].includes(importRow.status)) {
        return {
          outcome: 'invalid_status',
          status: importRow.status,
        };
      }

      const source = await tx.execute<SourceFileRow>(sql`
        select content
        from tariff_annex_import_source_files
        where import_id = ${importRow.id}
        limit 1
      `);

      const sourceRow = source.rows[0];

      if (!sourceRow?.content) {
        return { outcome: 'source_not_found' };
      }

      const activeProducts = await this.findActiveProducts(tx, input.actor.organizationId);

      const preview = buildTariffPreview({
        content: sourceRow.content,
        activeProducts,
      });

      await tx.execute(sql`
        delete from tariff_annex_import_rows
        where import_id = ${importRow.id}
      `);

      for (const row of preview.rows) {
        await this.insertPreviewRow(tx, importRow.id, row);
      }

      await tx.execute(sql`
        update tariff_annex_imports
        set
          status = 'PREPARED',
          preview = ${JSON.stringify(preview)}::jsonb,
          preview_total = ${preview.total},
          preview_unchanged = ${preview.unchanged},
          preview_changed = ${preview.changed},
          preview_anomalous = ${preview.anomalous},
          preview_rejected = ${preview.rejected},
          preview_scale_pattern_detected = ${preview.scalePatternDetected},
          started_at = coalesce(started_at, now()),
          last_error_code = null
        where id = ${importRow.id}
          and organization_id = ${input.actor.organizationId}
      `);

      return {
        outcome: 'prepared',
        importId: importRow.id,
        preview,
      };
    });
  }

  async confirmImport(input: {
    importId: string;
    overrideReason?: string;
    actor: TariffAnnexActor;
  }): Promise<TariffConfirmOutcome> {
    return this.database.db.transaction(async (tx) => {
      const importRow = await this.lockImport(tx, input.importId, input.actor.organizationId);

      if (!importRow) {
        return { outcome: 'not_found' };
      }

      if (importRow.status === 'COMPLETED') {
        const preview = importRow.preview ?? (await this.loadPersistedPreview(tx, importRow.id));

        return {
          outcome: 'completed',
          importId: importRow.id,
          preview,
          created: 0,
          updated: 0,
          unchanged: 0,
          rejected: 0,
        };
      }

      if (importRow.status !== 'PREPARED') {
        return {
          outcome: 'invalid_status',
          status: importRow.status,
        };
      }

      const overrideReason = input.overrideReason?.trim() ?? '';

      if (importRow.preview_anomalous > 0 && overrideReason.length < 10) {
        return { outcome: 'override_required' };
      }

      const preview = importRow.preview ?? (await this.loadPersistedPreview(tx, importRow.id));

      await tx.execute(sql`
        update tariff_annex_imports
        set
          status = 'CONFIRMING',
          confirmed_at = now(),
          confirmed_by = ${input.actor.userId},
          override_reason = ${overrideReason || null}
        where id = ${importRow.id}
          and organization_id = ${input.actor.organizationId}
          and status = 'PREPARED'
      `);

      const prepared = await tx.execute<PreparedImportRow>(sql`
        select
          id,
          row_number,
          codigo_producto,
          result_code,
          product_id,
          tarifa_unidad_raw,
          tarifa_unidad_canonical::text as tarifa_unidad_canonical,
          anomaly_code,
          raw_data,
          provenance
        from tariff_annex_import_rows
        where import_id = ${importRow.id}
        order by row_number
      `);

      let created = 0;
      let updated = 0;
      let unchanged = 0;
      let rejected = 0;

      for (const row of prepared.rows) {
        switch (row.result_code) {
          case 'PREVIEW_REJECTED':
            rejected += 1;
            break;

          case 'PREVIEW_UNCHANGED':
            unchanged += 1;
            break;

          case 'PREVIEW_NEW':
            await this.applyNewProduct(tx, {
              importId: importRow.id,
              row,
              actor: input.actor,
            });
            created += 1;
            break;

          case 'PREVIEW_CHANGED':
          case 'PREVIEW_ANOMALOUS':
            await this.applyExistingProduct(tx, {
              importId: importRow.id,
              row,
              actor: input.actor,
            });
            updated += 1;
            break;

          default:
            throw new Error(`TARIFF_CONFIRM_UNSUPPORTED_RESULT_CODE:${row.result_code}`);
        }
      }

      await tx.execute(sql`
        update tariff_annex_imports
        set
          status = 'COMPLETED',
          total_rows = ${preview.total},
          created_rows = ${created},
          existing_rows = ${updated + unchanged},
          rejected_rows = ${rejected},
          completed_at = now(),
          last_error_code = null
        where id = ${importRow.id}
          and organization_id = ${input.actor.organizationId}
          and status = 'CONFIRMING'
      `);

      return {
        outcome: 'completed',
        importId: importRow.id,
        preview,
        created,
        updated,
        unchanged,
        rejected,
      };
    });
  }

  private async applyNewProduct(
    tx: Transaction,
    input: {
      importId: string;
      row: PreparedImportRow;
      actor: TariffAnnexActor;
    },
  ): Promise<void> {
    const snapshot = preparedSnapshot(input.row);

    if (!snapshot.codigoProducto) {
      throw new Error('TARIFF_CONFIRM_NEW_PRODUCT_WITHOUT_CODE');
    }

    const inserted = await tx.execute<AppliedProductRow>(sql`
      insert into tariff_annex_products (
        codigo_producto,
        tarifa_unidad,
        tarifa_unidad_canonical,
        numero_expediente_invima,
        consecutivo_invima_presentacion,
        descripcion_generica,
        descripcion_comercial,
        laboratorio,
        tipo_inclusion,
        active,
        organization_id,
        created_by,
        updated_by
      )
      values (
        ${snapshot.codigoProducto},
        ${snapshot.tarifaUnidadRaw},
        ${snapshot.tarifaUnidadCanonical},
        ${snapshot.numeroExpedienteInvima},
        ${snapshot.consecutivoInvimaPresentacion},
        ${snapshot.descripcionGenerica},
        ${snapshot.descripcionComercial},
        ${snapshot.laboratorio},
        ${snapshot.tipoInclusion},
        true,
        ${input.actor.organizationId},
        ${input.actor.userId},
        ${input.actor.userId}
      )
      returning
        id,
        codigo_producto,
        tarifa_unidad,
        tarifa_unidad_canonical::text as tarifa_unidad_canonical,
        numero_expediente_invima,
        consecutivo_invima_presentacion,
        descripcion_generica,
        descripcion_comercial,
        laboratorio,
        tipo_inclusion,
        version,
        active,
        organization_id
    `);

    const product = inserted.rows[0];

    if (!product) {
      throw new Error('TARIFF_CONFIRM_PRODUCT_INSERT_RETURNED_NO_ROW');
    }

    await this.insertRevision(tx, {
      product,
      revision: 1,
      importId: input.importId,
      importRowId: input.row.id,
      changedBy: input.actor.userId,
      provenance: 'CONFIRM:tariff_annex_import:new_product',
    });

    await tx.execute(sql`
      update tariff_annex_import_rows
      set product_id = ${product.id}
      where id = ${input.row.id}
        and import_id = ${input.importId}
    `);
  }

  private async applyExistingProduct(
    tx: Transaction,
    input: {
      importId: string;
      row: PreparedImportRow;
      actor: TariffAnnexActor;
    },
  ): Promise<void> {
    if (!input.row.product_id) {
      throw new Error('TARIFF_CONFIRM_CHANGED_PRODUCT_WITHOUT_PRODUCT_ID');
    }

    const currentResult = await tx.execute<AppliedProductRow>(sql`
      select
        id,
        codigo_producto,
        tarifa_unidad,
        tarifa_unidad_canonical::text as tarifa_unidad_canonical,
        numero_expediente_invima,
        consecutivo_invima_presentacion,
        descripcion_generica,
        descripcion_comercial,
        laboratorio,
        tipo_inclusion,
        version,
        active,
        organization_id
      from tariff_annex_products
      where id = ${input.row.product_id}
        and organization_id = ${input.actor.organizationId}
      for update
    `);

    const current = currentResult.rows[0];

    if (!current) {
      throw new Error('TARIFF_CONFIRM_PRODUCT_NOT_FOUND_IN_ORGANIZATION');
    }

    const revisionResult = await tx.execute<RevisionMaxRow>(sql`
      select max(revision)::int as max_revision
      from tariff_product_revisions
      where product_id = ${current.id}
    `);

    let maxRevision = revisionResult.rows[0]?.max_revision ?? 0;

    if (maxRevision === 0) {
      await this.insertRevision(tx, {
        product: current,
        revision: 1,
        importId: null,
        importRowId: null,
        changedBy: input.actor.userId,
        provenance: 'CONFIRM_BASELINE:captured_before_first_managed_update',
      });

      maxRevision = 1;
    }

    const next = preparedSnapshot(input.row);

    const updatedResult = await tx.execute<AppliedProductRow>(sql`
      update tariff_annex_products
      set
        tarifa_unidad = ${next.tarifaUnidadRaw},
        tarifa_unidad_canonical = ${next.tarifaUnidadCanonical},
        numero_expediente_invima = ${next.numeroExpedienteInvima},
        consecutivo_invima_presentacion = ${next.consecutivoInvimaPresentacion},
        descripcion_generica = ${next.descripcionGenerica},
        descripcion_comercial = ${next.descripcionComercial},
        laboratorio = ${next.laboratorio},
        tipo_inclusion = ${next.tipoInclusion},
        active = true,
        version = version + 1,
        updated_by = ${input.actor.userId},
        updated_at = now()
      where id = ${current.id}
        and organization_id = ${input.actor.organizationId}
      returning
        id,
        codigo_producto,
        tarifa_unidad,
        tarifa_unidad_canonical::text as tarifa_unidad_canonical,
        numero_expediente_invima,
        consecutivo_invima_presentacion,
        descripcion_generica,
        descripcion_comercial,
        laboratorio,
        tipo_inclusion,
        version,
        active,
        organization_id
    `);

    const updated = updatedResult.rows[0];

    if (!updated) {
      throw new Error('TARIFF_CONFIRM_PRODUCT_UPDATE_RETURNED_NO_ROW');
    }

    await this.insertRevision(tx, {
      product: updated,
      revision: maxRevision + 1,
      importId: input.importId,
      importRowId: input.row.id,
      changedBy: input.actor.userId,
      provenance: 'CONFIRM:tariff_annex_import:product_update',
    });
  }

  private async insertRevision(
    tx: Transaction,
    input: {
      product: AppliedProductRow;
      revision: number;
      importId: string | null;
      importRowId: string | null;
      changedBy: string;
      provenance: string;
    },
  ): Promise<void> {
    await tx.execute(sql`
      insert into tariff_product_revisions (
        product_id,
        codigo_producto,
        revision,
        import_id,
        import_row_id,
        tarifa_unidad_raw,
        tarifa_unidad_canonical,
        tipo_inclusion,
        commercial_snapshot,
        valid_from,
        changed_by,
        provenance
      )
      values (
        ${input.product.id},
        ${input.product.codigo_producto},
        ${input.revision},
        ${input.importId},
        ${input.importRowId},
        ${input.product.tarifa_unidad},
        ${input.product.tarifa_unidad_canonical},
        ${input.product.tipo_inclusion},
        ${JSON.stringify(productSnapshot(input.product))}::jsonb,
        now(),
        ${input.changedBy},
        ${input.provenance}
      )
    `);
  }

  private async lockImport(
    tx: Transaction,
    importId: string,
    organizationId: string,
  ): Promise<TariffImportRow | null> {
    const result = await tx.execute<TariffImportRow>(sql`
      select
        id,
        organization_id,
        status,
        preview_anomalous,
        preview
      from tariff_annex_imports
      where id = ${importId}
        and organization_id = ${organizationId}
      for update
    `);

    return result.rows[0] ?? null;
  }

  private async findActiveProducts(
    tx: Transaction,
    organizationId: string,
  ): Promise<ActiveTariffProduct[]> {
    const result = await tx.execute<ProductRow>(sql`
      select
        id,
        codigo_producto,
        tarifa_unidad,
        tarifa_unidad_canonical::text as tarifa_unidad_canonical,
        numero_expediente_invima,
        consecutivo_invima_presentacion,
        descripcion_generica,
        descripcion_comercial,
        laboratorio,
        tipo_inclusion,
        version,
        active
      from tariff_annex_products
      where organization_id = ${organizationId}
        and active = true
    `);

    return result.rows.map((row) => ({
      id: row.id,
      codigoProducto: row.codigo_producto,
      tarifaUnidadRaw: row.tarifa_unidad,
      tarifaUnidadCanonical: row.tarifa_unidad_canonical,
      numeroExpedienteInvima: row.numero_expediente_invima,
      consecutivoInvimaPresentacion: row.consecutivo_invima_presentacion,
      descripcionGenerica: row.descripcion_generica,
      descripcionComercial: row.descripcion_comercial,
      laboratorio: row.laboratorio,
      tipoInclusion: row.tipo_inclusion,
      version: row.version,
      active: row.active,
    }));
  }

  private async insertPreviewRow(
    tx: Transaction,
    importId: string,
    row: TariffPreviewRow,
  ): Promise<void> {
    const resultCode = previewResultCode(row);
    const resultMessage = previewResultMessage(row);

    await tx.execute(sql`
      insert into tariff_annex_import_rows (
        import_id,
        row_number,
        raw_data,
        codigo_producto,
        result_code,
        result_message,
        product_id,
        tarifa_unidad_raw,
        tarifa_unidad_canonical,
        anomaly_code,
        provenance
      )
      values (
        ${importId},
        ${row.rowNumber},
        ${JSON.stringify(row.rawData)}::jsonb,
        ${row.codigoProducto},
        ${resultCode},
        ${resultMessage},
        ${row.previous?.id ?? null},
        ${row.next?.tarifaUnidadRaw ?? null},
        ${row.next?.tarifaUnidadCanonical ?? null},
        ${row.anomalyCode},
        ${JSON.stringify({
          phase: 'PREPARE',
          action: row.action,
          state: row.state,
        })}::jsonb
      )
    `);
  }

  private async loadPersistedPreview(tx: Transaction, importId: string): Promise<TariffPreview> {
    const result = await tx.execute<{
      preview: TariffPreview | null;
    }>(sql`
      select preview
      from tariff_annex_imports
      where id = ${importId}
    `);

    const preview = result.rows[0]?.preview;

    if (!preview) {
      throw new Error('TARIFF_PREPARED_IMPORT_WITHOUT_PREVIEW');
    }

    return preview;
  }
}

function previewResultCode(row: TariffPreviewRow): string {
  if (row.state === 'UNCHANGED') return 'PREVIEW_UNCHANGED';
  if (row.state === 'ANOMALOUS') return 'PREVIEW_ANOMALOUS';
  if (row.state === 'REJECTED') return 'PREVIEW_REJECTED';
  if (row.action === 'NEW') return 'PREVIEW_NEW';
  return 'PREVIEW_CHANGED';
}

function previewResultMessage(row: TariffPreviewRow): string {
  switch (row.state) {
    case 'UNCHANGED':
      return 'Producto sin cambios comerciales';
    case 'CHANGED':
      return row.action === 'NEW'
        ? 'Producto nuevo para aplicar al confirmar'
        : 'Producto existente con cambios para aplicar al confirmar';
    case 'ANOMALOUS':
      return `Cambio tarifario anómalo: ${row.anomalyCode ?? 'UNKNOWN'}`;
    case 'REJECTED':
      return row.anomalyCode
        ? `Fila rechazada: ${row.anomalyCode}`
        : 'Fila rechazada durante PREPARE';
  }
}

function preparedSnapshot(row: PreparedImportRow): {
  codigoProducto: string;
  tarifaUnidadRaw: string | null;
  tarifaUnidadCanonical: string | null;
  numeroExpedienteInvima: string | null;
  consecutivoInvimaPresentacion: string | null;
  descripcionGenerica: string | null;
  descripcionComercial: string | null;
  laboratorio: string | null;
  tipoInclusion: string | null;
} {
  const raw = row.raw_data ?? {};

  return {
    codigoProducto: row.codigo_producto ?? '',
    tarifaUnidadRaw: row.tarifa_unidad_raw,
    tarifaUnidadCanonical: row.tarifa_unidad_canonical,
    numeroExpedienteInvima: rawText(raw, 'NUMERO_EXPEDIENTE_INVIMA', 'EXPEDIENTE_INVIMA'),
    consecutivoInvimaPresentacion: rawText(
      raw,
      'CONSECUTIVO_INVIMA_PRESENTACION',
      'CONSECUTIVO_PRESENTACION_INVIMA',
    ),
    descripcionGenerica:
      rawText(raw, 'DESCRIPCION_GENERICA') ?? rawText(raw, 'DESCRIPCION_GENERICA_MEDICAMENTO'),
    descripcionComercial:
      rawText(raw, 'DESCRIPCION_COMERCIAL') ?? rawText(raw, 'DESCRIPCION_COMERCIAL_MEDICAMENTO'),
    laboratorio: rawText(raw, 'LABORATORIO') ?? rawText(raw, 'LABORATORIO_MEDICAMENTO'),
    tipoInclusion: rawText(raw, 'TIPO_INCLUSION_MEDICAMENTO', 'TIPO_INCLUSION'),
  };
}

function rawText(raw: Record<string, unknown>, ...keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = raw[key];

    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'bigint' ||
      typeof value === 'boolean'
    ) {
      const text = String(value).trim();
      if (text) return text;
    }
  }

  return null;
}

function productSnapshot(product: AppliedProductRow): Record<string, unknown> {
  return {
    codigoProducto: product.codigo_producto,
    tarifaUnidadRaw: product.tarifa_unidad,
    tarifaUnidadCanonical: product.tarifa_unidad_canonical,
    numeroExpedienteInvima: product.numero_expediente_invima,
    consecutivoInvimaPresentacion: product.consecutivo_invima_presentacion,
    descripcionGenerica: product.descripcion_generica,
    descripcionComercial: product.descripcion_comercial,
    laboratorio: product.laboratorio,
    tipoInclusion: product.tipo_inclusion,
    active: product.active,
    version: product.version,
    organizationId: product.organization_id,
  };
}
