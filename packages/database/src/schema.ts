import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
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
    status: varchar('status', { length: 30 }).notNull().default('UPLOADED'),
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
    sourceCupsPrincipalNormalized: varchar('source_cups_principal_normalized', {
      length: 255,
    }).notNull(),
    enablementStatus: varchar('enablement_status', { length: 40 }).notNull(),
    coverageType: varchar('coverage_type', { length: 30 }).notNull(),
    directionStatus: varchar('direction_status', { length: 30 }).notNull(),
    operationStatus: varchar('operation_status', { length: 40 }),
    coverageRuleVersion: varchar('coverage_rule_version', { length: 40 }).notNull(),
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
    index('authorization_items_created_idx').on(table.createdAt, table.id),
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
      sql`${table.operationStatus} IS NULL OR ${table.operationStatus} IN ('BLOCKED', 'READY_TO_DISPENSE', 'DISPENSATION_REPORTED', 'DISPENSED')`,
    ),
    check(
      'authorization_items_ready_prerequisites_check',
      sql`${table.operationStatus} IS NULL OR ${table.operationStatus} <> 'READY_TO_DISPENSE' OR (
        ${table.enablementStatus} = 'ENABLED' AND (
          (${table.coverageType} = 'PBS' AND ${table.directionStatus} = 'NOT_APPLICABLE') OR
          (${table.coverageType} = 'NO_PBS' AND ${table.directionStatus} = 'CONFIRMED')
        )
      )`,
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
