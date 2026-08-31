import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  date,
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
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  oidcSubject: varchar('oidc_subject', { length: 255 }).notNull().unique(),
  email: varchar('email', { length: 320 }).notNull(),
  displayName: varchar('display_name', { length: 160 }).notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

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
    status: varchar('status', { length: 30 }).notNull().default('CARGADO'),
    totalRows: integer('total_rows').notNull().default(0),
    validRows: integer('valid_rows').notNull().default(0),
    rejectedRows: integer('rejected_rows').notNull().default(0),
    duplicateRows: integer('duplicate_rows').notNull().default(0),
    existingRows: integer('existing_rows').notNull().default(0),
    confirmedRows: integer('confirmed_rows').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    revertedAt: timestamp('reverted_at', { withTimezone: true }),
    revertedBy: uuid('reverted_by').references(() => users.id, { onDelete: 'restrict' }),
    revertedRemovedItems: integer('reverted_removed_items').notNull().default(0),
    revertedBlockedItems: integer('reverted_blocked_items').notNull().default(0),
    lastErrorCode: varchar('last_error_code', { length: 80 }),
  },
  (table) => [
    index('import_batches_status_idx').on(table.organizationId, table.status, table.createdAt),
    index('import_batches_hash_idx').on(table.sha256),
    index('import_batches_reverted_idx').on(table.organizationId, table.revertedAt),
    check(
      'import_batches_size_bytes_check',
      sql`${table.sizeBytes} > 0 AND ${table.sizeBytes} <= 20971520`,
    ),
    check('import_batches_processor_version_check', sql`${table.processorVersion} > 0`),
    check(
      'import_batches_status_check',
      sql`${table.status} IN ('CARGADO', 'VALIDANDO', 'LISTO_PARA_CONFIRMAR', 'CONFIRMANDO', 'COMPLETADO', 'FALLIDO', 'CANCELADO', 'REVIRTIENDO', 'REVERTIDO')`,
    ),
    check('import_batches_reverted_removed_items_check', sql`${table.revertedRemovedItems} >= 0`),
    check('import_batches_reverted_blocked_items_check', sql`${table.revertedBlockedItems} >= 0`),
    check('import_batches_total_rows_check', sql`${table.totalRows} >= 0`),
    check('import_batches_valid_rows_check', sql`${table.validRows} >= 0`),
    check('import_batches_rejected_rows_check', sql`${table.rejectedRows} >= 0`),
    check('import_batches_duplicate_rows_check', sql`${table.duplicateRows} >= 0`),
    check('import_batches_existing_rows_check', sql`${table.existingRows} >= 0`),
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
    /** SPEC-014: resultado vigente de la validación del Anexo Tarifario. */
    tariffMembershipStatus: varchar('tariff_membership_status', { length: 30 })
      .notNull()
      .default('NO_EVALUADO'),
    tariffMembershipEvaluatedAt: timestamp('tariff_membership_evaluated_at', {
      withTimezone: true,
    }),
    tariffRuleVersion: varchar('tariff_rule_version', { length: 40 })
      .notNull()
      .default('TARIFF-ANNEX-1'),
    lugarDispensacion: text('lugar_dispensacion'),
    fechaDispensacion: date('fecha_dispensacion'),
    fechaAplicacion: date('fecha_aplicacion'),
    auditStatus: varchar('audit_status', { length: 30 }).notNull().default('NO_INICIADO'),
    admissionStatus: varchar('admission_status', { length: 20 }).notNull().default('NO_LISTO'),
    operationalVersion: integer('operational_version').notNull().default(0),
    createdFromBatchId: uuid('created_from_batch_id')
      .notNull()
      .references(() => importBatches.id, { onDelete: 'restrict' }),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('authorization_items_identity_idx').on(
      table.numeroAutorizacion,
      table.codigoMedicamento,
    ),
    index('authorization_items_coverage_idx').on(table.coverageType, table.enablementStatus),
    index('authorization_items_audit_status_idx').on(table.auditStatus, table.createdAt, table.id),
    index('authorization_items_created_idx').on(table.createdAt, table.id),
    // SPEC-014 §16.2: revalidación dirigida por código de medicamento.
    index('authorization_items_tariff_membership_idx').on(
      table.codigoMedicamento,
      table.tariffMembershipStatus,
    ),
    check(
      'authorization_items_enablement_status_check',
      sql`${table.enablementStatus} IN ('HABILITADO', 'BLOQUEADO_POR_ESTADO_ORIGEN')`,
    ),
    check(
      'authorization_items_coverage_type_check',
      sql`${table.coverageType} IN ('PBS', 'NO_PBS')`,
    ),
    check(
      'authorization_items_direction_status_check',
      sql`${table.directionStatus} IN ('NO_APLICA', 'PENDIENTE', 'CONFIRMADO', 'ERROR_DE_CONSULTA')`,
    ),
    check(
      'authorization_items_operation_status_check',
      sql`${table.operationStatus} IS NULL OR ${table.operationStatus} IN ('BLOQUEADO', 'LISTO_PARA_DISPENSAR', 'DISPENSACION_REPORTADA', 'DISPENSADO', 'VENCIDO')`,
    ),
    check(
      'authorization_items_tariff_membership_status_check',
      sql`${table.tariffMembershipStatus} IN ('NO_EVALUADO', 'LISTADO', 'NO_LISTADO')`,
    ),
    check(
      'authorization_items_ready_prerequisites_check',
      sql`${table.operationStatus} IS NULL OR ${table.operationStatus} <> 'LISTO_PARA_DISPENSAR' OR (
        ${table.enablementStatus} = 'HABILITADO' AND ${table.tariffMembershipStatus} = 'LISTADO' AND (
          (${table.coverageType} = 'PBS' AND ${table.directionStatus} = 'NO_APLICA') OR
          (${table.coverageType} = 'NO_PBS' AND ${table.directionStatus} = 'CONFIRMADO')
        )
      )`,
    ),
    check(
      'authorization_items_audit_status_check',
      sql`${table.auditStatus} IN ('NO_INICIADO', 'LISTO', 'EN_REVISION', 'RECHAZADO', 'APROBADO')`,
    ),
    check(
      'authorization_items_admission_status_check',
      sql`${table.admissionStatus} IN ('NO_LISTO', 'LISTO')`,
    ),
    check(
      'authorization_items_admission_ready_requires_approval_check',
      sql`${table.admissionStatus} <> 'LISTO' OR ${table.auditStatus} = 'APROBADO'`,
    ),
    check(
      'authorization_items_dispensed_requires_approval_check',
      sql`${table.operationStatus} <> 'DISPENSADO' OR ${table.auditStatus} = 'APROBADO'`,
    ),
    check(
      'authorization_items_approval_requires_dispensed_check',
      sql`${table.auditStatus} <> 'APROBADO' OR ${table.operationStatus} = 'DISPENSADO'`,
    ),
    check('authorization_items_version_check', sql`${table.version} > 0`),
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
      sql`${table.outcome} IN ('PENDIENTE', 'CONFIRMADO', 'ERROR_DE_CONSULTA')`,
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
      sql`${table.resultCode} IN ('ROW_VALID', 'MISSING_REQUIRED_FIELD', 'INVALID_FIELD_FORMAT', 'DUPLICATE_IN_FILE', 'EXISTING_ITEM_REVIEW_REQUIRED', 'EXPLICIT_UPDATE_NOT_ALLOWED', 'ITEM_CREATED', 'ITEM_UPDATED', 'PROCESSING_ERROR')`,
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
    status: varchar('status', { length: 30 }).notNull().default('PENDIENTE'),
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
      sql`${table.status} IN ('PENDIENTE', 'DESPACHADO', 'PROCESADO', 'FALLIDO')`,
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
    status: varchar('status', { length: 30 }).notNull().default('CARGADO'),
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
    uniqueIndex('bulk_update_batches_logical_key_idx').on(
      table.organizationId,
      table.operationType,
      table.sha256,
      table.contractVersion,
    ),
    check(
      'bulk_update_batches_size_bytes_check',
      sql`${table.sizeBytes} > 0 AND ${table.sizeBytes} <= 20971520`,
    ),
    check(
      'bulk_update_batches_status_check',
      sql`${table.status} IN ('CARGADO', 'EN_COLA', 'PROCESANDO', 'COMPLETADO', 'FALLIDO')`,
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

export const notificationTemplates = pgTable(
  'notification_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    notificationType: varchar('notification_type', { length: 60 }).notNull(),
    version: integer('version').notNull(),
    subjectTemplate: text('subject_template').notNull(),
    bodyTemplate: text('body_template').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('notification_templates_type_version_idx').on(
      table.notificationType,
      table.version,
    ),
    check('notification_templates_version_check', sql`${table.version} > 0`),
  ],
);

export const notificationRecipients = pgTable(
  'notification_recipients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    notificationType: varchar('notification_type', { length: 60 }).notNull(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    email: varchar('email', { length: 320 }).notNull(),
    active: boolean('active').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('notification_recipients_unique_idx').on(
      table.notificationType,
      table.organizationId,
      table.email,
    ),
    index('notification_recipients_lookup_idx').on(
      table.notificationType,
      table.organizationId,
      table.active,
    ),
  ],
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    notificationType: varchar('notification_type', { length: 60 }).notNull(),
    recipientOrganizationId: uuid('recipient_organization_id').references(() => organizations.id, {
      onDelete: 'restrict',
    }),
    itemId: uuid('item_id').references(() => authorizationItems.id, { onDelete: 'restrict' }),
    period: date('period'),
    itemSetHash: varchar('item_set_hash', { length: 64 }),
    templateVersion: integer('template_version').notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    recipients: jsonb('recipients').notNull(),
    params: jsonb('params').notNull(),
    payload: jsonb('payload').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('PENDIENTE'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    gmailMessageId: varchar('gmail_message_id', { length: 255 }),
    correlationId: uuid('correlation_id').notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 200 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('notifications_idempotency_key_idx').on(table.idempotencyKey),
    index('notifications_status_idx').on(table.status, table.createdAt),
    index('notifications_type_idx').on(table.notificationType, table.createdAt),
    check(
      'notifications_status_check',
      sql`${table.status} IN ('PENDIENTE', 'ENVIADO', 'FALLIDO', 'OMITIDO')`,
    ),
    check(
      'notifications_type_check',
      sql`${table.notificationType} IN ('AUTHORIZATION_READY_TO_DISPENSE', 'DISPENSATION_LOCATION_ASSIGNED', 'DISPENSATION_LOCATION_CHANGED', 'EPS_DIRECTION_PENDING', 'DAILY_OPERATIONAL_REPORT')`,
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
    status: varchar('status', { length: 20 }).notNull().default('EN_REVISION'),
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
      sql`${table.status} IN ('EN_REVISION', 'APROBADO', 'RECHAZADO')`,
    ),
    check('audit_reviews_review_number_check', sql`${table.reviewNumber} > 0`),
    check(
      'audit_reviews_decision_requires_fields_check',
      sql`${table.status} = 'EN_REVISION' OR (${table.decidedBy} IS NOT NULL AND ${table.decidedAt} IS NOT NULL)`,
    ),
    check(
      'audit_reviews_reject_requires_observations_check',
      sql`${table.status} <> 'RECHAZADO' OR ${table.observations} IS NOT NULL`,
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

export const pendingUserRequests = pgTable(
  'pending_user_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    oidcSubject: varchar('oidc_subject', { length: 255 }).notNull().unique(),
    email: varchar('email', { length: 320 }).notNull(),
    displayName: varchar('display_name', { length: 160 }),
    status: varchar('status', { length: 20 }).notNull().default('PENDIENTE'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: uuid('resolved_by'),
  },
  (table) => [
    index('pending_user_requests_status_idx').on(table.status),
    check(
      'pending_user_requests_status_check',
      sql`${table.status} IN ('PENDIENTE', 'APROBADO', 'RECHAZADO')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// SPEC-014 / ADR-024 — Anexo Tarifario: catálogo operativo administrado por MTD.
// ---------------------------------------------------------------------------

export const tariffAnnexProducts = pgTable(
  'tariff_annex_products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Normalizado con la misma regla de codigo_medicamento (COD_COMERCIAL). */
    codigoProducto: varchar('codigo_producto', { length: 255 }).notNull(),
    /** Desactivación lógica: nunca destruye la trazabilidad histórica. */
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
    // Unicidad total sobre el código normalizado: permite reactivar un
    // producto desactivado sin duplicar registros.
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
    status: varchar('status', { length: 30 }).notNull().default('CARGADO'),
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
    uniqueIndex('tariff_annex_imports_logical_key_idx').on(
      table.organizationId,
      table.sha256,
    ),
    check(
      'tariff_annex_imports_size_bytes_check',
      sql`${table.sizeBytes} > 0 AND ${table.sizeBytes} <= 20971520`,
    ),
    check(
      'tariff_annex_imports_status_check',
      sql`${table.status} IN ('CARGADO', 'VALIDANDO', 'COMPLETADO', 'FALLIDO')`,
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
    index('tariff_annex_import_rows_result_idx').on(table.importId, table.resultCode, table.rowNumber),
    check('tariff_annex_import_rows_row_number_check', sql`${table.rowNumber} > 0`),
    check(
      'tariff_annex_import_rows_result_code_check',
      sql`${table.resultCode} IN ('PRODUCT_CREATED', 'PRODUCT_REACTIVATED', 'PRODUCT_EXISTING', 'INVALID_PRODUCT_CODE', 'DUPLICATE_IN_FILE', 'INVALID_FILE_FORMAT', 'PROCESSING_ERROR')`,
    ),
  ],
);
