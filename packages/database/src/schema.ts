import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  name: varchar('name', { length: 160 }).notNull(),
  driveUrl: varchar('drive_url', { length: 2048 }),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * DEPRECATED (ADR-026): subject del realm Keycloak ya eliminado. Dato
     * histórico: no autentica ni resuelve permisos.
     */
    oidcSubject: varchar('oidc_subject', { length: 255 }).unique(),
    /** Identificador de acceso, normalizado a minúsculas (ADR-026). */
    username: varchar('username', { length: 160 }).notNull(),
    /** Atributo opcional de contacto/visualización; no identifica la sesión. */
    email: varchar('email', { length: 320 }),
    displayName: varchar('display_name', { length: 160 }).notNull(),
    /** Hash argon2id. NULL = sin credencial local: no puede iniciar sesión. */
    passwordHash: text('password_hash'),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('users_username_format_check', sql`${table.username} ~ '^[a-z0-9][a-z0-9._@-]{1,158}$'`),
    uniqueIndex('users_username_lower_unique').on(sql`lower(${table.username})`),
  ],
);

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 80 }).notNull().unique(),
  name: varchar('name', { length: 160 }).notNull(),
});

export const permissions = pgTable('permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 120 }).notNull().unique(),
  description: text('description').notNull(),
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'restrict' }),
  },
  (table) => [
    primaryKey({ name: 'role_permissions_pk', columns: [table.roleId, table.permissionId] }),
  ],
);

export const userOrganizationRoles = pgTable(
  'user_organization_roles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'user_organization_roles_pk',
      columns: [table.userId, table.organizationId, table.roleId],
    }),
  ],
);

export const importBatches = pgTable(
  'import_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    originalFilename: varchar('original_filename', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 160 }).notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    processorVersion: integer('processor_version').notNull(),
    status: varchar('status', { length: 30 }).notNull().default('UPLOADED'),
    totalRows: integer('total_rows').notNull().default(0),
    validRows: integer('valid_rows').notNull().default(0),
    rejectedRows: integer('rejected_rows').notNull().default(0),
    duplicateRows: integer('duplicate_rows').notNull().default(0),
    existingRows: integer('existing_rows').notNull().default(0),
    tariffRejectedRows: integer('tariff_rejected_rows').notNull().default(0),
    confirmedRows: integer('confirmed_rows').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    lastErrorCode: varchar('last_error_code', { length: 80 }),
  },
  (table) => [
    index('import_batches_status_idx').on(table.organizationId, table.status, table.createdAt),
    index('import_batches_hash_idx').on(table.sha256),
    check(
      'import_batches_size_bytes_check',
      sql`${table.sizeBytes} > 0 AND ${table.sizeBytes} <= 20971520`,
    ),
    check('import_batches_processor_version_check', sql`${table.processorVersion} > 0`),
    check(
      'import_batches_status_check',
      sql`${table.status} IN ('UPLOADED', 'VALIDATING', 'READY_TO_CONFIRM', 'CONFIRMING', 'COMPLETED', 'FAILED', 'CANCELLED')`,
    ),
    check('import_batches_total_rows_check', sql`${table.totalRows} >= 0`),
    check('import_batches_valid_rows_check', sql`${table.validRows} >= 0`),
    check('import_batches_rejected_rows_check', sql`${table.rejectedRows} >= 0`),
    check('import_batches_duplicate_rows_check', sql`${table.duplicateRows} >= 0`),
    check('import_batches_existing_rows_check', sql`${table.existingRows} >= 0`),
    check('import_batches_tariff_rejected_rows_check', sql`${table.tariffRejectedRows} >= 0`),
    check('import_batches_confirmed_rows_check', sql`${table.confirmedRows} >= 0`),
  ],
);

export const authorizationItems = pgTable(
  'authorization_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    numeroAutorizacion: varchar('numero_autorizacion', { length: 255 }).notNull(),
    codigoMedicamento: varchar('codigo_medicamento', { length: 255 }).notNull(),
    authorizationKey: varchar('authorization_key', { length: 511 }).notNull(),
    processStatus: varchar('process_status', { length: 40 }),
    sourceData: jsonb('source_data').notNull(),
    sourceStatusNormalized: varchar('source_status_normalized', { length: 80 }).notNull(),
    sourcePrescripcionNormalized: varchar('source_prescripcion_normalized', {
      length: 255,
    })
      .notNull()
      .default(''),
    noPrescripcion: varchar('no_prescripcion', { length: 255 }).notNull().default(''),
    enablementStatus: varchar('enablement_status', { length: 40 }).notNull(),
    coverageType: varchar('coverage_type', { length: 30 }).notNull(),
    directionStatus: varchar('direction_status', { length: 30 }).notNull(),
    operationStatus: varchar('operation_status', { length: 40 }),
    coverageRuleVersion: varchar('coverage_rule_version', { length: 40 }).notNull(),
    lugarDispensacion: text('lugar_dispensacion'),
    fechaProgramada: date('fecha_programada'),
    fechaDispensacion: date('fecha_dispensacion'),
    fechaAplicacion: date('fecha_aplicacion'),
    codAutorizacionMedicarte: varchar('cod_autorizacion_medicarte', { length: 255 }),
    ordenCompra: varchar('orden_compra', { length: 255 }),
    auditStatus: varchar('audit_status', { length: 30 }).notNull().default('NOT_STARTED'),
    admissionStatus: varchar('admission_status', { length: 20 }).notNull().default('NOT_READY'),
    operationalVersion: integer('operational_version').notNull().default(0),
    tariffMembershipStatus: varchar('tariff_membership_status', { length: 30 })
      .notNull()
      .default('NOT_EVALUATED'),
    tariffMembershipEvaluatedAt: timestamp('tariff_membership_evaluated_at', {
      withTimezone: true,
    }),
    tariffRuleVersion: varchar('tariff_rule_version', { length: 40 })
      .notNull()
      .default('TARIFF-ANNEX-1'),
    createdFromBatchId: uuid('created_from_batch_id')
      .notNull()
      .references(() => importBatches.id, { onDelete: 'restrict' }),
    version: integer('version').notNull().default(1),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'restrict' }),
    lastLoadId: uuid('last_load_id').references(() => importBatches.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('authorization_items_identity_idx').on(
      table.numeroAutorizacion,
      table.codigoMedicamento,
    ),
    unique('authorization_items_id_code_unique').on(table.id, table.codigoMedicamento),
    uniqueIndex('authorization_items_authorization_key_idx').on(table.authorizationKey),
    index('authorization_items_coverage_idx').on(table.coverageType, table.enablementStatus),
    index('authorization_items_audit_status_idx').on(table.auditStatus, table.createdAt, table.id),
    index('authorization_items_created_idx').on(table.createdAt, table.id),
    index('authorization_items_tariff_membership_idx').on(
      table.codigoMedicamento,
      table.tariffMembershipStatus,
    ),
    check(
      'authorization_items_tariff_membership_status_check',
      sql`${table.tariffMembershipStatus} IN ('NOT_EVALUATED', 'LISTED', 'NOT_LISTED')`,
    ),
    check(
      'authorization_items_enablement_status_check',
      sql`${table.enablementStatus} IN ('ENABLED', 'BLOCKED_SOURCE_STATUS')`,
    ),
    check(
      'authorization_items_coverage_type_check',
      sql`${table.coverageType} IN ('PBS', 'NO_PBS')`,
    ),
    check(
      'authorization_items_direction_status_check',
      sql`${table.directionStatus} IN ('NOT_APPLICABLE', 'PENDING', 'CONFIRMED', 'QUERY_ERROR')`,
    ),
    check(
      'authorization_items_operation_status_check',
      sql`${table.operationStatus} IS NULL OR ${table.operationStatus} IN ('BLOCKED', 'READY_TO_DISPENSE', 'DISPENSATION_REPORTED', 'DISPENSED', 'EXPIRED')`,
    ),
    check(
      'authorization_items_process_status_check',
      sql`${table.processStatus} IS NULL OR ${table.processStatus} IN ('NOVEDAD', 'PENDIENTE_VALIDACION_MIPRES', 'LISTO_PARA_DISPENSAR', 'PENDIENTE_ORDEN_COMPRA', 'PENDIENTE_DISPENSACION', 'PENDIENTE_APLICACION', 'LISTO_PARA_AUDITORIA', 'AUDITORIA_APROBADA', 'AUDITORIA_RECHAZADA')`,
    ),
    check(
      'authorization_items_ready_prerequisites_check',
      sql`${table.operationStatus} IS NULL OR ${table.operationStatus} <> 'READY_TO_DISPENSE' OR (
        ${table.enablementStatus} = 'ENABLED' AND
        ${table.tariffMembershipStatus} = 'LISTED' AND (
          (${table.coverageType} = 'PBS' AND ${table.directionStatus} = 'NOT_APPLICABLE') OR
          (${table.coverageType} = 'NO_PBS' AND ${table.directionStatus} = 'CONFIRMED')
        )
      )`,
    ),
    check(
      'authorization_items_audit_status_check',
      sql`${table.auditStatus} IN ('NOT_STARTED', 'READY', 'IN_REVIEW', 'REJECTED', 'APPROVED')`,
    ),
    check(
      'authorization_items_admission_status_check',
      sql`${table.admissionStatus} IN ('NOT_READY', 'READY')`,
    ),
    check(
      'authorization_items_admission_ready_requires_approval_check',
      sql`${table.admissionStatus} <> 'READY' OR ${table.auditStatus} = 'APPROVED'`,
    ),
    check(
      'authorization_items_dispensed_requires_approval_check',
      sql`${table.operationStatus} <> 'DISPENSED' OR ${table.auditStatus} = 'APPROVED'`,
    ),
    check(
      'authorization_items_approval_requires_dispensed_check',
      sql`${table.auditStatus} <> 'APPROVED' OR ${table.operationStatus} = 'DISPENSED'`,
    ),
    check('authorization_items_version_check', sql`${table.version} > 0`),
  ],
);

export const dispensingPoints = pgTable(
  'dispensing_points',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    code: varchar('code', { length: 80 }).notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    active: boolean('active').notNull().default(true),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('dispensing_points_organization_code_idx').on(table.organizationId, table.code),
    index('dispensing_points_active_idx').on(table.organizationId, table.active, table.code),
    check('dispensing_points_code_not_blank_check', sql`length(btrim(${table.code})) > 0`),
    check('dispensing_points_name_not_blank_check', sql`length(btrim(${table.name})) > 0`),
  ],
);

/**
 * ESP-002: períodos de planificación. El rango es inclusivo [start_date, end_date].
 *
 * Invariantes que viven en PostgreSQL y no solo en la API:
 * - `planning_periods_no_overlap`: EXCLUDE USING gist sobre
 *   `daterange(start_date, end_date, '[]')`, definida en la migración 0032.
 *   Los períodos contiguos (fin + 1 día) no se solapan.
 * - `prevent_planning_period_structural_change`: trigger que congela
 *   start_date/end_date al salir de OPEN/PLANNING_CLOSED.
 * Drizzle no expresa EXCLUDE constraints en el esquema; se mantienen en SQL.
 */
export const planningPeriods = pgTable(
  'planning_periods',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    schedulingCutoffAt: timestamp('scheduling_cutoff_at', {
      withTimezone: true,
    }).notNull(),
    purchaseOrderDeadlineAt: timestamp('purchase_order_deadline_at', {
      withTimezone: true,
    }).notNull(),
    expectedDeliveryDate: date('expected_delivery_date').notNull(),
    status: varchar('status', { length: 30 }).notNull().default('OPEN'),
    version: integer('version').notNull().default(1),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('planning_periods_status_start_idx').on(table.status, table.startDate),
    check('planning_periods_date_range_check', sql`${table.startDate} <= ${table.endDate}`),
    check(
      'planning_periods_deadline_order_check',
      sql`${table.schedulingCutoffAt} <= ${table.purchaseOrderDeadlineAt}`,
    ),
    check(
      'planning_periods_delivery_after_purchase_check',
      sql`(timezone('America/Bogota', ${table.purchaseOrderDeadlineAt}))::date <= ${table.expectedDeliveryDate}`,
    ),
    check('planning_periods_version_check', sql`${table.version} > 0`),
    check(
      'planning_periods_status_check',
      sql`${table.status} IN ('OPEN', 'PLANNING_CLOSED', 'PURCHASING', 'IN_FULFILLMENT', 'OPERATIONAL', 'CLOSED')`,
    ),
  ],
);

export const patientSchedules = pgTable(
  'patient_schedules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    authorizationItemId: uuid('authorization_item_id').notNull(),
    planningPeriodId: uuid('planning_period_id')
      .notNull()
      .references(() => planningPeriods.id, { onDelete: 'restrict' }),
    dispensingPointId: uuid('dispensing_point_id')
      .notNull()
      .references(() => dispensingPoints.id, { onDelete: 'restrict' }),
    commercialCode: varchar('commercial_code', { length: 255 }).notNull(),
    scheduledDate: date('scheduled_date').notNull(),
    quantity: integer('quantity').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('SCHEDULED'),
    scheduleTiming: varchar('schedule_timing', { length: 10 }).notNull().default('ON_TIME'),
    lateHandling: varchar('late_handling', { length: 40 }),
    deferredPlanningPeriodId: uuid('deferred_planning_period_id').references(
      () => planningPeriods.id,
      { onDelete: 'restrict' },
    ),
    revision: integer('revision').notNull().default(1),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.authorizationItemId, table.commercialCode],
      foreignColumns: [authorizationItems.id, authorizationItems.codigoMedicamento],
      name: 'patient_schedules_authorization_code_fk',
    }),
    index('patient_schedules_period_point_date_idx').on(
      table.planningPeriodId,
      table.dispensingPointId,
      table.scheduledDate,
      table.status,
    ),
    index('patient_schedules_authorization_created_idx').on(
      table.authorizationItemId,
      table.createdAt,
    ),
    index('patient_schedules_commercial_status_idx').on(table.commercialCode, table.status),
    index('patient_schedules_point_date_status_idx').on(
      table.dispensingPointId,
      table.scheduledDate,
      table.status,
    ),
    /**
     * Identidad canónica de programación (pre-ESP-004): una programación
     * activa es unívoca por (authorization_item, punto, fecha). Cancelar
     * libera la identidad. Definida en migración 0034 como índice único
     * parcial; Drizzle no expresaba el WHERE al momento del esquema original.
     */
    uniqueIndex('patient_schedules_active_identity_idx')
      .on(table.authorizationItemId, table.dispensingPointId, table.scheduledDate)
      .where(sql`"status" IN ('SCHEDULED', 'RESCHEDULED')`),
    check(
      'patient_schedules_commercial_code_not_blank_check',
      sql`length(btrim(${table.commercialCode})) > 0`,
    ),
    check('patient_schedules_quantity_check', sql`${table.quantity} > 0`),
    check('patient_schedules_revision_check', sql`${table.revision} > 0`),
    check(
      'patient_schedules_status_check',
      sql`${table.status} IN ('SCHEDULED', 'RESCHEDULED', 'CANCELLED')`,
    ),
    check(
      'patient_schedules_schedule_timing_check',
      sql`${table.scheduleTiming} IN ('ON_TIME', 'LATE')`,
    ),
    check(
      'patient_schedules_late_handling_check',
      sql`${table.lateHandling} IS NULL OR ${table.lateHandling} IN ('COMPLEMENTARY_PURCHASE_ORDER', 'NEXT_PERIOD')`,
    ),
    check(
      'patient_schedules_late_handling_coherence_check',
      sql`(${table.scheduleTiming} = 'LATE' AND ${table.lateHandling} IS NOT NULL) OR (${table.scheduleTiming} = 'ON_TIME' AND ${table.lateHandling} IS NULL)`,
    ),
    check(
      'patient_schedules_deferred_period_check',
      sql`(${table.lateHandling} = 'NEXT_PERIOD' AND ${table.deferredPlanningPeriodId} IS NOT NULL) OR (${table.lateHandling} IS DISTINCT FROM 'NEXT_PERIOD' AND ${table.deferredPlanningPeriodId} IS NULL)`,
    ),
  ],
);

export const patientScheduleHistory = pgTable(
  'patient_schedule_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    patientScheduleId: uuid('patient_schedule_id')
      .notNull()
      .references(() => patientSchedules.id, { onDelete: 'restrict' }),
    revision: integer('revision').notNull(),
    authorizationItemId: uuid('authorization_item_id').notNull(),
    planningPeriodId: uuid('planning_period_id')
      .notNull()
      .references(() => planningPeriods.id, { onDelete: 'restrict' }),
    dispensingPointId: uuid('dispensing_point_id')
      .notNull()
      .references(() => dispensingPoints.id, { onDelete: 'restrict' }),
    commercialCode: varchar('commercial_code', { length: 255 }).notNull(),
    scheduledDate: date('scheduled_date').notNull(),
    quantity: integer('quantity').notNull(),
    status: varchar('status', { length: 20 }).notNull(),
    scheduleTiming: varchar('schedule_timing', { length: 10 }).notNull().default('ON_TIME'),
    lateHandling: varchar('late_handling', { length: 40 }),
    deferredPlanningPeriodId: uuid('deferred_planning_period_id').references(
      () => planningPeriods.id,
      { onDelete: 'restrict' },
    ),
    changeType: varchar('change_type', { length: 30 }).notNull(),
    changedBy: uuid('changed_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    correlationId: uuid('correlation_id').notNull(),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('patient_schedule_history_schedule_revision_unique').on(
      table.patientScheduleId,
      table.revision,
    ),
    foreignKey({
      columns: [table.authorizationItemId, table.commercialCode],
      foreignColumns: [authorizationItems.id, authorizationItems.codigoMedicamento],
      name: 'patient_schedule_history_authorization_code_fk',
    }),
    index('patient_schedule_history_schedule_changed_idx').on(
      table.patientScheduleId,
      table.changedAt,
    ),
    check('patient_schedule_history_revision_check', sql`${table.revision} > 0`),
    check('patient_schedule_history_quantity_check', sql`${table.quantity} > 0`),
    check(
      'patient_schedule_history_status_check',
      sql`${table.status} IN ('SCHEDULED', 'RESCHEDULED', 'CANCELLED')`,
    ),
    check(
      'patient_schedule_history_schedule_timing_check',
      sql`${table.scheduleTiming} IN ('ON_TIME', 'LATE')`,
    ),
    check(
      'patient_schedule_history_late_handling_check',
      sql`${table.lateHandling} IS NULL OR ${table.lateHandling} IN ('COMPLEMENTARY_PURCHASE_ORDER', 'NEXT_PERIOD')`,
    ),
    check(
      'patient_schedule_history_late_handling_coherence_check',
      sql`(${table.scheduleTiming} = 'LATE' AND ${table.lateHandling} IS NOT NULL) OR (${table.scheduleTiming} = 'ON_TIME' AND ${table.lateHandling} IS NULL)`,
    ),
  ],
);

export const projectedDemandLines = pgTable(
  'projected_demand_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    planningPeriodId: uuid('planning_period_id')
      .notNull()
      .references(() => planningPeriods.id, { onDelete: 'restrict' }),
    dispensingPointId: uuid('dispensing_point_id')
      .notNull()
      .references(() => dispensingPoints.id, { onDelete: 'restrict' }),
    commercialCode: varchar('commercial_code', { length: 255 }).notNull(),
    projectedQuantity: integer('projected_quantity').notNull(),
    /**
     * ESP-004: desglose del volumen por origen. regular/late provienen del
     * timing de las fuentes; la invariante projected = regular + late vive
     * en CHECKs y en la verificación transaccional de la consolidación.
     */
    regularQuantity: integer('regular_quantity').notNull().default(0),
    lateQuantity: integer('late_quantity').notNull().default(0),
    status: varchar('status', { length: 20 }).notNull().default('OPEN'),
    revision: integer('revision').notNull().default(1),
    consolidatedAt: timestamp('consolidated_at', { withTimezone: true }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * ESP-004: identidad de consolidación como UNIQUE CONSTRAINT (migración
     * 0035) para poder referenciarla con FK compuesto desde demand_sources.
     */
    unique('projected_demand_lines_identity_unique').on(
      table.planningPeriodId,
      table.dispensingPointId,
      table.commercialCode,
    ),
    index('projected_demand_lines_period_status_idx').on(table.planningPeriodId, table.status),
    check(
      'projected_demand_lines_commercial_code_not_blank_check',
      sql`length(btrim(${table.commercialCode})) > 0`,
    ),
    check('projected_demand_lines_quantity_check', sql`${table.projectedQuantity} > 0`),
    check('projected_demand_lines_revision_check', sql`${table.revision} > 0`),
    check(
      'projected_demand_lines_split_check',
      sql`${table.projectedQuantity} = ${table.regularQuantity} + ${table.lateQuantity}`,
    ),
    check(
      'projected_demand_lines_split_nonnegative_check',
      sql`${table.regularQuantity} >= 0 AND ${table.lateQuantity} >= 0`,
    ),
    check(
      'projected_demand_lines_status_check',
      sql`${table.status} IN ('OPEN', 'FROZEN', 'CLOSED')`,
    ),
  ],
);

export const demandSources = pgTable(
  'demand_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectedDemandLineId: uuid('projected_demand_line_id')
      .notNull()
      .references(() => projectedDemandLines.id, { onDelete: 'restrict' }),
    patientScheduleId: uuid('patient_schedule_id').notNull(),
    scheduleRevision: integer('schedule_revision').notNull(),
    quantity: integer('quantity').notNull(),
    /**
     * ESP-004: pertenencia de la fuente a la identidad de su línea, impuesta
     * por FK compuesto; el snapshot de la cantidad aporta línea por línea y
     * el timing clasifica el desglose regular/late.
     */
    planningPeriodId: uuid('planning_period_id').notNull(),
    dispensingPointId: uuid('dispensing_point_id').notNull(),
    commercialCode: varchar('commercial_code', { length: 255 }).notNull(),
    scheduleTiming: varchar('schedule_timing', { length: 10 }).notNull(),
    lateHandling: varchar('late_handling', { length: 40 }),
    /** ESP-004: bucket por el que la fuente suma (regla del dominio). */
    demandBucket: varchar('demand_bucket', { length: 30 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.patientScheduleId, table.scheduleRevision],
      foreignColumns: [patientScheduleHistory.patientScheduleId, patientScheduleHistory.revision],
      name: 'demand_sources_schedule_revision_fk',
    }),
    uniqueIndex('demand_sources_schedule_revision_idx').on(
      table.patientScheduleId,
      table.scheduleRevision,
    ),
    index('demand_sources_demand_line_idx').on(table.projectedDemandLineId, table.createdAt),
    check('demand_sources_schedule_revision_check', sql`${table.scheduleRevision} > 0`),
    check('demand_sources_quantity_check', sql`${table.quantity} > 0`),
    check(
      'demand_sources_schedule_timing_check',
      sql`${table.scheduleTiming} IN ('ON_TIME', 'LATE')`,
    ),
    check(
      'demand_sources_late_handling_check',
      sql`${table.lateHandling} IS NULL OR ${table.lateHandling} IN ('COMPLEMENTARY_PURCHASE_ORDER', 'NEXT_PERIOD')`,
    ),
    check(
      'demand_sources_demand_bucket_check',
      sql`${table.demandBucket} IN ('REGULAR', 'LATE')`,
    ),
  ],
);

export const purchaseOrders = pgTable('purchase_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  purchaseOrderCode: varchar('purchase_order_code', { length: 255 }),
  planningPeriodId: uuid('planning_period_id').notNull().references(() => planningPeriods.id, { onDelete: 'restrict' }),
  orderType: varchar('order_type', { length: 20 }).notNull(),
  status: varchar('status', { length: 30 }).notNull().default('DRAFT'),
  version: integer('version').notNull().default(1),
  issuedAt: timestamp('issued_at', { withTimezone: true }),
  issuedBy: uuid('issued_by').references(() => users.id, { onDelete: 'restrict' }),
  createdBy: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  updatedBy: uuid('updated_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('purchase_orders_period_status_idx').on(table.planningPeriodId, table.status, table.createdAt),
  uniqueIndex('purchase_orders_code_idx').on(table.purchaseOrderCode),
  check('purchase_orders_type_check', sql`${table.orderType} IN ('STANDARD', 'COMPLEMENTARY')`),
  check('purchase_orders_status_check', sql`${table.status} IN ('DRAFT', 'ISSUED', 'UNDER_OLP_REVIEW', 'ACCEPTED', 'PARTIALLY_ACCEPTED', 'REJECTED', 'CANCELLED')`),
  check('purchase_orders_version_check', sql`${table.version} > 0`),
]);

export const purchaseOrderLines = pgTable('purchase_order_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  purchaseOrderId: uuid('purchase_order_id').notNull().references(() => purchaseOrders.id, { onDelete: 'restrict' }),
  commercialCode: varchar('commercial_code', { length: 255 }).notNull(),
  productDescription: text('product_description'),
  presentation: text('presentation'),
  dispensingPointId: uuid('dispensing_point_id').notNull().references(() => dispensingPoints.id, { onDelete: 'restrict' }),
  requestedQuantity: integer('requested_quantity').notNull(),
  acceptedQuantity: integer('accepted_quantity'),
  requestedDeliveryDate: date('requested_delivery_date').notNull(),
  compensarUnitRateSnapshot: varchar('compensar_unit_rate_snapshot', { length: 255 }).notNull(),
  supplierUnitCost: varchar('supplier_unit_cost', { length: 255 }),
  // Historical identifier only: ESP-004 may delete a superseded live projection.
  projectedDemandLineId: uuid('projected_demand_line_id').notNull(),
  projectedDemandRevision: integer('projected_demand_revision').notNull(),
  demandBucket: varchar('demand_bucket', { length: 20 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('purchase_order_lines_order_idx').on(table.purchaseOrderId),
  index('purchase_order_lines_demand_idx').on(table.projectedDemandLineId, table.projectedDemandRevision),
  check('purchase_order_lines_requested_quantity_check', sql`${table.requestedQuantity} > 0`),
  check('purchase_order_lines_accepted_quantity_check', sql`${table.acceptedQuantity} IS NULL OR (${table.acceptedQuantity} >= 0 AND ${table.acceptedQuantity} <= ${table.requestedQuantity})`),
  check('purchase_order_lines_revision_check', sql`${table.projectedDemandRevision} > 0`),
  check('purchase_order_lines_bucket_check', sql`${table.demandBucket} IN ('REGULAR', 'LATE')`),
  check('purchase_order_lines_supplier_cost_check', sql`${table.acceptedQuantity} IS NULL OR ${table.acceptedQuantity} = 0 OR (${table.supplierUnitCost} IS NOT NULL AND ${table.supplierUnitCost}::numeric > 0)`),
]);

export const purchaseOrderDemandAllocations = pgTable('purchase_order_demand_allocations', {
  purchaseOrderLineId: uuid('purchase_order_line_id').notNull().references(() => purchaseOrderLines.id, { onDelete: 'restrict' }),
  projectedDemandLineId: uuid('projected_demand_line_id').notNull(),
  projectedDemandRevision: integer('projected_demand_revision').notNull(),
  demandBucket: varchar('demand_bucket', { length: 20 }).notNull(),
  allocatedQuantity: integer('allocated_quantity').notNull(),
}, (table) => [
  primaryKey({ name: 'purchase_order_demand_allocations_pk', columns: [table.purchaseOrderLineId, table.projectedDemandLineId, table.projectedDemandRevision, table.demandBucket] }),
  check('purchase_order_demand_allocations_quantity_check', sql`${table.allocatedQuantity} > 0`),
  check('purchase_order_demand_allocations_bucket_check', sql`${table.demandBucket} IN ('REGULAR', 'LATE')`),
]);

/**
 * ESP-003: staging de carga XLSX de programación. El procesamiento es
 * síncrono en la API (normalización + validación por fila) y la confirmación
 * es transaccional por fila elegible. `stagingStatus` usa el vocabulario
 * funcional VALID/INVALID/DUPLICATE/CONFLICT; `resultCode` conserva el
 * detalle estable para la UI y las pruebas.
 */
export const patientScheduleImports = pgTable(
  'patient_schedule_imports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    originalFilename: varchar('original_filename', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 160 }).notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    status: varchar('status', { length: 30 }).notNull().default('UPLOADED'),
    totalRows: integer('total_rows').notNull().default(0),
    validRows: integer('valid_rows').notNull().default(0),
    invalidRows: integer('invalid_rows').notNull().default(0),
    duplicateRows: integer('duplicate_rows').notNull().default(0),
    conflictRows: integer('conflict_rows').notNull().default(0),
    confirmedRows: integer('confirmed_rows').notNull().default(0),
    correlationId: uuid('correlation_id').notNull(),
    lastErrorCode: varchar('last_error_code', { length: 80 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  },
  (table) => [
    index('patient_schedule_imports_org_status_idx').on(
      table.organizationId,
      table.status,
      table.createdAt,
    ),
    check(
      'patient_schedule_imports_size_bytes_check',
      sql`${table.sizeBytes} > 0 AND ${table.sizeBytes} <= 20971520`,
    ),
    check(
      'patient_schedule_imports_status_check',
      sql`${table.status} IN ('UPLOADED', 'VALIDATING', 'READY_TO_CONFIRM', 'CONFIRMING', 'COMPLETED', 'FAILED')`,
    ),
    check('patient_schedule_imports_total_rows_check', sql`${table.totalRows} >= 0`),
    check('patient_schedule_imports_valid_rows_check', sql`${table.validRows} >= 0`),
    check('patient_schedule_imports_invalid_rows_check', sql`${table.invalidRows} >= 0`),
    check('patient_schedule_imports_duplicate_rows_check', sql`${table.duplicateRows} >= 0`),
    check('patient_schedule_imports_conflict_rows_check', sql`${table.conflictRows} >= 0`),
    check('patient_schedule_imports_confirmed_rows_check', sql`${table.confirmedRows} >= 0`),
  ],
);

export const patientScheduleImportSourceFiles = pgTable('patient_schedule_import_source_files', {
  id: uuid('id').primaryKey().defaultRandom(),
  importId: uuid('import_id')
    .notNull()
    .unique()
    .references(() => patientScheduleImports.id, { onDelete: 'cascade' }),
  originalFilename: varchar('original_filename', { length: 255 }).notNull(),
  mimeType: varchar('mime_type', { length: 160 }).notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  sha256: varchar('sha256', { length: 64 }).notNull(),
  content: bytea('content'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
});

export const patientScheduleImportRows = pgTable(
  'patient_schedule_import_rows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    importId: uuid('import_id')
      .notNull()
      .references(() => patientScheduleImports.id, { onDelete: 'cascade' }),
    rowNumber: integer('row_number').notNull(),
    rawData: jsonb('raw_data').notNull(),
    normalizedData: jsonb('normalized_data'),
    stagingStatus: varchar('staging_status', { length: 20 }).notNull(),
    resultCode: varchar('result_code', { length: 80 }).notNull(),
    resultMessage: text('result_message'),
    patientDocument: varchar('patient_document', { length: 80 }),
    authorizationNumber: varchar('authorization_number', { length: 255 }),
    commercialCode: varchar('commercial_code', { length: 255 }),
    quantity: integer('quantity'),
    dispensingPointCode: varchar('dispensing_point_code', { length: 80 }),
    scheduledDate: date('scheduled_date'),
    authorizationItemId: uuid('authorization_item_id').references(() => authorizationItems.id, {
      onDelete: 'restrict',
    }),
    planningPeriodId: uuid('planning_period_id').references(() => planningPeriods.id, {
      onDelete: 'restrict',
    }),
    dispensingPointId: uuid('dispensing_point_id').references(() => dispensingPoints.id, {
      onDelete: 'restrict',
    }),
    scheduleTiming: varchar('schedule_timing', { length: 10 }),
    lateHandling: varchar('late_handling', { length: 40 }),
    deferredPlanningPeriodId: uuid('deferred_planning_period_id').references(
      () => planningPeriods.id,
      { onDelete: 'restrict' },
    ),
    confirmable: boolean('confirmable').notNull().default(false),
    patientScheduleId: uuid('patient_schedule_id').references(() => patientSchedules.id, {
      onDelete: 'restrict',
    }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('patient_schedule_import_rows_import_row_unique').on(table.importId, table.rowNumber),
    index('patient_schedule_import_rows_status_idx').on(
      table.importId,
      table.stagingStatus,
      table.rowNumber,
    ),
    check('patient_schedule_import_rows_row_number_check', sql`${table.rowNumber} > 0`),
    check(
      'patient_schedule_import_rows_staging_status_check',
      sql`${table.stagingStatus} IN ('VALID', 'INVALID', 'DUPLICATE', 'CONFLICT')`,
    ),
    check(
      'patient_schedule_import_rows_result_code_check',
      sql`${table.resultCode} IN (
        'ROW_VALID', 'MISSING_REQUIRED_FIELD', 'INVALID_FIELD_FORMAT',
        'DUPLICATE_IN_FILE', 'DUPLICATE_EXISTING_SCHEDULE',
        'AUTHORIZATION_ITEM_NOT_FOUND', 'AUTHORIZATION_CODE_MISMATCH',
        'PATIENT_DOCUMENT_MISMATCH',
        'AUTHORIZATION_NOT_SCHEDULABLE', 'AUTHORIZATION_EXPIRED',
        'INVALID_QUANTITY', 'DISPENSING_POINT_NOT_FOUND',
        'PLANNING_PERIOD_NOT_FOUND', 'NEXT_PERIOD_NOT_FOUND',
        'LATE_HANDLING_REQUIRED', 'INVALID_HEADERS', 'PROCESSING_ERROR',
        'CONFIRMATION_CONFLICT'
      )`,
    ),
    check(
      'patient_schedule_import_rows_quantity_check',
      sql`${table.quantity} IS NULL OR ${table.quantity} > 0`,
    ),
  ],
);

export const coverageEvaluations = pgTable(
  'coverage_evaluations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    authorizationItemId: uuid('authorization_item_id')
      .notNull()
      .references(() => authorizationItems.id, { onDelete: 'restrict' }),
    evaluationVersion: integer('evaluation_version').notNull(),
    sourceValue: text('source_value').notNull(),
    normalizedValue: text('normalized_value').notNull(),
    coverageType: varchar('coverage_type', { length: 30 }).notNull(),
    ruleVersion: varchar('rule_version', { length: 40 }).notNull(),
    evaluatedAt: timestamp('evaluated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('coverage_evaluations_item_version_idx').on(
      table.authorizationItemId,
      table.evaluationVersion,
    ),
    check('coverage_evaluations_evaluation_version_check', sql`${table.evaluationVersion} > 0`),
    check(
      'coverage_evaluations_coverage_type_check',
      sql`${table.coverageType} IN ('PBS', 'NO_PBS')`,
    ),
  ],
);

export const mipresChecks = pgTable(
  'mipres_checks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    authorizationItemId: uuid('authorization_item_id')
      .notNull()
      .references(() => authorizationItems.id, { onDelete: 'restrict' }),
    prescriptionNumber: varchar('prescription_number', { length: 255 }).notNull(),
    queryType: varchar('query_type', { length: 10 }).notNull(),
    outcome: varchar('outcome', { length: 20 }).notNull(),
    httpStatus: integer('http_status'),
    directionCount: integer('direction_count').notNull().default(0),
    hasCurrentDirection: boolean('has_current_direction'),
    ruleVersion: varchar('rule_version', { length: 40 }).notNull(),
    checkDate: date('check_date').notNull(),
    responsePayload: jsonb('response_payload'),
    correlationId: uuid('correlation_id').notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 200 }).notNull(),
    queriedAt: timestamp('queried_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('mipres_checks_item_idx').on(table.authorizationItemId, table.queriedAt),
    index('mipres_checks_item_day_idx').on(
      table.authorizationItemId,
      table.queryType,
      table.checkDate,
    ),
    check('mipres_checks_query_type_check', sql`${table.queryType} IN ('AUTO', 'MANUAL')`),
    check(
      'mipres_checks_outcome_check',
      sql`${table.outcome} IN ('PENDING', 'CONFIRMED', 'QUERY_ERROR')`,
    ),
    check('mipres_checks_direction_count_check', sql`${table.directionCount} >= 0`),
  ],
);

export const mipresDirections = pgTable(
  'mipres_directions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mipresCheckId: uuid('mipres_check_id')
      .notNull()
      .references(() => mipresChecks.id, { onDelete: 'restrict' }),
    authorizationItemId: uuid('authorization_item_id')
      .notNull()
      .references(() => authorizationItems.id, { onDelete: 'restrict' }),
    externalId: varchar('external_id', { length: 120 }).notNull(),
    directionId: varchar('direction_id', { length: 120 }).notNull(),
    prescriptionNumber: varchar('prescription_number', { length: 255 }).notNull(),
    technologyType: varchar('technology_type', { length: 40 }).notNull(),
    technologyConsecutive: varchar('technology_consecutive', { length: 40 }).notNull(),
    maximumDeliveryDate: date('maximum_delivery_date').notNull(),
    externalStatus: varchar('external_status', { length: 80 }).notNull(),
    annulled: boolean('annulled').notNull(),
    current: boolean('current').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('mipres_directions_check_idx').on(table.mipresCheckId),
    index('mipres_directions_item_idx').on(table.authorizationItemId, table.createdAt),
  ],
);

export const authorizationItemOrganizations = pgTable(
  'authorization_item_organizations',
  {
    authorizationItemId: uuid('authorization_item_id')
      .notNull()
      .references(() => authorizationItems.id, { onDelete: 'restrict' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'authorization_item_organizations_pk',
      columns: [table.authorizationItemId, table.organizationId],
    }),
    index('authorization_item_organizations_org_idx').on(
      table.organizationId,
      table.authorizationItemId,
    ),
  ],
);

export const importSourceFiles = pgTable(
  'import_source_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    importBatchId: uuid('import_batch_id')
      .notNull()
      .references(() => importBatches.id, { onDelete: 'cascade' }),
    originalFilename: varchar('original_filename', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 160 }).notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    content: bytea('content'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('import_source_files_batch_idx').on(table.importBatchId),
    check(
      'import_source_files_size_bytes_check',
      sql`${table.sizeBytes} > 0 AND ${table.sizeBytes} <= 20971520`,
    ),
  ],
);

export const importRows = pgTable(
  'import_rows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    importBatchId: uuid('import_batch_id')
      .notNull()
      .references(() => importBatches.id, { onDelete: 'cascade' }),
    rowNumber: integer('row_number').notNull(),
    rawData: jsonb('raw_data').notNull(),
    normalizedData: jsonb('normalized_data'),
    authorizationKey: varchar('authorization_key', { length: 511 }),
    resultCode: varchar('result_code', { length: 80 }).notNull(),
    resultMessage: text('result_message').notNull(),
    confirmable: boolean('confirmable').notNull().default(false),
    authorizationItemId: uuid('authorization_item_id').references(() => authorizationItems.id, {
      onDelete: 'restrict',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('import_rows_batch_row_unique').on(table.importBatchId, table.rowNumber),
    index('import_rows_batch_result_idx').on(
      table.importBatchId,
      table.resultCode,
      table.rowNumber,
    ),
    check('import_rows_row_number_check', sql`${table.rowNumber} > 0`),
    check(
      'import_rows_result_code_check',
      sql`${table.resultCode} IN ('ROW_VALID', 'MISSING_REQUIRED_FIELD', 'INVALID_FIELD_FORMAT', 'DUPLICATE_IN_FILE', 'EXISTING_ITEM_REVIEW_REQUIRED', 'EXPLICIT_UPDATE_NOT_ALLOWED', 'ITEM_CREATED', 'ITEM_UPDATED', 'PRODUCT_NOT_IN_TARIFF_ANNEX', 'PROCESSING_ERROR')`,
    ),
  ],
);

export const validationErrors = pgTable(
  'validation_errors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    importRowId: uuid('import_row_id')
      .notNull()
      .references(() => importRows.id, { onDelete: 'cascade' }),
    fieldName: varchar('field_name', { length: 160 }).notNull(),
    code: varchar('code', { length: 80 }).notNull(),
    message: text('message').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('validation_errors_row_idx').on(table.importRowId)],
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    actorType: varchar('actor_type', { length: 30 }).notNull(),
    actorId: uuid('actor_id'),
    organizationId: uuid('organization_id'),
    action: varchar('action', { length: 120 }).notNull(),
    resourceType: varchar('resource_type', { length: 120 }).notNull(),
    resourceId: varchar('resource_id', { length: 255 }).notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    correlationId: uuid('correlation_id').notNull(),
    requestId: varchar('request_id', { length: 255 }),
    ipAddress: varchar('ip_address', { length: 64 }),
    userAgent: text('user_agent'),
    result: varchar('result', { length: 40 }).notNull(),
  },
  (table) => [index('audit_events_resource_idx').on(table.resourceType, table.resourceId)],
);

export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventType: varchar('event_type', { length: 120 }).notNull(),
    version: integer('version').notNull(),
    payload: jsonb('payload').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'restrict',
    }),
    idempotencyKey: varchar('idempotency_key', { length: 200 }).notNull(),
    status: varchar('status', { length: 30 }).notNull().default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    lastError: text('last_error'),
  },
  (table) => [
    uniqueIndex('outbox_events_idempotency_key_idx').on(table.idempotencyKey),
    index('outbox_events_dispatch_idx').on(table.status, table.availableAt),
    check(
      'outbox_events_status_check',
      sql`${table.status} IN ('PENDING', 'DISPATCHED', 'PROCESSED', 'FAILED')`,
    ),
  ],
);

export const idempotencyRecords = pgTable(
  'idempotency_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scope: varchar('scope', { length: 120 }).notNull(),
    key: varchar('key', { length: 200 }).notNull(),
    requestHash: varchar('request_hash', { length: 64 }).notNull(),
    statusCode: integer('status_code').notNull(),
    response: jsonb('response').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('idempotency_records_scope_key_idx').on(table.scope, table.key),
    index('idempotency_records_expires_at_idx').on(table.expiresAt),
  ],
);

export const operationalFieldChanges = pgTable(
  'operational_field_changes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    authorizationItemId: uuid('authorization_item_id')
      .notNull()
      .references(() => authorizationItems.id, { onDelete: 'restrict' }),
    fieldName: varchar('field_name', { length: 120 }).notNull(),
    previousValue: text('previous_value'),
    newValue: text('new_value').notNull(),
    previousOperationalVersion: integer('previous_operational_version').notNull(),
    newOperationalVersion: integer('new_operational_version').notNull(),
    operationType: varchar('operation_type', { length: 40 }).notNull(),
    bulkUpdateBatchId: uuid('bulk_update_batch_id'),
    bulkUpdateRowId: uuid('bulk_update_row_id'),
    actorType: varchar('actor_type', { length: 30 }).notNull(),
    actorId: uuid('actor_id'),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'restrict',
    }),
    correlationId: uuid('correlation_id').notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 200 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('operational_field_changes_item_idx').on(table.authorizationItemId, table.createdAt),
    check(
      'operational_field_changes_version_check',
      sql`${table.newOperationalVersion} > ${table.previousOperationalVersion}`,
    ),
  ],
);

export const bulkUpdateBatches = pgTable(
  'bulk_update_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    operationType: varchar('operation_type', { length: 40 }).notNull(),
    contractVersion: integer('contract_version').notNull(),
    originalFilename: varchar('original_filename', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 160 }).notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    status: varchar('status', { length: 30 }).notNull().default('UPLOADED'),
    totalRows: integer('total_rows').notNull().default(0),
    processedRows: integer('processed_rows').notNull().default(0),
    updatedRows: integer('updated_rows').notNull().default(0),
    unchangedRows: integer('unchanged_rows').notNull().default(0),
    rejectedRows: integer('rejected_rows').notNull().default(0),
    lastErrorCode: varchar('last_error_code', { length: 80 }),
    correlationId: uuid('correlation_id').notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 200 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('bulk_update_batches_org_idx').on(table.organizationId, table.createdAt),
    index('bulk_update_batches_hash_idx').on(table.sha256),
    uniqueIndex('bulk_update_batches_logical_key_idx')
      .on(table.organizationId, table.operationType, table.sha256, table.contractVersion)
      .where(sql`${table.status} <> 'FAILED'`),
    check(
      'bulk_update_batches_size_bytes_check',
      sql`${table.sizeBytes} > 0 AND ${table.sizeBytes} <= 20971520`,
    ),
    check(
      'bulk_update_batches_status_check',
      sql`${table.status} IN ('UPLOADED', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED')`,
    ),
    check(
      'bulk_update_batches_operation_type_check',
      sql`${table.operationType} IN ('ASSIGN_DISPENSATION_LOCATION', 'REPORT_DISPENSATION_DATE', 'REPORT_APPLICATION_DATE')`,
    ),
  ],
);

export const bulkUpdateSourceFiles = pgTable(
  'bulk_update_source_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => bulkUpdateBatches.id, { onDelete: 'cascade' }),
    originalFilename: varchar('original_filename', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 160 }).notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    content: bytea('content'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('bulk_update_source_files_batch_idx').on(table.batchId),
    check(
      'bulk_update_source_files_size_bytes_check',
      sql`${table.sizeBytes} > 0 AND ${table.sizeBytes} <= 20971520`,
    ),
  ],
);

export const bulkUpdateRows = pgTable(
  'bulk_update_rows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => bulkUpdateBatches.id, { onDelete: 'cascade' }),
    rowNumber: integer('row_number').notNull(),
    rawData: jsonb('raw_data').notNull(),
    authorizationKey: varchar('authorization_key', { length: 511 }),
    authorizationItemId: uuid('authorization_item_id').references(() => authorizationItems.id, {
      onDelete: 'restrict',
    }),
    fieldName: varchar('field_name', { length: 120 }),
    previousValue: text('previous_value'),
    newValue: text('new_value'),
    fieldVersion: integer('field_version'),
    resultCode: varchar('result_code', { length: 40 }).notNull(),
    resultMessage: text('result_message').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('bulk_update_rows_batch_row_unique').on(table.batchId, table.rowNumber),
    index('bulk_update_rows_batch_result_idx').on(table.batchId, table.resultCode, table.rowNumber),
    check('bulk_update_rows_row_number_check', sql`${table.rowNumber} > 0`),
    check(
      'bulk_update_rows_result_code_check',
      sql`${table.resultCode} IN ('ROW_UPDATED', 'UNCHANGED_VALUE', 'INVALID_FILE_FORMAT', 'FILE_TOO_LARGE', 'INVALID_HEADERS', 'MISSING_BUSINESS_KEY', 'DUPLICATE_KEY_IN_FILE', 'AUTHORIZATION_ITEM_NOT_FOUND', 'FORBIDDEN_ITEM_SCOPE', 'OPERATION_NOT_ALLOWED', 'MISSING_VALUE', 'INVALID_VALUE_FORMAT', 'INVALID_OPERATION_STATE', 'VERSION_CONFLICT', 'PROCESSING_ERROR')`,
    ),
  ],
);

export const auditReviews = pgTable(
  'audit_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    authorizationItemId: uuid('authorization_item_id')
      .notNull()
      .references(() => authorizationItems.id, { onDelete: 'restrict' }),
    reviewNumber: integer('review_number').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('IN_REVIEW'),
    observations: text('observations'),
    startedBy: uuid('started_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'restrict' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    correlationId: uuid('correlation_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('audit_reviews_item_number_idx').on(table.authorizationItemId, table.reviewNumber),
    index('audit_reviews_item_status_idx').on(table.authorizationItemId, table.status),
    check(
      'audit_reviews_status_check',
      sql`${table.status} IN ('IN_REVIEW', 'APPROVED', 'REJECTED')`,
    ),
    check('audit_reviews_review_number_check', sql`${table.reviewNumber} > 0`),
    check(
      'audit_reviews_decision_requires_fields_check',
      sql`${table.status} = 'IN_REVIEW' OR (${table.decidedBy} IS NOT NULL AND ${table.decidedAt} IS NOT NULL)`,
    ),
    check(
      'audit_reviews_reject_requires_observations_check',
      sql`${table.status} <> 'REJECTED' OR ${table.observations} IS NOT NULL`,
    ),
  ],
);

export const auditFindings = pgTable(
  'audit_findings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    auditReviewId: uuid('audit_review_id')
      .notNull()
      .references(() => auditReviews.id, { onDelete: 'restrict' }),
    code: varchar('code', { length: 80 }).notNull(),
    description: text('description').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    correlationId: uuid('correlation_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('audit_findings_review_idx').on(table.auditReviewId, table.createdAt)],
);

export const jobResults = pgTable(
  'job_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    queue: varchar('queue', { length: 120 }).notNull(),
    jobName: varchar('job_name', { length: 120 }).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 200 }).notNull(),
    result: jsonb('result').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('job_results_queue_idempotency_idx').on(table.queue, table.idempotencyKey),
  ],
);

export const tariffAnnexProducts = pgTable(
  'tariff_annex_products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    codigoProducto: varchar('codigo_producto', { length: 255 }).notNull(),
    tarifaUnidad: varchar('tarifa_unidad', { length: 255 }),
    numeroExpedienteInvima: varchar('numero_expediente_invima', { length: 255 }),
    consecutivoInvimaPresentacion: varchar('consecutivo_invima_presentacion', { length: 255 }),
    descripcionGenerica: text('descripcion_generica'),
    descripcionComercial: text('descripcion_comercial'),
    laboratorio: varchar('laboratorio', { length: 500 }),
    tipoInclusion: varchar('tipo_inclusion', { length: 100 }),
    active: boolean('active').notNull().default(true),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'restrict' }),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('tariff_annex_products_code_idx').on(table.codigoProducto),
    index('tariff_annex_products_active_idx').on(table.active, table.codigoProducto),
    check('tariff_annex_products_version_check', sql`${table.version} > 0`),
    check('tariff_annex_products_code_length_check', sql`length(${table.codigoProducto}) > 0`),
  ],
);

export const tariffAnnexImports = pgTable(
  'tariff_annex_imports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    originalFilename: varchar('original_filename', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 160 }).notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    status: varchar('status', { length: 30 }).notNull().default('UPLOADED'),
    totalRows: integer('total_rows').notNull().default(0),
    createdRows: integer('created_rows').notNull().default(0),
    reactivatedRows: integer('reactivated_rows').notNull().default(0),
    existingRows: integer('existing_rows').notNull().default(0),
    rejectedRows: integer('rejected_rows').notNull().default(0),
    duplicateRows: integer('duplicate_rows').notNull().default(0),
    lastErrorCode: varchar('last_error_code', { length: 80 }),
    correlationId: uuid('correlation_id').notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 200 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('tariff_annex_imports_org_idx').on(table.organizationId, table.createdAt),
    uniqueIndex('tariff_annex_imports_logical_key_idx').on(table.organizationId, table.sha256),
    check(
      'tariff_annex_imports_size_bytes_check',
      sql`${table.sizeBytes} > 0 AND ${table.sizeBytes} <= 20971520`,
    ),
    check(
      'tariff_annex_imports_status_check',
      sql`${table.status} IN ('UPLOADED', 'VALIDATING', 'COMPLETED', 'FAILED')`,
    ),
  ],
);

export const tariffAnnexImportSourceFiles = pgTable(
  'tariff_annex_import_source_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    importId: uuid('import_id')
      .notNull()
      .references(() => tariffAnnexImports.id, { onDelete: 'cascade' }),
    originalFilename: varchar('original_filename', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 160 }).notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    content: bytea('content'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('tariff_annex_import_source_files_import_idx').on(table.importId),
    check(
      'tariff_annex_import_source_files_size_bytes_check',
      sql`${table.sizeBytes} > 0 AND ${table.sizeBytes} <= 20971520`,
    ),
  ],
);

export const tariffAnnexImportRows = pgTable(
  'tariff_annex_import_rows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    importId: uuid('import_id')
      .notNull()
      .references(() => tariffAnnexImports.id, { onDelete: 'cascade' }),
    rowNumber: integer('row_number').notNull(),
    rawData: jsonb('raw_data').notNull(),
    codigoProducto: varchar('codigo_producto', { length: 255 }),
    resultCode: varchar('result_code', { length: 80 }).notNull(),
    resultMessage: text('result_message').notNull(),
    productId: uuid('product_id').references(() => tariffAnnexProducts.id, {
      onDelete: 'restrict',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('tariff_annex_import_rows_import_row_unique').on(table.importId, table.rowNumber),
    index('tariff_annex_import_rows_result_idx').on(
      table.importId,
      table.resultCode,
      table.rowNumber,
    ),
    check('tariff_annex_import_rows_row_number_check', sql`${table.rowNumber} > 0`),
    check(
      'tariff_annex_import_rows_result_code_check',
      sql`${table.resultCode} IN ('PRODUCT_CREATED', 'PRODUCT_REACTIVATED', 'PRODUCT_EXISTING', 'INVALID_PRODUCT_CODE', 'DUPLICATE_IN_FILE', 'INVALID_FILE_FORMAT', 'PROCESSING_ERROR')`,
    ),
  ],
);

export const noveltyCodes = pgTable('novelty_codes', {
  code: varchar('code', { length: 30 }).primaryKey(),
  stage: varchar('stage', { length: 60 }).notNull(),
  field: varchar('field', { length: 160 }),
  description: text('description').notNull(),
  errorType: varchar('error_type', { length: 32 }).notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const novelties = pgTable(
  'novelties',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    authorizationItemId: uuid('authorization_item_id').references(() => authorizationItems.id, {
      onDelete: 'restrict',
    }),
    importBatchId: uuid('import_batch_id').references(() => importBatches.id, {
      onDelete: 'restrict',
    }),
    bulkUpdateBatchId: uuid('bulk_update_batch_id').references(() => bulkUpdateBatches.id, {
      onDelete: 'restrict',
    }),
    tariffAnnexImportId: uuid('tariff_annex_import_id').references(() => tariffAnnexImports.id, {
      onDelete: 'restrict',
    }),
    sourceRowNumber: integer('source_row_number'),
    originalRow: jsonb('original_row').notNull(),
    code: varchar('code', { length: 30 })
      .notNull()
      .references(() => noveltyCodes.code, {
        onDelete: 'restrict',
      }),
    stage: varchar('stage', { length: 60 }).notNull(),
    field: varchar('field', { length: 160 }),
    receivedValue: text('received_value'),
    description: text('description').notNull(),
    active: boolean('active').notNull().default(true),
    attemptNumber: integer('attempt_number').notNull().default(1),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('novelties_item_active_idx').on(
      table.authorizationItemId,
      table.active,
      table.processedAt,
    ),
    index('novelties_code_idx').on(table.code, table.processedAt),
    index('novelties_batch_idx').on(table.importBatchId, table.bulkUpdateBatchId),
    index('novelties_attempt_idx').on(table.code, table.authorizationItemId, table.attemptNumber),
    check('novelties_attempt_number_check', sql`${table.attemptNumber} > 0`),
  ],
);
