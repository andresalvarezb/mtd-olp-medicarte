# Catálogo estructural de la base de datos — generado

> **Origen:** `packages/database/src/schema.ts` (Drizzle). **No demuestra que las migraciones estén aplicadas a un PostgreSQL concreto.**
> **Identificador de fuente SHA-256:** `53fe28f873644d0c88391777e127e7cd76edeba4d32ca857cc00b60488a01cc3`. Generador: `scripts/db-schema-catalog.mjs`.

**Tablas Drizzle:** 87. **Columnas:** 1112. **Referencias FK declaradas:** 232.

## Índice por proceso

| Proceso | Tablas |
| --- | ---: |
| Identidad, permisos y organizaciones | 8 |
| Autorizaciones y MIPRES | 7 |
| Planeación, programación y demanda | 8 |
| Órdenes de compra y entregas OLP | 6 |
| Recepciones MEDICARTE | 4 |
| Inventario, ubicaciones, reservas y traslados | 11 |
| Atención, dispensación y resultados | 7 |
| Anexo tarifario y productos | 6 |
| Auditoría y novedades | 9 |
| Conciliación operacional | 8 |
| Cargas masivas, jobs y eventos técnicos | 13 |

## Diccionario de tablas

### Identidad, permisos y organizaciones

#### `organizations`

**Columnas:** 6 · **Clave primaria:** id · **FK:** 0.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `code` | varchar(50) | No |  |
| `name` | varchar(160) | No |  |
| `drive_url` | varchar(2048) | Sí |  |
| `active` | boolean | No | default: true |
| `created_at` | timestamp | No | default: defaultNow() |

**Referenciada por:** `authorization_dispensations(organization_id)`; `authorization_fulfillments(organization_id)`; `authorization_item_organizations(organization_id)`; `authorization_mipres_decision_history(organization_id)`; `bulk_import_jobs(organization_id)`; `bulk_update_batches(organization_id)`; `dispensing_points(organization_id)`; `import_batches(organization_id)`; `inventory_allocation_batches(organization_id)`; `inventory_authorization_allocations(organization_id)`; `inventory_locations(organization_id)`; `operational_field_changes(organization_id)`; `outbox_events(organization_id)`; `patient_schedule_imports(organization_id)`; `reconciliation_issue_comments(tenant_id)`; `reconciliation_issue_events(tenant_id)`; `reconciliation_issues(tenant_id)`; `reconciliation_notifications(tenant_id)`; `reconciliation_operation_executions(tenant_id)`; `reconciliation_operation_policies(tenant_id)`; `reconciliation_runs(tenant_id)`; `role_organization_scopes(organization_id)`; `tariff_annex_imports(organization_id)`; `tariff_annex_products(organization_id)`; `user_organization_roles(organization_id)`.

#### `permissions`

**Columnas:** 3 · **Clave primaria:** id · **FK:** 0.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `code` | varchar(120) | No |  |
| `description` | text | No |  |

**Referenciada por:** `role_permissions(permission_id)`.

#### `role_organization_scopes`

**Columnas:** 3 · **Clave primaria:** role_id, organization_id · **FK:** 2.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `role_id` | uuid | No | PK; FK roles |
| `organization_id` | uuid | No | PK; FK organizations |
| `created_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `role_id → roles(id)`; `organization_id → organizations(id)`.

**Índices / unicidad declarados:** `role_organization_scopes_organization_idx` (index).

#### `role_permissions`

**Columnas:** 2 · **Clave primaria:** role_id, permission_id · **FK:** 2.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `role_id` | uuid | No | PK; FK roles |
| `permission_id` | uuid | No | PK; FK permissions |

**Claves foráneas:** `role_id → roles(id)`; `permission_id → permissions(id)`.

#### `roles`

**Columnas:** 6 · **Clave primaria:** id · **FK:** 0.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `code` | varchar(80) | No |  |
| `name` | varchar(160) | No |  |
| `is_system_admin` | boolean | No | default: false |
| `is_system_managed` | boolean | No | default: false |
| `active` | boolean | No | default: true |

**Referenciada por:** `role_organization_scopes(role_id)`; `role_permissions(role_id)`; `user_organization_roles(role_id)`.

#### `user_organization_roles`

**Columnas:** 5 · **Clave primaria:** user_id, organization_id, role_id · **FK:** 3.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `user_id` | uuid | No | PK; FK users |
| `organization_id` | uuid | No | PK; FK organizations |
| `role_id` | uuid | No | PK; FK roles |
| `active` | boolean | No | default: true |
| `created_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `user_id → users(id)`; `organization_id → organizations(id)`; `role_id → roles(id)`.

#### `user_point_scopes`

**Columnas:** 8 · **Clave primaria:** id · **FK:** 4.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `user_id` | uuid | No | FK users |
| `dispensing_point_id` | uuid | No | FK dispensing_points |
| `granted_by` | uuid | No | FK users |
| `granted_at` | timestamp | No | default: defaultNow() |
| `revoked_at` | timestamp | Sí |  |
| `revoked_by` | uuid | Sí | FK users |
| `created_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `user_id → users(id)`; `dispensing_point_id → dispensing_points(id)`; `granted_by → users(id)`; `revoked_by → users(id)`.

#### `users`

**Columnas:** 13 · **Clave primaria:** id · **FK:** 0.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `oidc_subject` | varchar(255) | Sí |  |
| `username` | varchar(160) | No |  |
| `email` | varchar(320) | Sí |  |
| `display_name` | varchar(160) | No |  |
| `password_hash` | text | Sí |  |
| `must_change_password` | boolean | No | default: false |
| `password_changed_at` | timestamp | Sí |  |
| `last_login_at` | timestamp | Sí |  |
| `active` | boolean | No | default: true |
| `provenance` | varchar(32) | No | default: 'UNKNOWN' |
| `created_at` | timestamp | No | default: defaultNow() |
| `updated_at` | timestamp | No | default: defaultNow() |

**Referenciada por:** `audit_findings(created_by)`; `audit_reviews(started_by)`; `audit_reviews(decided_by)`; `authorization_billing_audits(created_by)`; `authorization_billing_audits(audited_by)`; `authorization_dispensations(reported_by)`; `authorization_fulfillments(confirmed_by)`; `authorization_items(mipres_manual_updated_by)`; `authorization_items(annulled_by)`; `authorization_items(updated_by)`; `authorization_mipres_decision_history(actor_id)`; `bulk_import_jobs(created_by)`; `bulk_update_batches(created_by)`; `deliveries(dispatched_by)`; `deliveries(created_by)`; `deliveries(updated_by)`; `dispensing_points(created_by)`; `import_batches(created_by)`; `inventory_allocation_batches(created_by)`; `inventory_allocation_batches(confirmed_by)`; `inventory_authorization_allocations(created_by)`; `inventory_authorization_allocations(updated_by)`; `inventory_locations(created_by)`; `inventory_locations(updated_by)`; `inventory_movements(created_by)`; `novelties(created_by)`; `patient_application_audits(started_by)`; `patient_application_audits(decided_by)`; `patient_applications(created_by)`; `patient_applications(confirmed_by)`; `patient_default_dispensing_points(created_by)`; `patient_default_dispensing_points(updated_by)`; `patient_schedule_history(changed_by)`; `patient_schedule_imports(created_by)`; `patient_schedule_outcomes(created_by)`; `patient_schedules(created_by)`; `patient_schedules(updated_by)`; `planning_periods(created_by)`; `planning_periods(updated_by)`; `product_delivery_point_mappings(created_by)`; `product_delivery_point_mappings(updated_by)`; `projected_demand_lines(created_by)`; `projected_demand_lines(updated_by)`; `purchase_order_authorization_sources(released_by)`; `purchase_order_receipts(confirmed_by)`; `purchase_orders(legacy_assigned_by)`; `purchase_orders(issued_by)`; `purchase_orders(created_by)`; `purchase_orders(updated_by)`; `receipts(created_by)`; `receipts(updated_by)`; `reconciliation_issue_comments(author_user_id)`; `reconciliation_issue_events(actor_user_id)`; `reconciliation_issues(assigned_to_user_id)`; `reconciliation_issues(acknowledged_by)`; `reconciliation_issues(resolved_by)`; `reconciliation_issues(accepted_risk_by)`; `reconciliation_operation_policies(created_by)`; `reconciliation_operation_policies(updated_by)`; `reconciliation_runs(started_by)`; `stock_transfers(created_by)`; `stock_transfers(updated_by)`; `tariff_annex_imports(created_by)`; `tariff_annex_imports(confirmed_by)`; `tariff_annex_products(created_by)`; `tariff_annex_products(updated_by)`; `tariff_product_revisions(changed_by)`; `user_organization_roles(user_id)`; `user_point_scopes(user_id)`; `user_point_scopes(granted_by)`; `user_point_scopes(revoked_by)`.

**Índices / unicidad declarados:** `users_username_lower_unique` (uniqueIndex).

**Checks declarados:** `users_username_format_check`; `users_provenance_check`.

### Autorizaciones y MIPRES

#### `authorization_item_organizations`

**Columnas:** 3 · **Clave primaria:** authorization_item_id, organization_id · **FK:** 2.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `authorization_item_id` | uuid | No | PK; FK authorization_items |
| `organization_id` | uuid | No | PK; FK organizations |
| `created_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `authorization_item_id → authorization_items(id)`; `organization_id → organizations(id)`.

**Índices / unicidad declarados:** `authorization_item_organizations_org_idx` (index).

#### `authorization_items`

**Columnas:** 41 · **Clave primaria:** id · **FK:** 6.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `numero_autorizacion` | varchar(255) | No |  |
| `codigo_medicamento` | varchar(255) | No |  |
| `authorization_key` | varchar(511) | No |  |
| `process_status` | varchar(40) | Sí |  |
| `source_data` | jsonb | No |  |
| `source_status_normalized` | varchar(80) | No |  |
| `source_prescripcion_normalized` | varchar(255) | No | default: '' |
| `no_prescripcion` | varchar(255) | No | default: '' |
| `enablement_status` | varchar(40) | No |  |
| `coverage_type` | varchar(30) | No |  |
| `direction_status` | varchar(30) | No |  |
| `mipres_manual_decision` | varchar(30) | No | default: 'PENDING_MANUAL_ENABLEMENT' |
| `mipres_manual_version` | integer | No | default: 0 |
| `mipres_manual_concept_code` | varchar(80) | Sí | FK mipres_manual_decision_concepts |
| `mipres_manual_note` | text | Sí |  |
| `mipres_manual_updated_at` | timestamp | Sí |  |
| `mipres_manual_updated_by` | uuid | Sí | FK users |
| `operation_status` | varchar(40) | Sí |  |
| `coverage_rule_version` | varchar(40) | No |  |
| `lugar_dispensacion` | text | Sí |  |
| `fecha_programada` | date | Sí |  |
| `fecha_dispensacion` | date | Sí |  |
| `fecha_aplicacion` | date | Sí |  |
| `cod_autorizacion_medicarte` | varchar(255) | Sí |  |
| `orden_compra` | varchar(255) | Sí |  |
| `audit_status` | varchar(30) | No | default: 'NOT_STARTED' |
| `admission_status` | varchar(20) | No | default: 'NOT_READY' |
| `operational_version` | integer | No | default: 0 |
| `tariff_membership_status` | varchar(30) | No | default: 'NOT_EVALUATED' |
| `tariff_membership_evaluated_at` | timestamp | Sí |  |
| `tariff_rule_version` | varchar(40) | No | default: 'TARIFF-ANNEX-1' |
| `created_from_batch_id` | uuid | No | FK import_batches |
| `annulled_at` | timestamp | Sí |  |
| `annulled_by` | uuid | Sí | FK users |
| `annulment_reason` | text | Sí |  |
| `version` | integer | No | default: 1 |
| `updated_by` | uuid | Sí | FK users |
| `last_load_id` | uuid | Sí | FK import_batches |
| `created_at` | timestamp | No | default: defaultNow() |
| `updated_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `mipres_manual_concept_code → mipres_manual_decision_concepts(code)`; `mipres_manual_updated_by → users(id)`; `created_from_batch_id → import_batches(id)`; `annulled_by → users(id)`; `updated_by → users(id)`; `last_load_id → import_batches(id)`.

**Referenciada por:** `audit_reviews(authorization_item_id)`; `authorization_billing_audits(authorization_item_id)`; `authorization_dispensations(authorization_item_id)`; `authorization_fulfillments(authorization_item_id)`; `authorization_item_organizations(authorization_item_id)`; `authorization_mipres_decision_history(authorization_item_id)`; `authorization_tariff_snapshots(authorization_item_id)`; `bulk_update_rows(authorization_item_id)`; `coverage_evaluations(authorization_item_id)`; `demand_sources(authorization_item_id)`; `import_rows(authorization_item_id)`; `inventory_allocation_import_rows(resolved_authorization_item_id)`; `inventory_authorization_allocations(authorization_item_id)`; `mipres_checks(authorization_item_id)`; `mipres_directions(authorization_item_id)`; `novelties(authorization_item_id)`; `operational_field_changes(authorization_item_id)`; `patient_application_audits(authorization_item_id)`; `patient_applications(authorization_item_id)`; `patient_applications(authorization_item_id, commercial_code)`; `patient_schedule_history(authorization_item_id)`; `patient_schedule_history(authorization_item_id, commercial_code)`; `patient_schedule_import_rows(authorization_item_id)`; `patient_schedule_outcomes(authorization_item_id)`; `patient_schedules(authorization_item_id)`; `patient_schedules(authorization_item_id, commercial_code)`; `purchase_order_authorization_sources(authorization_item_id)`.

**Índices / unicidad declarados:** `authorization_items_identity_idx` (uniqueIndex); `authorization_items_id_code_unique` (unique); `authorization_items_authorization_key_idx` (uniqueIndex); `authorization_items_coverage_idx` (index); `authorization_items_mipres_manual_decision_idx` (index); `authorization_items_audit_status_idx` (index); `authorization_items_annulled_at_idx` (index); `authorization_items_created_idx` (index); `authorization_items_tariff_membership_idx` (index).

**Checks declarados:** `authorization_items_tariff_membership_status_check`; `authorization_items_enablement_status_check`; `authorization_items_coverage_type_check`; `authorization_items_direction_status_check`; `authorization_items_mipres_manual_version_check`; `authorization_items_mipres_manual_decision_check`; `authorization_items_mipres_manual_decision_concept_check`; `authorization_items_operation_status_check`; `authorization_items_process_status_check`; `authorization_items_audit_status_check`; `authorization_items_admission_status_check`; `authorization_items_admission_ready_requires_approval_check`; `authorization_items_dispensed_requires_approval_check`; `authorization_items_annulment_consistency_check`; `authorization_items_version_check`.

#### `authorization_mipres_decision_history`

**Columnas:** 11 · **Clave primaria:** id · **FK:** 4.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `authorization_item_id` | uuid | No | FK authorization_items |
| `previous_decision` | varchar(30) | No |  |
| `decision` | varchar(30) | No |  |
| `decision_version` | integer | No |  |
| `concept_code` | varchar(80) | Sí | FK mipres_manual_decision_concepts |
| `note` | text | Sí |  |
| `actor_id` | uuid | No | FK users |
| `organization_id` | uuid | No | FK organizations |
| `correlation_id` | uuid | No |  |
| `created_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `authorization_item_id → authorization_items(id)`; `concept_code → mipres_manual_decision_concepts(code)`; `actor_id → users(id)`; `organization_id → organizations(id)`.

**Índices / unicidad declarados:** `authorization_mipres_decision_history_item_idx` (index).

**Checks declarados:** `authorization_mipres_decision_history_previous_check`; `authorization_mipres_decision_history_decision_check`; `authorization_mipres_decision_history_concept_check`.

#### `coverage_evaluations`

**Columnas:** 8 · **Clave primaria:** id · **FK:** 1.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `authorization_item_id` | uuid | No | FK authorization_items |
| `evaluation_version` | integer | No |  |
| `source_value` | text | No |  |
| `normalized_value` | text | No |  |
| `coverage_type` | varchar(30) | No |  |
| `rule_version` | varchar(40) | No |  |
| `evaluated_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `authorization_item_id → authorization_items(id)`.

**Índices / unicidad declarados:** `coverage_evaluations_item_version_idx` (uniqueIndex).

**Checks declarados:** `coverage_evaluations_evaluation_version_check`; `coverage_evaluations_coverage_type_check`.

#### `mipres_checks`

**Columnas:** 14 · **Clave primaria:** id · **FK:** 1.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `authorization_item_id` | uuid | No | FK authorization_items |
| `prescription_number` | varchar(255) | No |  |
| `query_type` | varchar(10) | No |  |
| `outcome` | varchar(20) | No |  |
| `http_status` | integer | Sí |  |
| `direction_count` | integer | No | default: 0 |
| `has_current_direction` | boolean | Sí |  |
| `rule_version` | varchar(40) | No |  |
| `check_date` | date | No |  |
| `response_payload` | jsonb | Sí |  |
| `correlation_id` | uuid | No |  |
| `idempotency_key` | varchar(200) | No |  |
| `queried_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `authorization_item_id → authorization_items(id)`.

**Referenciada por:** `mipres_directions(mipres_check_id)`.

**Índices / unicidad declarados:** `mipres_checks_item_idx` (index); `mipres_checks_item_day_idx` (index).

**Checks declarados:** `mipres_checks_query_type_check`; `mipres_checks_outcome_check`; `mipres_checks_direction_count_check`.

#### `mipres_directions`

**Columnas:** 13 · **Clave primaria:** id · **FK:** 2.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `mipres_check_id` | uuid | No | FK mipres_checks |
| `authorization_item_id` | uuid | No | FK authorization_items |
| `external_id` | varchar(120) | No |  |
| `direction_id` | varchar(120) | No |  |
| `prescription_number` | varchar(255) | No |  |
| `technology_type` | varchar(40) | No |  |
| `technology_consecutive` | varchar(40) | No |  |
| `maximum_delivery_date` | date | No |  |
| `external_status` | varchar(80) | No |  |
| `annulled` | boolean | No |  |
| `current` | boolean | No |  |
| `created_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `mipres_check_id → mipres_checks(id)`; `authorization_item_id → authorization_items(id)`.

**Índices / unicidad declarados:** `mipres_directions_check_idx` (index); `mipres_directions_item_idx` (index).

#### `mipres_manual_decision_concepts`

**Columnas:** 8 · **Clave primaria:** code · **FK:** 0.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `code` | varchar(80) | No | PK |
| `name` | varchar(180) | No |  |
| `action` | varchar(20) | No |  |
| `requires_note` | boolean | No | default: false |
| `active` | boolean | No | default: true |
| `sort_order` | integer | No | default: 0 |
| `created_at` | timestamp | No | default: defaultNow() |
| `updated_at` | timestamp | No | default: defaultNow() |

**Referenciada por:** `authorization_items(mipres_manual_concept_code)`; `authorization_mipres_decision_history(concept_code)`.

**Checks declarados:** `mipres_manual_decision_concepts_action_check`; `mipres_manual_decision_concepts_code_not_blank_check`; `mipres_manual_decision_concepts_name_not_blank_check`.

### Planeación, programación y demanda

#### `demand_sources`

**Columnas:** 14 · **Clave primaria:** id · **FK:** 3.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `projected_demand_line_id` | uuid | No | FK projected_demand_lines; FK projected_demand_lines |
| `patient_schedule_id` | uuid | Sí |  |
| `schedule_revision` | integer | Sí |  |
| `authorization_item_id` | uuid | Sí | FK authorization_items |
| `loaded_at` | timestamp | Sí |  |
| `quantity` | integer | No |  |
| `planning_period_id` | uuid | No | FK projected_demand_lines |
| `dispensing_point_id` | uuid | Sí |  |
| `commercial_code` | varchar(255) | No | FK projected_demand_lines |
| `schedule_timing` | varchar(10) | No |  |
| `late_handling` | varchar(40) | Sí |  |
| `demand_bucket` | varchar(30) | No |  |
| `created_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `projected_demand_line_id → projected_demand_lines(id)`; `authorization_item_id → authorization_items(id)`; `projected_demand_line_id, planning_period_id, commercial_code → projected_demand_lines(id, planning_period_id, commercial_code)`.

**Índices / unicidad declarados:** `demand_sources_schedule_revision_idx` (uniqueIndex); `demand_sources_authorization_item_unique` (uniqueIndex); `demand_sources_demand_line_idx` (index).

**Checks declarados:** `demand_sources_schedule_revision_check`; `demand_sources_authorization_or_schedule_check`; `demand_sources_quantity_check`; `demand_sources_schedule_timing_check`; `demand_sources_late_handling_check`; `demand_sources_demand_bucket_check`.

#### `patient_schedule_history`

**Columnas:** 17 · **Clave primaria:** id · **FK:** 7.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `patient_schedule_id` | uuid | No | FK patient_schedules |
| `revision` | integer | No |  |
| `authorization_item_id` | uuid | No | FK authorization_items; FK authorization_items |
| `planning_period_id` | uuid | No | FK planning_periods |
| `dispensing_point_id` | uuid | No | FK dispensing_points |
| `commercial_code` | varchar(255) | No | FK authorization_items |
| `scheduled_date` | date | No |  |
| `quantity` | integer | No |  |
| `status` | varchar(20) | No |  |
| `schedule_timing` | varchar(10) | No | default: 'ON_TIME' |
| `late_handling` | varchar(40) | Sí |  |
| `deferred_planning_period_id` | uuid | Sí | FK planning_periods |
| `change_type` | varchar(30) | No |  |
| `changed_by` | uuid | No | FK users |
| `correlation_id` | uuid | No |  |
| `changed_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `patient_schedule_id → patient_schedules(id)`; `authorization_item_id → authorization_items(id)`; `planning_period_id → planning_periods(id)`; `dispensing_point_id → dispensing_points(id)`; `deferred_planning_period_id → planning_periods(id)`; `changed_by → users(id)`; `authorization_item_id, commercial_code → authorization_items(id, codigo_medicamento)`.

**Índices / unicidad declarados:** `patient_schedule_history_schedule_revision_unique` (unique); `patient_schedule_history_schedule_changed_idx` (index).

**Checks declarados:** `patient_schedule_history_revision_check`; `patient_schedule_history_quantity_check`; `patient_schedule_history_status_check`; `patient_schedule_history_schedule_timing_check`; `patient_schedule_history_late_handling_check`; `patient_schedule_history_late_handling_coherence_check`.

#### `patient_schedule_import_rows`

**Columnas:** 24 · **Clave primaria:** id · **FK:** 6.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `import_id` | uuid | No | FK patient_schedule_imports |
| `row_number` | integer | No |  |
| `raw_data` | jsonb | No |  |
| `normalized_data` | jsonb | Sí |  |
| `staging_status` | varchar(20) | No |  |
| `result_code` | varchar(80) | No |  |
| `result_message` | text | Sí |  |
| `patient_document` | varchar(80) | Sí |  |
| `authorization_number` | varchar(255) | Sí |  |
| `commercial_code` | varchar(255) | Sí |  |
| `quantity` | integer | Sí |  |
| `dispensing_point_code` | varchar(80) | Sí |  |
| `scheduled_date` | date | Sí |  |
| `authorization_item_id` | uuid | Sí | FK authorization_items |
| `planning_period_id` | uuid | Sí | FK planning_periods |
| `dispensing_point_id` | uuid | Sí | FK dispensing_points |
| `schedule_timing` | varchar(10) | Sí |  |
| `late_handling` | varchar(40) | Sí |  |
| `deferred_planning_period_id` | uuid | Sí | FK planning_periods |
| `confirmable` | boolean | No | default: false |
| `patient_schedule_id` | uuid | Sí | FK patient_schedules |
| `confirmed_at` | timestamp | Sí |  |
| `created_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `import_id → patient_schedule_imports(id)`; `authorization_item_id → authorization_items(id)`; `planning_period_id → planning_periods(id)`; `dispensing_point_id → dispensing_points(id)`; `deferred_planning_period_id → planning_periods(id)`; `patient_schedule_id → patient_schedules(id)`.

**Índices / unicidad declarados:** `patient_schedule_import_rows_import_row_unique` (unique); `patient_schedule_import_rows_status_idx` (index).

**Checks declarados:** `patient_schedule_import_rows_row_number_check`; `patient_schedule_import_rows_staging_status_check`; `patient_schedule_import_rows_result_code_check`; `patient_schedule_import_rows_quantity_check`.

#### `patient_schedule_import_source_files`

**Columnas:** 9 · **Clave primaria:** id · **FK:** 1.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `import_id` | uuid | No | FK patient_schedule_imports |
| `original_filename` | varchar(255) | No |  |
| `mime_type` | varchar(160) | No |  |
| `size_bytes` | integer | No |  |
| `sha256` | varchar(64) | No |  |
| `content` | bytea | Sí |  |
| `created_at` | timestamp | No | default: defaultNow() |
| `processed_at` | timestamp | Sí |  |

**Claves foráneas:** `import_id → patient_schedule_imports(id)`.

#### `patient_schedule_imports`

**Columnas:** 19 · **Clave primaria:** id · **FK:** 2.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `organization_id` | uuid | No | FK organizations |
| `created_by` | uuid | No | FK users |
| `original_filename` | varchar(255) | No |  |
| `mime_type` | varchar(160) | No |  |
| `size_bytes` | integer | No |  |
| `sha256` | varchar(64) | No |  |
| `status` | varchar(30) | No | default: 'UPLOADED' |
| `total_rows` | integer | No | default: 0 |
| `valid_rows` | integer | No | default: 0 |
| `invalid_rows` | integer | No | default: 0 |
| `duplicate_rows` | integer | No | default: 0 |
| `conflict_rows` | integer | No | default: 0 |
| `confirmed_rows` | integer | No | default: 0 |
| `correlation_id` | uuid | No |  |
| `last_error_code` | varchar(80) | Sí |  |
| `created_at` | timestamp | No | default: defaultNow() |
| `completed_at` | timestamp | Sí |  |
| `confirmed_at` | timestamp | Sí |  |

**Claves foráneas:** `organization_id → organizations(id)`; `created_by → users(id)`.

**Referenciada por:** `patient_schedule_import_rows(import_id)`; `patient_schedule_import_source_files(import_id)`.

**Índices / unicidad declarados:** `patient_schedule_imports_org_status_idx` (index).

**Checks declarados:** `patient_schedule_imports_size_bytes_check`; `patient_schedule_imports_status_check`; `patient_schedule_imports_total_rows_check`; `patient_schedule_imports_valid_rows_check`; `patient_schedule_imports_invalid_rows_check`; `patient_schedule_imports_duplicate_rows_check`; `patient_schedule_imports_conflict_rows_check`; `patient_schedule_imports_confirmed_rows_check`.

#### `patient_schedules`

**Columnas:** 16 · **Clave primaria:** id · **FK:** 7.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `authorization_item_id` | uuid | No | FK authorization_items; FK authorization_items |
| `planning_period_id` | uuid | No | FK planning_periods |
| `dispensing_point_id` | uuid | No | FK dispensing_points |
| `commercial_code` | varchar(255) | No | FK authorization_items |
| `scheduled_date` | date | No |  |
| `quantity` | integer | No |  |
| `status` | varchar(20) | No | default: 'SCHEDULED' |
| `schedule_timing` | varchar(10) | No | default: 'ON_TIME' |
| `late_handling` | varchar(40) | Sí |  |
| `deferred_planning_period_id` | uuid | Sí | FK planning_periods |
| `revision` | integer | No | default: 1 |
| `created_by` | uuid | No | FK users |
| `updated_by` | uuid | No | FK users |
| `created_at` | timestamp | No | default: defaultNow() |
| `updated_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `authorization_item_id → authorization_items(id)`; `planning_period_id → planning_periods(id)`; `dispensing_point_id → dispensing_points(id)`; `deferred_planning_period_id → planning_periods(id)`; `created_by → users(id)`; `updated_by → users(id)`; `authorization_item_id, commercial_code → authorization_items(id, codigo_medicamento)`.

**Referenciada por:** `patient_applications(patient_schedule_id)`; `patient_schedule_history(patient_schedule_id)`; `patient_schedule_import_rows(patient_schedule_id)`; `patient_schedule_outcomes(patient_schedule_id)`.

**Índices / unicidad declarados:** `patient_schedules_period_point_date_idx` (index); `patient_schedules_authorization_created_idx` (index); `patient_schedules_commercial_status_idx` (index); `patient_schedules_point_date_status_idx` (index); `patient_schedules_active_identity_idx` (uniqueIndex).

**Checks declarados:** `patient_schedules_commercial_code_not_blank_check`; `patient_schedules_quantity_check`; `patient_schedules_revision_check`; `patient_schedules_status_check`; `patient_schedules_schedule_timing_check`; `patient_schedules_late_handling_check`; `patient_schedules_late_handling_coherence_check`; `patient_schedules_deferred_period_check`.

#### `planning_periods`

**Columnas:** 12 · **Clave primaria:** id · **FK:** 2.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `start_date` | date | No |  |
| `end_date` | date | No |  |
| `scheduling_cutoff_at` | timestamp | No |  |
| `purchase_order_deadline_at` | timestamp | No |  |
| `expected_delivery_date` | date | No |  |
| `status` | varchar(30) | No | default: 'OPEN' |
| `version` | integer | No | default: 1 |
| `created_by` | uuid | No | FK users |
| `updated_by` | uuid | No | FK users |
| `created_at` | timestamp | No | default: defaultNow() |
| `updated_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `created_by → users(id)`; `updated_by → users(id)`.

**Referenciada por:** `patient_schedule_history(planning_period_id)`; `patient_schedule_history(deferred_planning_period_id)`; `patient_schedule_import_rows(planning_period_id)`; `patient_schedule_import_rows(deferred_planning_period_id)`; `patient_schedules(planning_period_id)`; `patient_schedules(deferred_planning_period_id)`; `projected_demand_lines(planning_period_id)`; `purchase_orders(planning_period_id)`.

**Índices / unicidad declarados:** `planning_periods_status_start_idx` (index).

**Checks declarados:** `planning_periods_date_range_check`; `planning_periods_deadline_order_check`; `planning_periods_delivery_after_purchase_check`; `planning_periods_version_check`; `planning_periods_status_check`.

#### `projected_demand_lines`

**Columnas:** 14 · **Clave primaria:** id · **FK:** 4.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `planning_period_id` | uuid | No | FK planning_periods |
| `dispensing_point_id` | uuid | Sí | FK dispensing_points |
| `commercial_code` | varchar(255) | No |  |
| `projected_quantity` | integer | No |  |
| `regular_quantity` | integer | No | default: 0 |
| `late_quantity` | integer | No | default: 0 |
| `status` | varchar(20) | No | default: 'OPEN' |
| `revision` | integer | No | default: 1 |
| `consolidated_at` | timestamp | Sí |  |
| `created_by` | uuid | No | FK users |
| `updated_by` | uuid | No | FK users |
| `created_at` | timestamp | No | default: defaultNow() |
| `updated_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `planning_period_id → planning_periods(id)`; `dispensing_point_id → dispensing_points(id)`; `created_by → users(id)`; `updated_by → users(id)`.

**Referenciada por:** `demand_sources(projected_demand_line_id)`; `demand_sources(projected_demand_line_id, planning_period_id, commercial_code)`.

**Índices / unicidad declarados:** `projected_demand_lines_identity_unique` (unique); `projected_demand_lines_live_period_code_unique` (uniqueIndex); `projected_demand_lines_source_identity_unique` (unique); `projected_demand_lines_period_status_idx` (index).

**Checks declarados:** `projected_demand_lines_commercial_code_not_blank_check`; `projected_demand_lines_quantity_check`; `projected_demand_lines_revision_check`; `projected_demand_lines_split_check`; `projected_demand_lines_split_nonnegative_check`; `projected_demand_lines_status_check`.

### Órdenes de compra y entregas OLP

#### `deliveries`

**Columnas:** 12 · **Clave primaria:** id · **FK:** 4.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `purchase_order_id` | uuid | No | FK purchase_orders |
| `supplier_reference` | varchar(255) | Sí |  |
| `status` | varchar(20) | No | default: 'DRAFT' |
| `dispatched_at` | timestamp | Sí |  |
| `dispatched_by` | uuid | Sí | FK users |
| `declared_dispatch_date` | date | Sí |  |
| `version` | integer | No | default: 1 |
| `created_by` | uuid | No | FK users |
| `updated_by` | uuid | No | FK users |
| `created_at` | timestamp | No | default: defaultNow() |
| `updated_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `purchase_order_id → purchase_orders(id)`; `dispatched_by → users(id)`; `created_by → users(id)`; `updated_by → users(id)`.

**Referenciada por:** `delivery_lines(delivery_id)`; `receipts(delivery_id)`.

**Índices / unicidad declarados:** `deliveries_order_status_idx` (index).

**Checks declarados:** `deliveries_status_check`; `deliveries_version_check`.

#### `delivery_lines`

**Columnas:** 9 · **Clave primaria:** id · **FK:** 3.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `delivery_id` | uuid | No | FK deliveries |
| `purchase_order_line_id` | uuid | No | FK purchase_order_lines |
| `commercial_code` | varchar(255) | No |  |
| `dispensing_point_id` | uuid | No | FK dispensing_points |
| `quantity` | integer | No |  |
| `lot_number` | varchar(255) | No |  |
| `expiration_date` | date | No |  |
| `created_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `delivery_id → deliveries(id)`; `purchase_order_line_id → purchase_order_lines(id)`; `dispensing_point_id → dispensing_points(id)`.

**Referenciada por:** `receipt_lines(delivery_line_id)`.

**Índices / unicidad declarados:** `delivery_lines_delivery_idx` (index); `delivery_lines_order_line_idx` (index).

**Checks declarados:** `delivery_lines_quantity_check`.

#### `purchase_order_authorization_sources`

**Columnas:** 10 · **Clave primaria:** purchase_order_line_id, authorization_item_id · **FK:** 3.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `purchase_order_line_id` | uuid | No | PK; FK purchase_order_lines |
| `authorization_item_id` | uuid | No | PK; FK authorization_items |
| `projected_demand_line_id` | uuid | Sí |  |
| `projected_demand_revision` | integer | Sí |  |
| `source_quantity_snapshot` | integer | No |  |
| `provenance` | varchar(40) | No | default: 'LIVE_DEMAND' |
| `evidence_at` | timestamp | Sí |  |
| `released_at` | timestamp | Sí |  |
| `released_by` | uuid | Sí | FK users |
| `created_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `purchase_order_line_id → purchase_order_lines(id)`; `authorization_item_id → authorization_items(id)`; `released_by → users(id)`.

**Índices / unicidad declarados:** `purchase_order_authorization_sources_authorization_idx` (index); `purchase_order_authorization_sources_active_auth_idx` (index); `purchase_order_authorization_sources_demand_idx` (index).

**Checks declarados:** `purchase_order_authorization_sources_provenance_check`; `purchase_order_authorization_sources_origin_shape_check`; `purchase_order_authorization_sources_release_consistency_check`; `purchase_order_authorization_sources_quantity_check`.

#### `purchase_order_demand_allocations`

**Columnas:** 5 · **Clave primaria:** purchase_order_line_id, projected_demand_line_id, projected_demand_revision, demand_bucket · **FK:** 1.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `purchase_order_line_id` | uuid | No | PK; FK purchase_order_lines |
| `projected_demand_line_id` | uuid | No | PK |
| `projected_demand_revision` | integer | No | PK |
| `demand_bucket` | varchar(20) | No | PK |
| `allocated_quantity` | integer | No |  |

**Claves foráneas:** `purchase_order_line_id → purchase_order_lines(id)`.

**Checks declarados:** `purchase_order_demand_allocations_quantity_check`; `purchase_order_demand_allocations_bucket_check`.

#### `purchase_order_lines`

**Columnas:** 20 · **Clave primaria:** id · **FK:** 2.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `purchase_order_id` | uuid | No | FK purchase_orders |
| `commercial_code` | varchar(255) | No |  |
| `provenance` | varchar(40) | No | default: 'LIVE_DEMAND' |
| `product_description` | text | Sí |  |
| `presentation` | text | Sí |  |
| `dispensing_point_id` | uuid | Sí | FK dispensing_points |
| `requested_quantity` | integer | No |  |
| `olp_managed_quantity` | integer | Sí |  |
| `accepted_quantity` | integer | Sí |  |
| `requested_delivery_date` | date | Sí |  |
| `compensar_unit_rate_snapshot` | varchar(255) | Sí |  |
| `tariff_snapshot_provenance` | varchar(40) | No | default: 'LIVE_SNAPSHOT' |
| `legacy_tariff_revision_id` | uuid | Sí |  |
| `supplier_unit_cost` | varchar(255) | Sí |  |
| `projected_demand_line_id` | uuid | Sí |  |
| `projected_demand_revision` | integer | Sí |  |
| `demand_bucket` | varchar(20) | Sí |  |
| `created_at` | timestamp | No | default: defaultNow() |
| `updated_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `purchase_order_id → purchase_orders(id)`; `dispensing_point_id → dispensing_points(id)`.

**Referenciada por:** `delivery_lines(purchase_order_line_id)`; `purchase_order_authorization_sources(purchase_order_line_id)`; `purchase_order_demand_allocations(purchase_order_line_id)`; `purchase_order_receipt_lines(purchase_order_line_id)`.

**Índices / unicidad declarados:** `purchase_order_lines_order_idx` (index); `purchase_order_lines_demand_idx` (index).

**Checks declarados:** `purchase_order_lines_requested_quantity_check`; `purchase_order_lines_olp_managed_quantity_check`; `purchase_order_lines_accepted_quantity_check`; `purchase_order_lines_provenance_check`; `purchase_order_lines_tariff_provenance_check`; `purchase_order_lines_origin_shape_check`; `purchase_order_lines_supplier_cost_check`.

#### `purchase_orders`

**Columnas:** 18 · **Clave primaria:** id · **FK:** 5.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `purchase_order_code` | varchar(255) | Sí |  |
| `origin` | varchar(30) | No | default: 'OPERATIONAL' |
| `legacy_assigned_at` | timestamp | Sí |  |
| `legacy_assigned_by` | uuid | Sí | FK users |
| `planning_period_id` | uuid | Sí | FK planning_periods |
| `order_type` | varchar(20) | Sí |  |
| `status` | varchar(30) | No | default: 'DRAFT' |
| `version` | integer | No | default: 1 |
| `issued_at` | timestamp | Sí |  |
| `issued_by` | uuid | Sí | FK users |
| `olp_accepted_at` | timestamp | Sí |  |
| `olp_accepted_by` | uuid | Sí |  |
| `olp_committed_date` | date | Sí |  |
| `created_by` | uuid | No | FK users |
| `updated_by` | uuid | No | FK users |
| `created_at` | timestamp | No | default: defaultNow() |
| `updated_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `legacy_assigned_by → users(id)`; `planning_period_id → planning_periods(id)`; `issued_by → users(id)`; `created_by → users(id)`; `updated_by → users(id)`.

**Referenciada por:** `authorization_fulfillment_lines(purchase_order_id)`; `deliveries(purchase_order_id)`; `inventory_allocation_import_rows(resolved_purchase_order_id)`; `inventory_authorization_allocations(purchase_order_id)`; `purchase_order_lines(purchase_order_id)`; `purchase_order_receipts(purchase_order_id)`.

**Índices / unicidad declarados:** `purchase_orders_period_status_idx` (index); `purchase_orders_code_idx` (uniqueIndex).

**Checks declarados:** `purchase_orders_origin_check`; `purchase_orders_type_check`; `purchase_orders_status_check`; `purchase_orders_version_check`; `purchase_orders_origin_shape_check`.

### Recepciones MEDICARTE

#### `purchase_order_receipt_lines`

**Columnas:** 9 · **Clave primaria:** id · **FK:** 2.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `receipt_id` | uuid | No | FK purchase_order_receipts |
| `purchase_order_line_id` | uuid | No | FK purchase_order_lines |
| `outcome` | varchar(30) | No |  |
| `received_quantity` | integer | No |  |
| `lot_number` | varchar(255) | Sí |  |
| `expiration_date` | date | Sí |  |
| `observation` | text | Sí |  |
| `created_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `receipt_id → purchase_order_receipts(id)`; `purchase_order_line_id → purchase_order_lines(id)`.

**Índices / unicidad declarados:** `purchase_order_receipt_lines_receipt_line_unique` (uniqueIndex); `purchase_order_receipt_lines_po_line_idx` (index).

**Checks declarados:** `purchase_order_receipt_lines_outcome_check`; `purchase_order_receipt_lines_quantity_check`; `purchase_order_receipt_lines_evidence_check`.

#### `purchase_order_receipts`

**Columnas:** 7 · **Clave primaria:** id · **FK:** 2.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `purchase_order_id` | uuid | No | FK purchase_orders |
| `received_at` | timestamp | No | default: defaultNow() |
| `confirmed_at` | timestamp | No | default: defaultNow() |
| `confirmed_by` | uuid | No | FK users |
| `observation` | text | Sí |  |
| `created_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `purchase_order_id → purchase_orders(id)`; `confirmed_by → users(id)`.

**Referenciada por:** `purchase_order_receipt_lines(receipt_id)`.

**Índices / unicidad declarados:** `purchase_order_receipts_order_idx` (index).

#### `receipt_lines`

**Columnas:** 15 · **Clave primaria:** id · **FK:** 2.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `receipt_id` | uuid | No | FK receipts |
| `delivery_line_id` | uuid | No | FK delivery_lines |
| `dispatched_quantity` | integer | No |  |
| `received_quantity` | integer | No |  |
| `accepted_quantity` | integer | No |  |
| `rejected_quantity` | integer | No |  |
| `shortage_quantity` | integer | No |  |
| `expected_lot_number` | varchar(255) | No |  |
| `expected_expiration_date` | date | No |  |
| `received_lot_number` | varchar(255) | Sí |  |
| `received_expiration_date` | date | Sí |  |
| `conformity` | varchar(30) | Sí |  |
| `nonconformity_reason` | varchar(40) | Sí |  |
| `observation` | text | Sí |  |

**Claves foráneas:** `receipt_id → receipts(id)`; `delivery_line_id → delivery_lines(id)`.

**Índices / unicidad declarados:** `receipt_lines_receipt_delivery_line_idx` (uniqueIndex).

**Checks declarados:** `receipt_lines_quantities_check`.

#### `receipts`

**Columnas:** 11 · **Clave primaria:** id · **FK:** 3.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `delivery_id` | uuid | No | FK deliveries |
| `status` | varchar(20) | No | default: 'DRAFT' |
| `conformity` | varchar(30) | Sí |  |
| `received_at` | timestamp | No | default: defaultNow() |
| `confirmed_at` | timestamp | Sí |  |
| `created_by` | uuid | No | FK users |
| `updated_by` | uuid | No | FK users |
| `version` | integer | No | default: 1 |
| `created_at` | timestamp | No | default: defaultNow() |
| `updated_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `delivery_id → deliveries(id)`; `created_by → users(id)`; `updated_by → users(id)`.

**Referenciada por:** `receipt_lines(receipt_id)`.

**Índices / unicidad declarados:** `receipts_delivery_idx` (index).

**Checks declarados:** `receipts_status_check`; `receipts_conformity_check`.

### Inventario, ubicaciones, reservas y traslados

#### `dispensing_points`

**Columnas:** 7 · **Clave primaria:** id · **FK:** 2.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `organization_id` | uuid | No | FK organizations |
| `code` | varchar(80) | No |  |
| `name` | varchar(160) | No |  |
| `active` | boolean | No | default: true |
| `created_by` | uuid | No | FK users |
| `created_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `organization_id → organizations(id)`; `created_by → users(id)`.

**Referenciada por:** `authorization_fulfillment_lines(dispensing_point_id)`; `delivery_lines(dispensing_point_id)`; `inventory_authorization_allocations(dispensing_point_id)`; `inventory_locations(legacy_dispensing_point_id)`; `inventory_lots(dispensing_point_id)`; `patient_application_lines(dispensing_point_id)`; `patient_applications(dispensing_point_id)`; `patient_default_dispensing_points(dispensing_point_id)`; `patient_schedule_history(dispensing_point_id)`; `patient_schedule_import_rows(dispensing_point_id)`; `patient_schedule_outcome_lines(dispensing_point_id)`; `patient_schedules(dispensing_point_id)`; `product_delivery_point_mappings(dispensing_point_id)`; `projected_demand_lines(dispensing_point_id)`; `purchase_order_lines(dispensing_point_id)`; `stock_transfers(source_dispensing_point_id)`; `stock_transfers(destination_dispensing_point_id)`; `user_point_scopes(dispensing_point_id)`.

**Índices / unicidad declarados:** `dispensing_points_organization_code_idx` (uniqueIndex); `dispensing_points_active_idx` (index).

**Checks declarados:** `dispensing_points_code_not_blank_check`; `dispensing_points_name_not_blank_check`.

#### `inventory_allocation_batches`

**Columnas:** 16 · **Clave primaria:** id · **FK:** 4.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `organization_id` | uuid | No | FK organizations |
| `source` | varchar(10) | No |  |
| `import_batch_id` | uuid | Sí | FK import_batches |
| `status` | varchar(20) | No | default: 'PREPARED' |
| `total_rows` | integer | No | default: 0 |
| `valid_rows` | integer | No | default: 0 |
| `invalid_rows` | integer | No | default: 0 |
| `allocated_quantity` | integer | No | default: 0 |
| `version` | integer | No | default: 1 |
| `correlation_id` | uuid | No |  |
| `created_by` | uuid | No | FK users |
| `confirmed_by` | uuid | Sí | FK users |
| `created_at` | timestamp | No | default: defaultNow() |
| `confirmed_at` | timestamp | Sí |  |
| `cancelled_at` | timestamp | Sí |  |

**Claves foráneas:** `organization_id → organizations(id)`; `import_batch_id → import_batches(id)`; `created_by → users(id)`; `confirmed_by → users(id)`.

**Referenciada por:** `inventory_allocation_import_rows(batch_id)`; `inventory_authorization_allocations(batch_id)`.

**Índices / unicidad declarados:** `inventory_allocation_batches_org_status_idx` (index); `inventory_allocation_batches_import_idx` (index).

**Checks declarados:** `inventory_allocation_batches_source_check`; `inventory_allocation_batches_status_check`; `inventory_allocation_batches_quantity_check`; `inventory_allocation_batches_version_check`.

#### `inventory_allocation_import_rows`

**Columnas:** 17 · **Clave primaria:** id · **FK:** 3.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `batch_id` | uuid | No | FK inventory_allocation_batches |
| `row_number` | integer | No |  |
| `authorization_key` | varchar(511) | No |  |
| `purchase_order_code` | varchar(255) | No |  |
| `requested_quantity` | integer | No |  |
| `resolved_authorization_item_id` | uuid | Sí | FK authorization_items |
| `resolved_purchase_order_id` | uuid | Sí | FK purchase_orders |
| `commercial_code` | varchar(255) | Sí |  |
| `expected_authorization_version` | integer | Sí |  |
| `validation_status` | varchar(10) | No |  |
| `execution_status` | varchar(10) | No | default: 'PENDING' |
| `error_code` | varchar(100) | Sí |  |
| `error_message` | text | Sí |  |
| `raw_payload` | jsonb | No |  |
| `created_at` | timestamp | No | default: defaultNow() |
| `executed_at` | timestamp | Sí |  |

**Claves foráneas:** `batch_id → inventory_allocation_batches(id)`; `resolved_authorization_item_id → authorization_items(id)`; `resolved_purchase_order_id → purchase_orders(id)`.

**Referenciada por:** `inventory_authorization_allocations(source_import_row_id)`.

**Índices / unicidad declarados:** `inventory_allocation_import_rows_batch_row_unique` (unique); `inventory_allocation_import_rows_batch_idx` (index); `inventory_allocation_import_rows_authorization_idx` (index); `inventory_allocation_import_rows_purchase_order_idx` (index).

**Checks declarados:** `inventory_allocation_import_rows_quantity_check`; `inventory_allocation_import_rows_validation_check`; `inventory_allocation_import_rows_execution_check`.

#### `inventory_authorization_allocations`

**Columnas:** 17 · **Clave primaria:** id · **FK:** 8.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `batch_id` | uuid | No | FK inventory_allocation_batches |
| `source_import_row_id` | uuid | Sí | FK inventory_allocation_import_rows |
| `organization_id` | uuid | No | FK organizations |
| `authorization_item_id` | uuid | No | FK authorization_items |
| `purchase_order_id` | uuid | No | FK purchase_orders |
| `commercial_code` | varchar(255) | No |  |
| `dispensing_point_id` | uuid | No | FK dispensing_points |
| `allocated_quantity` | integer | No |  |
| `consumed_quantity` | integer | No | default: 0 |
| `released_quantity` | integer | No | default: 0 |
| `status` | varchar(30) | No | default: 'ALLOCATED' |
| `authorization_version` | integer | No |  |
| `created_by` | uuid | No | FK users |
| `updated_by` | uuid | No | FK users |
| `created_at` | timestamp | No | default: defaultNow() |
| `updated_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `batch_id → inventory_allocation_batches(id)`; `source_import_row_id → inventory_allocation_import_rows(id)`; `organization_id → organizations(id)`; `authorization_item_id → authorization_items(id)`; `purchase_order_id → purchase_orders(id)`; `dispensing_point_id → dispensing_points(id)`; `created_by → users(id)`; `updated_by → users(id)`.

**Referenciada por:** `authorization_fulfillment_lines(inventory_authorization_allocation_id)`.

**Índices / unicidad declarados:** `inventory_authorization_allocations_auth_idx` (index); `inventory_authorization_allocations_oc_product_idx` (index); `inventory_authorization_allocations_product_point_idx` (index).

**Checks declarados:** `inventory_authorization_allocations_quantity_check`; `inventory_authorization_allocations_status_check`; `inventory_authorization_allocations_version_check`.

#### `inventory_locations`

**Columnas:** 10 · **Clave primaria:** id · **FK:** 4.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `organization_id` | uuid | No | FK organizations |
| `code` | varchar(80) | No |  |
| `name` | varchar(160) | No |  |
| `active` | boolean | No | default: true |
| `legacy_dispensing_point_id` | uuid | Sí | FK dispensing_points |
| `created_by` | uuid | No | FK users |
| `updated_by` | uuid | No | FK users |
| `created_at` | timestamp | No | default: defaultNow() |
| `updated_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `organization_id → organizations(id)`; `legacy_dispensing_point_id → dispensing_points(id)`; `created_by → users(id)`; `updated_by → users(id)`.

**Referenciada por:** `inventory_lots(inventory_location_id)`; `inventory_lots(inventory_location_id, dispensing_point_id)`.

**Índices / unicidad declarados:** `inventory_locations_organization_code_idx` (uniqueIndex); `inventory_locations_legacy_point_idx` (uniqueIndex); `inventory_locations_id_legacy_point_idx` (uniqueIndex); `inventory_locations_active_idx` (index).

**Checks declarados:** `inventory_locations_code_not_blank_check`; `inventory_locations_name_not_blank_check`.

#### `inventory_lots`

**Columnas:** 7 · **Clave primaria:** id · **FK:** 3.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `commercial_code` | varchar(255) | No |  |
| `inventory_location_id` | uuid | Sí | FK inventory_locations; FK inventory_locations |
| `dispensing_point_id` | uuid | No | FK dispensing_points; FK inventory_locations |
| `lot_number` | varchar(255) | No |  |
| `expiration_date` | date | No |  |
| `created_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `inventory_location_id → inventory_locations(id)`; `dispensing_point_id → dispensing_points(id)`; `inventory_location_id, dispensing_point_id → inventory_locations(id, legacy_dispensing_point_id)`.

**Referenciada por:** `authorization_fulfillment_lines(inventory_lot_id)`; `inventory_movements(inventory_lot_id)`; `patient_application_lines(inventory_lot_id)`; `patient_schedule_outcome_lines(inventory_lot_id)`; `stock_transfer_lines(source_inventory_lot_id)`.

**Índices / unicidad declarados:** `inventory_lots_location_identity_unique` (uniqueIndex); `inventory_lots_identity_unique` (unique); `inventory_lots_location_product_idx` (index); `inventory_lots_point_product_idx` (index).

**Checks declarados:** `inventory_lots_commercial_code_check`; `inventory_lots_number_check`.

#### `inventory_movements`

**Columnas:** 10 · **Clave primaria:** id · **FK:** 2.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `inventory_lot_id` | uuid | No | FK inventory_lots |
| `movement_type` | varchar(30) | No |  |
| `quantity_delta` | integer | No |  |
| `source_type` | varchar(40) | No |  |
| `source_id` | uuid | No |  |
| `occurred_at` | timestamp | No |  |
| `created_by` | uuid | Sí | FK users |
| `metadata` | jsonb | Sí |  |
| `created_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `inventory_lot_id → inventory_lots(id)`; `created_by → users(id)`.

**Índices / unicidad declarados:** `inventory_movements_source_semantics_unique` (unique); `inventory_movements_lot_occurred_idx` (index).

**Checks declarados:** `inventory_movements_type_check`; `inventory_movements_quantity_delta_check`; `inventory_movements_source_type_check`; `inventory_movements_receipt_delta_check`; `inventory_movements_application_delta_check`; `inventory_movements_fulfillment_delta_check`.

#### `patient_default_dispensing_points`

**Columnas:** 8 · **Clave primaria:** id · **FK:** 3.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `patient_document` | varchar(80) | No |  |
| `dispensing_point_id` | uuid | No | FK dispensing_points |
| `active` | boolean | No | default: true |
| `created_by` | uuid | No | FK users |
| `updated_by` | uuid | No | FK users |
| `created_at` | timestamp | No | default: defaultNow() |
| `updated_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `dispensing_point_id → dispensing_points(id)`; `created_by → users(id)`; `updated_by → users(id)`.

**Índices / unicidad declarados:** `patient_default_dispensing_points_document_unique` (uniqueIndex); `patient_default_dispensing_points_active_idx` (index).

**Checks declarados:** `patient_default_dispensing_points_document_not_blank`.

#### `product_delivery_point_mappings`

**Columnas:** 12 · **Clave primaria:** id · **FK:** 3.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `invima_record_normalized` | varchar(255) | No |  |
| `invima_presentation_normalized` | varchar(255) | No |  |
| `source_cum_code` | varchar(255) | No |  |
| `service_model` | varchar(255) | Sí |  |
| `source_site_name` | varchar(160) | No |  |
| `dispensing_point_id` | uuid | No | FK dispensing_points |
| `version` | integer | No | default: 1 |
| `created_by` | uuid | No | FK users |
| `updated_by` | uuid | No | FK users |
| `created_at` | timestamp | No | default: defaultNow() |
| `updated_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `dispensing_point_id → dispensing_points(id)`; `created_by → users(id)`; `updated_by → users(id)`.

**Índices / unicidad declarados:** `product_delivery_point_mappings_identity_unique` (unique); `product_delivery_point_mappings_point_idx` (index); `product_delivery_point_mappings_identity_idx` (index).

**Checks declarados:** `product_delivery_point_mappings_record_check`; `product_delivery_point_mappings_presentation_check`; `product_delivery_point_mappings_cum_check`; `product_delivery_point_mappings_site_check`; `product_delivery_point_mappings_version_check`.

#### `stock_transfer_lines`

**Columnas:** 7 · **Clave primaria:** id · **FK:** 2.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `stock_transfer_id` | uuid | No | FK stock_transfers |
| `source_inventory_lot_id` | uuid | No | FK inventory_lots |
| `commercial_code` | varchar(255) | No |  |
| `lot_number` | varchar(255) | No |  |
| `expiration_date` | date | No |  |
| `quantity` | integer | No |  |

**Claves foráneas:** `stock_transfer_id → stock_transfers(id)`; `source_inventory_lot_id → inventory_lots(id)`.

**Índices / unicidad declarados:** `stock_transfer_lines_transfer_idx` (index).

**Checks declarados:** `stock_transfer_lines_quantity_check`.

#### `stock_transfers`

**Columnas:** 11 · **Clave primaria:** id · **FK:** 4.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `source_dispensing_point_id` | uuid | No | FK dispensing_points |
| `destination_dispensing_point_id` | uuid | No | FK dispensing_points |
| `status` | varchar(20) | No | default: 'CREATED' |
| `dispatched_at` | timestamp | Sí |  |
| `received_at` | timestamp | Sí |  |
| `version` | integer | No | default: 1 |
| `created_by` | uuid | No | FK users |
| `updated_by` | uuid | No | FK users |
| `created_at` | timestamp | No | default: defaultNow() |
| `updated_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `source_dispensing_point_id → dispensing_points(id)`; `destination_dispensing_point_id → dispensing_points(id)`; `created_by → users(id)`; `updated_by → users(id)`.

**Referenciada por:** `stock_transfer_lines(stock_transfer_id)`.

**Índices / unicidad declarados:** `stock_transfers_status_created_idx` (index).

**Checks declarados:** `stock_transfers_points_different_check`; `stock_transfers_status_check`; `stock_transfers_version_check`.

### Atención, dispensación y resultados

#### `authorization_dispensations`

**Columnas:** 9 · **Clave primaria:** id · **FK:** 3.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `organization_id` | uuid | No | FK organizations |
| `authorization_item_id` | uuid | No | FK authorization_items |
| `dispensation_date` | date | No |  |
| `source` | varchar(10) | No | default: 'XLSX' |
| `reported_by` | uuid | No | FK users |
| `reported_at` | timestamp | No | default: defaultNow() |
| `created_at` | timestamp | No | default: defaultNow() |
| `updated_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `organization_id → organizations(id)`; `authorization_item_id → authorization_items(id)`; `reported_by → users(id)`.

**Índices / unicidad declarados:** `authorization_dispensations_authorization_unique` (unique); `authorization_dispensations_org_date_idx` (index); `authorization_dispensations_authorization_idx` (index).

**Checks declarados:** `authorization_dispensations_source_check`.

#### `authorization_fulfillment_lines`

**Columnas:** 10 · **Clave primaria:** id · **FK:** 5.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `fulfillment_id` | uuid | No | FK authorization_fulfillments |
| `inventory_authorization_allocation_id` | uuid | No | FK inventory_authorization_allocations |
| `purchase_order_id` | uuid | No | FK purchase_orders |
| `inventory_lot_id` | uuid | Sí | FK inventory_lots |
| `commercial_code` | varchar(255) | No |  |
| `dispensing_point_id` | uuid | No | FK dispensing_points |
| `lot_number` | varchar(255) | Sí |  |
| `expiration_date` | date | Sí |  |
| `quantity` | integer | No |  |

**Claves foráneas:** `fulfillment_id → authorization_fulfillments(id)`; `inventory_authorization_allocation_id → inventory_authorization_allocations(id)`; `purchase_order_id → purchase_orders(id)`; `inventory_lot_id → inventory_lots(id)`; `dispensing_point_id → dispensing_points(id)`.

**Índices / unicidad declarados:** `authorization_fulfillment_lines_fulfillment_idx` (index); `authorization_fulfillment_lines_allocation_idx` (index); `authorization_fulfillment_lines_lot_unique` (uniqueIndex); `authorization_fulfillment_lines_direct_unique` (uniqueIndex).

**Checks declarados:** `authorization_fulfillment_lines_quantity_check`; `authorization_fulfillment_lines_evidence_check`.

#### `authorization_fulfillments`

**Columnas:** 10 · **Clave primaria:** id · **FK:** 3.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `organization_id` | uuid | No | FK organizations |
| `authorization_item_id` | uuid | No | FK authorization_items |
| `fulfillment_type` | varchar(20) | No |  |
| `effective_date` | date | No |  |
| `quantity` | integer | No |  |
| `source` | varchar(10) | No | default: 'UI' |
| `confirmed_by` | uuid | No | FK users |
| `confirmed_at` | timestamp | No | default: defaultNow() |
| `created_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `organization_id → organizations(id)`; `authorization_item_id → authorization_items(id)`; `confirmed_by → users(id)`.

**Referenciada por:** `audit_reviews(authorization_fulfillment_id)`; `authorization_fulfillment_lines(fulfillment_id)`.

**Índices / unicidad declarados:** `authorization_fulfillments_authorization_idx` (index); `authorization_fulfillments_effective_idx` (index).

**Checks declarados:** `authorization_fulfillments_type_check`; `authorization_fulfillments_quantity_check`; `authorization_fulfillments_source_check`.

#### `patient_application_lines`

**Columnas:** 10 · **Clave primaria:** id · **FK:** 3.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `patient_application_id` | uuid | No | FK patient_applications |
| `inventory_lot_id` | uuid | No | FK inventory_lots |
| `commercial_code` | varchar(255) | No |  |
| `dispensing_point_id` | uuid | No | FK dispensing_points |
| `lot_number` | varchar(255) | No |  |
| `expiration_date` | date | No |  |
| `quantity` | integer | No |  |
| `fefo_override` | boolean | No | default: false |
| `fefo_override_reason` | varchar(500) | Sí |  |

**Claves foráneas:** `patient_application_id → patient_applications(id)`; `inventory_lot_id → inventory_lots(id)`; `dispensing_point_id → dispensing_points(id)`.

**Índices / unicidad declarados:** `patient_application_lines_application_idx` (index); `patient_application_lines_lot_unique` (unique).

**Checks declarados:** `patient_application_lines_quantity_check`; `patient_application_lines_override_check`.

#### `patient_applications`

**Columnas:** 15 · **Clave primaria:** id · **FK:** 6.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `patient_schedule_id` | uuid | No | FK patient_schedules |
| `schedule_revision` | integer | No |  |
| `authorization_item_id` | uuid | No | FK authorization_items; FK authorization_items |
| `commercial_code` | varchar(255) | No | FK authorization_items |
| `dispensing_point_id` | uuid | No | FK dispensing_points |
| `scheduled_date` | date | No |  |
| `application_date` | date | No |  |
| `status` | varchar(20) | No | default: 'DRAFT' |
| `version` | integer | No | default: 1 |
| `created_by` | uuid | No | FK users |
| `confirmed_by` | uuid | Sí | FK users |
| `created_at` | timestamp | No | default: defaultNow() |
| `updated_at` | timestamp | No | default: defaultNow() |
| `confirmed_at` | timestamp | Sí |  |

**Claves foráneas:** `patient_schedule_id → patient_schedules(id)`; `authorization_item_id → authorization_items(id)`; `dispensing_point_id → dispensing_points(id)`; `created_by → users(id)`; `confirmed_by → users(id)`; `authorization_item_id, commercial_code → authorization_items(id, codigo_medicamento)`.

**Referenciada por:** `patient_application_audits(patient_application_id)`; `patient_application_lines(patient_application_id)`.

**Índices / unicidad declarados:** `patient_applications_active_schedule_idx` (uniqueIndex); `patient_applications_status_created_idx` (index).

**Checks declarados:** `patient_applications_schedule_revision_check`; `patient_applications_version_check`; `patient_applications_status_check`.

#### `patient_schedule_outcome_lines`

**Columnas:** 8 · **Clave primaria:** id · **FK:** 3.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `outcome_id` | uuid | No | FK patient_schedule_outcomes |
| `inventory_lot_id` | uuid | No | FK inventory_lots |
| `commercial_code` | varchar(255) | No |  |
| `dispensing_point_id` | uuid | No | FK dispensing_points |
| `lot_number` | varchar(255) | No |  |
| `expiration_date` | date | No |  |
| `quantity` | integer | No |  |

**Claves foráneas:** `outcome_id → patient_schedule_outcomes(id)`; `inventory_lot_id → inventory_lots(id)`; `dispensing_point_id → dispensing_points(id)`.

**Índices / unicidad declarados:** `patient_schedule_outcome_lines_outcome_idx` (index); `patient_schedule_outcome_lines_lot_unique` (unique).

**Checks declarados:** `patient_schedule_outcome_lines_quantity_check`.

#### `patient_schedule_outcomes`

**Columnas:** 11 · **Clave primaria:** id · **FK:** 3.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `patient_schedule_id` | uuid | No | FK patient_schedules |
| `schedule_revision` | integer | No |  |
| `authorization_item_id` | uuid | No | FK authorization_items |
| `outcome` | varchar(20) | No |  |
| `novelty_code` | varchar(40) | No |  |
| `occurred_on` | date | No |  |
| `observation` | varchar(1000) | Sí |  |
| `prepared_product_disposition` | varchar(20) | No |  |
| `created_by` | uuid | No | FK users |
| `created_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `patient_schedule_id → patient_schedules(id)`; `authorization_item_id → authorization_items(id)`; `created_by → users(id)`.

**Referenciada por:** `patient_schedule_outcome_lines(outcome_id)`.

**Índices / unicidad declarados:** `patient_schedule_outcomes_schedule_revision_unique` (unique); `patient_schedule_outcomes_created_idx` (index).

**Checks declarados:** `patient_schedule_outcomes_revision_check`; `patient_schedule_outcomes_outcome_check`; `patient_schedule_outcomes_novelty_check`; `patient_schedule_outcomes_disposition_check`; `patient_schedule_outcomes_other_observation_check`.

### Anexo tarifario y productos

#### `authorization_tariff_snapshots`

**Columnas:** 14 · **Clave primaria:** id · **FK:** 4.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `authorization_item_id` | uuid | No | FK authorization_items |
| `product_id` | uuid | Sí | FK tariff_annex_products |
| `product_revision_id` | uuid | Sí | FK tariff_product_revisions |
| `import_id` | uuid | Sí | FK tariff_annex_imports |
| `codigo_producto` | varchar(255) | No |  |
| `status` | varchar(20) | No | default: 'UNRESOLVED' |
| `tarifa_unidad_raw` | text | Sí |  |
| `tarifa_unidad_canonical` | numeric(18,4) | Sí |  |
| `tipo_inclusion` | varchar(100) | Sí |  |
| `minimum_quantity` | integer | Sí |  |
| `snapshot_at` | timestamp | No | default: defaultNow() |
| `provenance` | text | No |  |
| `unresolved_reason` | text | Sí |  |

**Claves foráneas:** `authorization_item_id → authorization_items(id)`; `product_id → tariff_annex_products(id)`; `product_revision_id → tariff_product_revisions(id)`; `import_id → tariff_annex_imports(id)`.

**Índices / unicidad declarados:** `authorization_tariff_snapshots_item_unique` (unique); `authorization_tariff_snapshots_import_idx` (index).

**Checks declarados:** `authorization_tariff_snapshots_status_check`; `authorization_tariff_snapshots_minimum_quantity_check`.

#### `tariff_annex_import_rows`

**Columnas:** 13 · **Clave primaria:** id · **FK:** 2.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `import_id` | uuid | No | FK tariff_annex_imports |
| `row_number` | integer | No |  |
| `raw_data` | jsonb | No |  |
| `codigo_producto` | varchar(255) | Sí |  |
| `result_code` | varchar(80) | No |  |
| `result_message` | text | No |  |
| `product_id` | uuid | Sí | FK tariff_annex_products |
| `tarifa_unidad_raw` | text | Sí |  |
| `tarifa_unidad_canonical` | numeric(18,4) | Sí |  |
| `anomaly_code` | varchar(80) | Sí |  |
| `provenance` | jsonb | Sí |  |
| `created_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `import_id → tariff_annex_imports(id)`; `product_id → tariff_annex_products(id)`.

**Referenciada por:** `tariff_product_revisions(import_row_id)`.

**Índices / unicidad declarados:** `tariff_annex_import_rows_import_row_unique` (unique); `tariff_annex_import_rows_result_idx` (index).

**Checks declarados:** `tariff_annex_import_rows_row_number_check`; `tariff_annex_import_rows_result_code_check`.

#### `tariff_annex_import_source_files`

**Columnas:** 9 · **Clave primaria:** id · **FK:** 1.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `import_id` | uuid | No | FK tariff_annex_imports |
| `original_filename` | varchar(255) | No |  |
| `mime_type` | varchar(160) | No |  |
| `size_bytes` | integer | No |  |
| `sha256` | varchar(64) | No |  |
| `content` | bytea | Sí |  |
| `created_at` | timestamp | No | default: defaultNow() |
| `processed_at` | timestamp | Sí |  |

**Claves foráneas:** `import_id → tariff_annex_imports(id)`.

**Índices / unicidad declarados:** `tariff_annex_import_source_files_import_idx` (uniqueIndex).

**Checks declarados:** `tariff_annex_import_source_files_size_bytes_check`.

#### `tariff_annex_imports`

**Columnas:** 30 · **Clave primaria:** id · **FK:** 3.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `organization_id` | uuid | No | FK organizations |
| `created_by` | uuid | No | FK users |
| `original_filename` | varchar(255) | No |  |
| `mime_type` | varchar(160) | No |  |
| `size_bytes` | integer | No |  |
| `sha256` | varchar(64) | No |  |
| `status` | varchar(30) | No | default: 'UPLOADED' |
| `preview` | jsonb | Sí |  |
| `preview_total` | integer | No | default: 0 |
| `preview_unchanged` | integer | No | default: 0 |
| `preview_changed` | integer | No | default: 0 |
| `preview_anomalous` | integer | No | default: 0 |
| `preview_rejected` | integer | No | default: 0 |
| `preview_scale_pattern_detected` | boolean | No | default: false |
| `total_rows` | integer | No | default: 0 |
| `created_rows` | integer | No | default: 0 |
| `reactivated_rows` | integer | No | default: 0 |
| `existing_rows` | integer | No | default: 0 |
| `rejected_rows` | integer | No | default: 0 |
| `duplicate_rows` | integer | No | default: 0 |
| `last_error_code` | varchar(80) | Sí |  |
| `correlation_id` | uuid | No |  |
| `idempotency_key` | varchar(200) | No |  |
| `confirmed_at` | timestamp | Sí |  |
| `confirmed_by` | uuid | Sí | FK users |
| `override_reason` | text | Sí |  |
| `created_at` | timestamp | No | default: defaultNow() |
| `started_at` | timestamp | Sí |  |
| `completed_at` | timestamp | Sí |  |

**Claves foráneas:** `organization_id → organizations(id)`; `created_by → users(id)`; `confirmed_by → users(id)`.

**Referenciada por:** `authorization_tariff_snapshots(import_id)`; `novelties(tariff_annex_import_id)`; `tariff_annex_import_rows(import_id)`; `tariff_annex_import_source_files(import_id)`; `tariff_product_revisions(import_id)`.

**Índices / unicidad declarados:** `tariff_annex_imports_org_idx` (index); `tariff_annex_imports_logical_key_idx` (uniqueIndex).

**Checks declarados:** `tariff_annex_imports_size_bytes_check`; `tariff_annex_imports_status_check`; `tariff_annex_imports_preview_total_check`; `tariff_annex_imports_preview_unchanged_check`; `tariff_annex_imports_preview_changed_check`; `tariff_annex_imports_preview_anomalous_check`; `tariff_annex_imports_preview_rejected_check`; `tariff_annex_imports_preview_consistency_check`; `tariff_annex_imports_confirmation_check`; `tariff_annex_imports_anomaly_override_check`.

#### `tariff_annex_products`

**Columnas:** 18 · **Clave primaria:** id · **FK:** 3.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `codigo_producto` | varchar(255) | No |  |
| `tarifa_unidad` | varchar(255) | Sí |  |
| `tarifa_unidad_canonical` | numeric(18,4) | Sí |  |
| `numero_expediente_invima` | varchar(255) | Sí |  |
| `consecutivo_invima_presentacion` | varchar(255) | Sí |  |
| `descripcion_generica` | text | Sí |  |
| `descripcion_comercial` | text | Sí |  |
| `laboratorio` | varchar(500) | Sí |  |
| `tipo_inclusion` | varchar(100) | Sí |  |
| `minimum_quantity` | integer | No | default: 1 |
| `active` | boolean | No | default: true |
| `organization_id` | uuid | No | FK organizations |
| `created_by` | uuid | No | FK users |
| `updated_by` | uuid | Sí | FK users |
| `version` | integer | No | default: 1 |
| `created_at` | timestamp | No | default: defaultNow() |
| `updated_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `organization_id → organizations(id)`; `created_by → users(id)`; `updated_by → users(id)`.

**Referenciada por:** `authorization_tariff_snapshots(product_id)`; `tariff_annex_import_rows(product_id)`; `tariff_product_revisions(product_id)`.

**Índices / unicidad declarados:** `tariff_annex_products_code_idx` (uniqueIndex); `tariff_annex_products_active_idx` (index).

**Checks declarados:** `tariff_annex_products_version_check`; `tariff_annex_products_code_length_check`; `tariff_annex_products_minimum_quantity_check`.

#### `tariff_product_revisions`

**Columnas:** 15 · **Clave primaria:** id · **FK:** 4.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `product_id` | uuid | No | FK tariff_annex_products |
| `codigo_producto` | varchar(255) | No |  |
| `revision` | integer | No |  |
| `import_id` | uuid | Sí | FK tariff_annex_imports |
| `import_row_id` | uuid | Sí | FK tariff_annex_import_rows |
| `tarifa_unidad_raw` | text | Sí |  |
| `tarifa_unidad_canonical` | numeric(18,4) | Sí |  |
| `tipo_inclusion` | varchar(100) | Sí |  |
| `minimum_quantity` | integer | No | default: 1 |
| `commercial_snapshot` | jsonb | No |  |
| `valid_from` | timestamp | No |  |
| `valid_to` | timestamp | Sí |  |
| `changed_by` | uuid | Sí | FK users |
| `provenance` | text | No |  |

**Claves foráneas:** `product_id → tariff_annex_products(id)`; `import_id → tariff_annex_imports(id)`; `import_row_id → tariff_annex_import_rows(id)`; `changed_by → users(id)`.

**Referenciada por:** `authorization_tariff_snapshots(product_revision_id)`.

**Índices / unicidad declarados:** `tariff_product_revisions_product_revision_unique` (unique); `tariff_product_revisions_code_idx` (index).

**Checks declarados:** `tariff_product_revisions_minimum_quantity_check`.

### Auditoría y novedades

#### `audit_events`

**Columnas:** 15 · **Clave primaria:** id · **FK:** 0.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `occurred_at` | timestamp | No | default: defaultNow() |
| `actor_type` | varchar(30) | No |  |
| `actor_id` | uuid | Sí |  |
| `organization_id` | uuid | Sí |  |
| `action` | varchar(120) | No |  |
| `resource_type` | varchar(120) | No |  |
| `resource_id` | varchar(255) | No |  |
| `before` | jsonb | Sí |  |
| `after` | jsonb | Sí |  |
| `correlation_id` | uuid | No |  |
| `request_id` | varchar(255) | Sí |  |
| `ip_address` | varchar(64) | Sí |  |
| `user_agent` | text | Sí |  |
| `result` | varchar(40) | No |  |

**Índices / unicidad declarados:** `audit_events_resource_idx` (index).

#### `audit_findings`

**Columnas:** 7 · **Clave primaria:** id · **FK:** 2.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `audit_review_id` | uuid | No | FK audit_reviews |
| `code` | varchar(80) | No |  |
| `description` | text | No |  |
| `created_by` | uuid | No | FK users |
| `correlation_id` | uuid | No |  |
| `created_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `audit_review_id → audit_reviews(id)`; `created_by → users(id)`.

**Índices / unicidad declarados:** `audit_findings_review_idx` (index).

#### `audit_reviews`

**Columnas:** 12 · **Clave primaria:** id · **FK:** 4.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `authorization_item_id` | uuid | No | FK authorization_items |
| `authorization_fulfillment_id` | uuid | Sí | FK authorization_fulfillments |
| `review_number` | integer | No |  |
| `status` | varchar(20) | No | default: 'IN_REVIEW' |
| `observations` | text | Sí |  |
| `started_by` | uuid | No | FK users |
| `started_at` | timestamp | No | default: defaultNow() |
| `decided_by` | uuid | Sí | FK users |
| `decided_at` | timestamp | Sí |  |
| `correlation_id` | uuid | No |  |
| `created_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `authorization_item_id → authorization_items(id)`; `authorization_fulfillment_id → authorization_fulfillments(id)`; `started_by → users(id)`; `decided_by → users(id)`.

**Referenciada por:** `audit_findings(audit_review_id)`.

**Índices / unicidad declarados:** `audit_reviews_item_number_idx` (uniqueIndex); `audit_reviews_authorization_fulfillment_unique` (uniqueIndex); `audit_reviews_authorization_fulfillment_status_idx` (index); `audit_reviews_item_status_idx` (index).

**Checks declarados:** `audit_reviews_status_check`; `audit_reviews_review_number_check`; `audit_reviews_decision_requires_fields_check`; `audit_reviews_reject_requires_observations_check`.

#### `authorization_billing_audit_evidence`

**Columnas:** 11 · **Clave primaria:** id · **FK:** 1.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `billing_audit_id` | uuid | No | FK authorization_billing_audits |
| `drive_file_id` | varchar(255) | No |  |
| `file_name` | text | No |  |
| `mime_type` | varchar(255) | Sí |  |
| `web_view_link` | text | Sí |  |
| `size_bytes` | numeric(20,0) | Sí |  |
| `md5_checksum` | varchar(64) | Sí |  |
| `drive_modified_at` | timestamp | Sí |  |
| `discovered_at` | timestamp | No | default: defaultNow() |
| `created_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `billing_audit_id → authorization_billing_audits(id)`.

**Índices / unicidad declarados:** `authorization_billing_audit_evidence_audit_drive_unique` (uniqueIndex); `authorization_billing_audit_evidence_audit_idx` (index).

**Checks declarados:** `authorization_billing_audit_evidence_drive_file_not_blank_check`; `authorization_billing_audit_evidence_file_name_not_blank_check`; `authorization_billing_audit_evidence_size_check`.

#### `authorization_billing_audits`

**Columnas:** 11 · **Clave primaria:** id · **FK:** 3.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `authorization_item_id` | uuid | No | FK authorization_items |
| `status` | varchar(20) | No | default: 'PENDING' |
| `result` | varchar(30) | Sí |  |
| `observation` | text | Sí |  |
| `created_by` | uuid | No | FK users |
| `created_at` | timestamp | No | default: defaultNow() |
| `audited_by` | uuid | Sí | FK users |
| `audited_at` | timestamp | Sí |  |
| `correlation_id` | uuid | No |  |
| `updated_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `authorization_item_id → authorization_items(id)`; `created_by → users(id)`; `audited_by → users(id)`.

**Referenciada por:** `authorization_billing_audit_evidence(billing_audit_id)`.

**Índices / unicidad declarados:** `authorization_billing_audits_authorization_unique` (uniqueIndex); `authorization_billing_audits_status_created_idx` (index).

**Checks declarados:** `authorization_billing_audits_status_check`; `authorization_billing_audits_result_check`; `authorization_billing_audits_state_check`; `authorization_billing_audits_non_compliance_observation_check`.

#### `novelties`

**Columnas:** 17 · **Clave primaria:** id · **FK:** 6.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `authorization_item_id` | uuid | Sí | FK authorization_items |
| `import_batch_id` | uuid | Sí | FK import_batches |
| `bulk_update_batch_id` | uuid | Sí | FK bulk_update_batches |
| `tariff_annex_import_id` | uuid | Sí | FK tariff_annex_imports |
| `source_row_number` | integer | Sí |  |
| `original_row` | jsonb | No |  |
| `code` | varchar(30) | No | FK novelty_codes |
| `stage` | varchar(60) | No |  |
| `field` | varchar(160) | Sí |  |
| `logical_key` | varchar(500) | No |  |
| `received_value` | text | Sí |  |
| `description` | text | No |  |
| `active` | boolean | No | default: true |
| `attempt_number` | integer | No | default: 1 |
| `created_by` | uuid | Sí | FK users |
| `processed_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `authorization_item_id → authorization_items(id)`; `import_batch_id → import_batches(id)`; `bulk_update_batch_id → bulk_update_batches(id)`; `tariff_annex_import_id → tariff_annex_imports(id)`; `code → novelty_codes(code)`; `created_by → users(id)`.

**Índices / unicidad declarados:** `novelties_item_active_idx` (index); `novelties_code_idx` (index); `novelties_batch_idx` (index); `novelties_attempt_idx` (index); `novelties_logical_idx` (index); `novelties_logical_attempt_idx` (index); `novelties_logical_active_idx` (index).

**Checks declarados:** `novelties_attempt_number_check`.

#### `novelty_codes`

**Columnas:** 7 · **Clave primaria:** code · **FK:** 0.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `code` | varchar(30) | No | PK |
| `stage` | varchar(60) | No |  |
| `field` | varchar(160) | Sí |  |
| `description` | text | No |  |
| `error_type` | varchar(32) | No |  |
| `active` | boolean | No | default: true |
| `created_at` | timestamp | No | default: defaultNow() |

**Referenciada por:** `novelties(code)`.

#### `operational_field_changes`

**Columnas:** 16 · **Clave primaria:** id · **FK:** 2.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `authorization_item_id` | uuid | No | FK authorization_items |
| `field_name` | varchar(120) | No |  |
| `previous_value` | text | Sí |  |
| `new_value` | text | No |  |
| `previous_operational_version` | integer | No |  |
| `new_operational_version` | integer | No |  |
| `operation_type` | varchar(40) | No |  |
| `bulk_update_batch_id` | uuid | Sí |  |
| `bulk_update_row_id` | uuid | Sí |  |
| `actor_type` | varchar(30) | No |  |
| `actor_id` | uuid | Sí |  |
| `organization_id` | uuid | Sí | FK organizations |
| `correlation_id` | uuid | No |  |
| `idempotency_key` | varchar(200) | No |  |
| `created_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `authorization_item_id → authorization_items(id)`; `organization_id → organizations(id)`.

**Índices / unicidad declarados:** `operational_field_changes_item_idx` (index).

**Checks declarados:** `operational_field_changes_version_check`.

#### `patient_application_audits`

**Columnas:** 15 · **Clave primaria:** id · **FK:** 4.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `patient_application_id` | uuid | No | FK patient_applications |
| `application_revision` | integer | No |  |
| `authorization_item_id` | uuid | No | FK authorization_items |
| `status` | varchar(20) | No | default: 'IN_REVIEW' |
| `started_at` | timestamp | No | default: defaultNow() |
| `started_by` | uuid | No | FK users |
| `decided_at` | timestamp | Sí |  |
| `decided_by` | uuid | Sí | FK users |
| `rejection_code` | varchar(40) | Sí |  |
| `observation` | varchar(1000) | Sí |  |
| `evidence_reference` | varchar(1000) | Sí |  |
| `version` | integer | No | default: 1 |
| `created_at` | timestamp | No | default: defaultNow() |
| `updated_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `patient_application_id → patient_applications(id)`; `authorization_item_id → authorization_items(id)`; `started_by → users(id)`; `decided_by → users(id)`.

**Índices / unicidad declarados:** `patient_application_audits_application_unique` (unique); `patient_application_audits_status_date_idx` (index); `patient_application_audits_authorization_idx` (index).

**Checks declarados:** `patient_application_audits_revision_check`; `patient_application_audits_status_check`; `patient_application_audits_version_check`; `patient_application_audits_decision_fields_check`; `patient_application_audits_rejection_code_check`; `patient_application_audits_other_observation_check`; `patient_application_audits_non_rejection_fields_check`.

### Conciliación operacional

#### `reconciliation_findings`

**Columnas:** 20 · **Clave primaria:** id · **FK:** 1.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `reconciliation_run_id` | uuid | No | FK reconciliation_runs |
| `rule_code` | varchar(40) | No |  |
| `rule_version` | varchar(40) | No |  |
| `category` | varchar(20) | No |  |
| `severity` | varchar(20) | No |  |
| `domain` | varchar(20) | No |  |
| `entity_type` | varchar(80) | No |  |
| `entity_id` | uuid | Sí |  |
| `related_entity_type` | varchar(80) | Sí |  |
| `related_entity_id` | uuid | Sí |  |
| `dispensing_point_id` | uuid | Sí |  |
| `planning_period_id` | uuid | Sí |  |
| `commercial_code` | varchar(255) | Sí |  |
| `message` | text | No |  |
| `evidence_json` | jsonb | No | default: sql''{}'::jsonb' |
| `fingerprint` | varchar(200) | No |  |
| `truncated` | boolean | No | default: false |
| `detected_at` | timestamp | No | default: defaultNow() |
| `issue_id` | uuid | No |  |

**Claves foráneas:** `reconciliation_run_id → reconciliation_runs(id)`.

**Índices / unicidad declarados:** `reconciliation_findings_run_rule_fingerprint_unique` (unique); `reconciliation_findings_run_severity_idx` (index); `reconciliation_findings_run_rule_idx` (index); `reconciliation_findings_run_domain_idx` (index); `reconciliation_findings_issue_detected_idx` (index).

**Checks declarados:** `reconciliation_findings_category_check`; `reconciliation_findings_severity_check`; `reconciliation_findings_rule_code_check`; `reconciliation_findings_message_check`.

#### `reconciliation_issue_comments`

**Columnas:** 7 · **Clave primaria:** id · **FK:** 3.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `issue_id` | uuid | No | FK reconciliation_issues |
| `tenant_id` | uuid | No | FK organizations |
| `author_user_id` | uuid | No | FK users |
| `body` | text | No |  |
| `created_at` | timestamp | No | default: defaultNow() |
| `edited_at` | timestamp | Sí |  |

**Claves foráneas:** `issue_id → reconciliation_issues(id)`; `tenant_id → organizations(id)`; `author_user_id → users(id)`.

**Índices / unicidad declarados:** `reconciliation_issue_comments_issue_created_idx` (index).

**Checks declarados:** `reconciliation_issue_comments_body_check`.

#### `reconciliation_issue_events`

**Columnas:** 11 · **Clave primaria:** id · **FK:** 4.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `issue_id` | uuid | No | FK reconciliation_issues |
| `tenant_id` | uuid | No | FK organizations |
| `event_type` | varchar(40) | No |  |
| `from_status` | varchar(20) | Sí |  |
| `to_status` | varchar(20) | Sí |  |
| `actor_user_id` | uuid | Sí | FK users |
| `reconciliation_run_id` | uuid | Sí | FK reconciliation_runs |
| `finding_id` | uuid | Sí |  |
| `metadata_json` | jsonb | No | default: sql''{}'::jsonb' |
| `created_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `issue_id → reconciliation_issues(id)`; `tenant_id → organizations(id)`; `actor_user_id → users(id)`; `reconciliation_run_id → reconciliation_runs(id)`.

**Índices / unicidad declarados:** `reconciliation_issue_events_issue_created_idx` (index).

#### `reconciliation_issues`

**Columnas:** 33 · **Clave primaria:** id · **FK:** 7.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `tenant_id` | uuid | No | FK organizations |
| `rule_code` | varchar(40) | No |  |
| `fingerprint` | varchar(200) | No |  |
| `domain` | varchar(20) | No |  |
| `category` | varchar(20) | No |  |
| `status` | varchar(20) | No | default: 'OPEN' |
| `current_severity` | varchar(20) | No |  |
| `max_severity_seen` | varchar(20) | No |  |
| `first_seen_at` | timestamp | No |  |
| `last_seen_at` | timestamp | No |  |
| `occurrence_count` | integer | No | default: 1 |
| `first_run_id` | uuid | No | FK reconciliation_runs |
| `last_run_id` | uuid | No | FK reconciliation_runs |
| `last_finding_id` | uuid | Sí |  |
| `first_rule_version` | varchar(40) | No |  |
| `last_rule_version` | varchar(40) | No |  |
| `assigned_to_user_id` | uuid | Sí | FK users |
| `acknowledged_at` | timestamp | Sí |  |
| `acknowledged_by` | uuid | Sí | FK users |
| `resolved_at` | timestamp | Sí |  |
| `resolved_by` | uuid | Sí | FK users |
| `resolution_code` | varchar(40) | Sí |  |
| `resolution_note` | text | Sí |  |
| `accepted_risk_at` | timestamp | Sí |  |
| `accepted_risk_by` | uuid | Sí | FK users |
| `accepted_risk_reason` | text | Sí |  |
| `accepted_risk_severity` | varchar(20) | Sí |  |
| `accepted_risk_rule_version` | varchar(40) | Sí |  |
| `risk_review_at` | timestamp | Sí |  |
| `version` | integer | No | default: 1 |
| `created_at` | timestamp | No | default: defaultNow() |
| `updated_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `tenant_id → organizations(id)`; `first_run_id → reconciliation_runs(id)`; `last_run_id → reconciliation_runs(id)`; `assigned_to_user_id → users(id)`; `acknowledged_by → users(id)`; `resolved_by → users(id)`; `accepted_risk_by → users(id)`.

**Referenciada por:** `reconciliation_issue_comments(issue_id)`; `reconciliation_issue_events(issue_id)`.

**Índices / unicidad declarados:** `reconciliation_issues_identity_unique` (unique); `reconciliation_issues_tenant_status_idx` (index); `reconciliation_issues_tenant_severity_idx` (index); `reconciliation_issues_tenant_assigned_idx` (index); `reconciliation_issues_tenant_rule_idx` (index); `reconciliation_issues_tenant_last_seen_idx` (index).

**Checks declarados:** `reconciliation_issues_status_check`; `reconciliation_issues_occurrence_check`; `reconciliation_issues_version_check`.

#### `reconciliation_notifications`

**Columnas:** 16 · **Clave primaria:** id · **FK:** 3.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `tenant_id` | uuid | No | FK organizations |
| `execution_id` | uuid | Sí | FK reconciliation_operation_executions |
| `reconciliation_run_id` | uuid | Sí | FK reconciliation_runs |
| `notification_type` | varchar(40) | No |  |
| `severity` | varchar(20) | No |  |
| `dedup_key` | varchar(200) | No |  |
| `status` | varchar(20) | No | default: 'SENT' |
| `channel` | varchar(20) | No | default: 'IN_APP' |
| `payload_json` | jsonb | No | default: sql''{}'::jsonb' |
| `attempt_count` | integer | No | default: 0 |
| `read_at` | timestamp | Sí |  |
| `sent_at` | timestamp | Sí |  |
| `last_error_code` | varchar(80) | Sí |  |
| `created_at` | timestamp | No | default: defaultNow() |
| `updated_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `tenant_id → organizations(id)`; `execution_id → reconciliation_operation_executions(id)`; `reconciliation_run_id → reconciliation_runs(id)`.

**Índices / unicidad declarados:** `reconciliation_notifications_tenant_created_idx` (index); `reconciliation_notifications_tenant_unread_idx` (index).

**Checks declarados:** `reconciliation_notifications_type_check`; `reconciliation_notifications_severity_check`; `reconciliation_notifications_status_check`; `reconciliation_notifications_channel_check`.

#### `reconciliation_operation_executions`

**Columnas:** 19 · **Clave primaria:** id · **FK:** 2.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `tenant_id` | uuid | No | FK organizations |
| `policy_id` | uuid | Sí | FK reconciliation_operation_policies |
| `trigger_type` | varchar(20) | No | default: 'SCHEDULED' |
| `scheduled_for` | timestamp | Sí |  |
| `claimed_at` | timestamp | Sí |  |
| `started_at` | timestamp | Sí |  |
| `completed_at` | timestamp | Sí |  |
| `status` | varchar(20) | No | default: 'PENDING' |
| `attempt_count` | integer | No | default: 0 |
| `claim_token` | varchar(100) | Sí |  |
| `claim_generation` | integer | No | default: 0 |
| `lease_expires_at` | timestamp | Sí |  |
| `last_error_code` | varchar(80) | Sí |  |
| `last_error_message` | text | Sí |  |
| `missed_occurrences_count` | integer | No | default: 0 |
| `skip_reason` | varchar(80) | Sí |  |
| `created_at` | timestamp | No | default: defaultNow() |
| `updated_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `tenant_id → organizations(id)`; `policy_id → reconciliation_operation_policies(id)`.

**Referenciada por:** `reconciliation_notifications(execution_id)`; `reconciliation_runs(operation_execution_id)`.

**Índices / unicidad declarados:** `reconciliation_operation_executions_scheduled_unique` (unique); `reconciliation_operation_executions_tenant_status_idx` (index); `reconciliation_operation_executions_lease_idx` (index).

**Checks declarados:** `reconciliation_operation_executions_trigger_check`; `reconciliation_operation_executions_status_check`.

#### `reconciliation_operation_policies`

**Columnas:** 18 · **Clave primaria:** id · **FK:** 3.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `tenant_id` | uuid | No | FK organizations |
| `enabled` | boolean | No | default: false |
| `cadence` | varchar(20) | No | default: 'DAILY' |
| `timezone` | varchar(80) | No | default: 'America/Bogota' |
| `local_time` | varchar(10) | Sí | default: '02:00' |
| `weekday` | integer | Sí |  |
| `domains` | jsonb | Sí |  |
| `planning_period_scope` | varchar(40) | Sí |  |
| `severity_alert_threshold` | varchar(20) | No | default: 'ERROR' |
| `notify_on_recovery` | boolean | No | default: true |
| `notify_on_technical_failure` | boolean | No | default: true |
| `next_run_at` | timestamp | Sí |  |
| `created_by` | uuid | No | FK users |
| `updated_by` | uuid | No | FK users |
| `version` | integer | No | default: 1 |
| `created_at` | timestamp | No | default: defaultNow() |
| `updated_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `tenant_id → organizations(id)`; `created_by → users(id)`; `updated_by → users(id)`.

**Referenciada por:** `reconciliation_operation_executions(policy_id)`.

**Índices / unicidad declarados:** `reconciliation_operation_policies_tenant_unique` (unique); `reconciliation_operation_policies_tenant_enabled_idx` (index).

**Checks declarados:** `reconciliation_operation_policies_cadence_check`; `reconciliation_operation_policies_threshold_check`; `reconciliation_operation_policies_weekday_check`.

#### `reconciliation_runs`

**Columnas:** 20 · **Clave primaria:** id · **FK:** 3.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `tenant_id` | uuid | No | FK organizations |
| `status` | varchar(20) | No | default: 'PENDING' |
| `scope` | jsonb | No |  |
| `started_at` | timestamp | No | default: defaultNow() |
| `completed_at` | timestamp | Sí |  |
| `started_by` | uuid | Sí | FK users |
| `rules_version` | varchar(40) | No |  |
| `total_rules` | integer | No | default: 0 |
| `passed_rules` | integer | No | default: 0 |
| `failed_rules` | integer | No | default: 0 |
| `not_applicable_rules` | integer | No | default: 0 |
| `critical_findings` | integer | No | default: 0 |
| `error_findings` | integer | No | default: 0 |
| `warning_findings` | integer | No | default: 0 |
| `info_findings` | integer | No | default: 0 |
| `generated_at` | timestamp | Sí |  |
| `duration_ms` | integer | Sí |  |
| `metadata` | jsonb | No | default: sql''{}'::jsonb' |
| `operation_execution_id` | uuid | Sí | FK reconciliation_operation_executions |

**Claves foráneas:** `tenant_id → organizations(id)`; `started_by → users(id)`; `operation_execution_id → reconciliation_operation_executions(id)`.

**Referenciada por:** `reconciliation_findings(reconciliation_run_id)`; `reconciliation_issue_events(reconciliation_run_id)`; `reconciliation_issues(first_run_id)`; `reconciliation_issues(last_run_id)`; `reconciliation_notifications(reconciliation_run_id)`.

**Índices / unicidad declarados:** `reconciliation_runs_tenant_started_idx` (index); `reconciliation_runs_status_idx` (index); `reconciliation_runs_operation_execution_unique` (uniqueIndex).

**Checks declarados:** `reconciliation_runs_status_check`; `reconciliation_runs_total_rules_check`; `reconciliation_runs_passed_rules_check`; `reconciliation_runs_failed_rules_check`; `reconciliation_runs_not_applicable_rules_check`; `reconciliation_runs_critical_findings_check`; `reconciliation_runs_error_findings_check`; `reconciliation_runs_warning_findings_check`; `reconciliation_runs_info_findings_check`.

### Cargas masivas, jobs y eventos técnicos

#### `bulk_import_jobs`

**Columnas:** 31 · **Clave primaria:** id · **FK:** 3.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `organization_id` | uuid | No | FK organizations |
| `created_by` | uuid | No | FK users |
| `import_type` | varchar(40) | No |  |
| `authorization_import_batch_id` | uuid | Sí | FK import_batches |
| `template_version` | varchar(80) | No |  |
| `status` | varchar(30) | No | default: 'UPLOADED' |
| `original_filename` | varchar(255) | No |  |
| `mime_type` | varchar(160) | No |  |
| `size_bytes` | integer | No |  |
| `file_hash` | varchar(64) | No |  |
| `duplicate_file` | boolean | No | default: false |
| `total_rows` | integer | No | default: 0 |
| `valid_rows` | integer | No | default: 0 |
| `invalid_rows` | integer | No | default: 0 |
| `duplicate_rows` | integer | No | default: 0 |
| `warning_rows` | integer | No | default: 0 |
| `succeeded_rows` | integer | No | default: 0 |
| `failed_rows` | integer | No | default: 0 |
| `skipped_rows` | integer | No | default: 0 |
| `last_error_code` | varchar(80) | Sí |  |
| `correlation_id` | uuid | No |  |
| `created_at` | timestamp | No | default: defaultNow() |
| `validated_at` | timestamp | Sí |  |
| `confirmed_at` | timestamp | Sí |  |
| `completed_at` | timestamp | Sí |  |
| `cancelled_at` | timestamp | Sí |  |
| `failed_at` | timestamp | Sí |  |
| `processing_generation` | integer | No | default: 0 |
| `processing_token` | uuid | Sí |  |
| `processing_heartbeat_at` | timestamp | Sí |  |

**Claves foráneas:** `organization_id → organizations(id)`; `created_by → users(id)`; `authorization_import_batch_id → import_batches(id)`.

**Referenciada por:** `bulk_import_rows(job_id)`.

**Índices / unicidad declarados:** `bulk_import_jobs_org_status_idx` (index); `bulk_import_jobs_hash_idx` (index).

**Checks declarados:** `bulk_import_jobs_type_check`; `bulk_import_jobs_status_check`; `bulk_import_jobs_size_bytes_check`; `bulk_import_jobs_processing_generation_check`.

#### `bulk_import_row_attempts`

**Columnas:** 7 · **Clave primaria:** id · **FK:** 1.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `row_id` | uuid | No | FK bulk_import_rows |
| `attempt_number` | integer | No |  |
| `status` | varchar(20) | No |  |
| `error_code` | varchar(80) | Sí |  |
| `error_message` | text | Sí |  |
| `created_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `row_id → bulk_import_rows(id)`.

**Índices / unicidad declarados:** `bulk_import_row_attempts_unique` (unique).

**Checks declarados:** `bulk_import_row_attempts_number_check`; `bulk_import_row_attempts_status_check`.

#### `bulk_import_rows`

**Columnas:** 21 · **Clave primaria:** id · **FK:** 1.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `job_id` | uuid | No | FK bulk_import_jobs |
| `row_number` | integer | No |  |
| `raw_payload` | jsonb | No |  |
| `normalized_payload` | jsonb | Sí |  |
| `validation_status` | varchar(20) | No |  |
| `error_code` | varchar(80) | Sí |  |
| `error_message` | text | Sí |  |
| `error_column` | varchar(80) | Sí |  |
| `entity_reference` | uuid | Sí |  |
| `execution_status` | varchar(20) | No | default: 'PENDING' |
| `execution_error_code` | varchar(80) | Sí |  |
| `execution_error` | text | Sí |  |
| `attempt_count` | integer | No | default: 0 |
| `idempotency_key` | varchar(200) | No |  |
| `created_at` | timestamp | No | default: defaultNow() |
| `executed_at` | timestamp | Sí |  |
| `claim_token` | uuid | Sí |  |
| `claim_generation` | integer | No | default: 0 |
| `claimed_at` | timestamp | Sí |  |
| `claim_expires_at` | timestamp | Sí |  |

**Claves foráneas:** `job_id → bulk_import_jobs(id)`.

**Referenciada por:** `bulk_import_row_attempts(row_id)`.

**Índices / unicidad declarados:** `bulk_import_rows_job_row_unique` (unique); `bulk_import_rows_idempotency_unique` (unique); `bulk_import_rows_job_status_idx` (index); `bulk_import_rows_claim_idx` (index).

**Checks declarados:** `bulk_import_rows_row_number_check`; `bulk_import_rows_validation_status_check`; `bulk_import_rows_execution_status_check`; `bulk_import_rows_claim_generation_check`.

#### `bulk_update_batches`

**Columnas:** 21 · **Clave primaria:** id · **FK:** 2.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `organization_id` | uuid | No | FK organizations |
| `created_by` | uuid | No | FK users |
| `operation_type` | varchar(40) | No |  |
| `contract_version` | integer | No |  |
| `original_filename` | varchar(255) | No |  |
| `mime_type` | varchar(160) | No |  |
| `size_bytes` | integer | No |  |
| `sha256` | varchar(64) | No |  |
| `status` | varchar(30) | No | default: 'UPLOADED' |
| `total_rows` | integer | No | default: 0 |
| `processed_rows` | integer | No | default: 0 |
| `updated_rows` | integer | No | default: 0 |
| `unchanged_rows` | integer | No | default: 0 |
| `rejected_rows` | integer | No | default: 0 |
| `last_error_code` | varchar(80) | Sí |  |
| `correlation_id` | uuid | No |  |
| `idempotency_key` | varchar(200) | No |  |
| `created_at` | timestamp | No | default: defaultNow() |
| `started_at` | timestamp | Sí |  |
| `completed_at` | timestamp | Sí |  |

**Claves foráneas:** `organization_id → organizations(id)`; `created_by → users(id)`.

**Referenciada por:** `bulk_update_rows(batch_id)`; `bulk_update_source_files(batch_id)`; `novelties(bulk_update_batch_id)`.

**Índices / unicidad declarados:** `bulk_update_batches_org_idx` (index); `bulk_update_batches_hash_idx` (index); `bulk_update_batches_logical_key_idx` (uniqueIndex).

**Checks declarados:** `bulk_update_batches_size_bytes_check`; `bulk_update_batches_status_check`; `bulk_update_batches_operation_type_check`.

#### `bulk_update_rows`

**Columnas:** 13 · **Clave primaria:** id · **FK:** 2.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `batch_id` | uuid | No | FK bulk_update_batches |
| `row_number` | integer | No |  |
| `raw_data` | jsonb | No |  |
| `authorization_key` | varchar(511) | Sí |  |
| `authorization_item_id` | uuid | Sí | FK authorization_items |
| `field_name` | varchar(120) | Sí |  |
| `previous_value` | text | Sí |  |
| `new_value` | text | Sí |  |
| `field_version` | integer | Sí |  |
| `result_code` | varchar(40) | No |  |
| `result_message` | text | No |  |
| `created_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `batch_id → bulk_update_batches(id)`; `authorization_item_id → authorization_items(id)`.

**Índices / unicidad declarados:** `bulk_update_rows_batch_row_unique` (unique); `bulk_update_rows_batch_result_idx` (index).

**Checks declarados:** `bulk_update_rows_row_number_check`; `bulk_update_rows_result_code_check`.

#### `bulk_update_source_files`

**Columnas:** 9 · **Clave primaria:** id · **FK:** 1.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `batch_id` | uuid | No | FK bulk_update_batches |
| `original_filename` | varchar(255) | No |  |
| `mime_type` | varchar(160) | No |  |
| `size_bytes` | integer | No |  |
| `sha256` | varchar(64) | No |  |
| `content` | bytea | Sí |  |
| `created_at` | timestamp | No | default: defaultNow() |
| `processed_at` | timestamp | Sí |  |

**Claves foráneas:** `batch_id → bulk_update_batches(id)`.

**Índices / unicidad declarados:** `bulk_update_source_files_batch_idx` (uniqueIndex).

**Checks declarados:** `bulk_update_source_files_size_bytes_check`.

#### `idempotency_records`

**Columnas:** 8 · **Clave primaria:** id · **FK:** 0.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `scope` | varchar(120) | No |  |
| `key` | varchar(200) | No |  |
| `request_hash` | varchar(64) | No |  |
| `status_code` | integer | No |  |
| `response` | jsonb | No |  |
| `created_at` | timestamp | No | default: defaultNow() |
| `expires_at` | timestamp | No |  |

**Índices / unicidad declarados:** `idempotency_records_scope_key_idx` (uniqueIndex); `idempotency_records_expires_at_idx` (index).

#### `import_batches`

**Columnas:** 21 · **Clave primaria:** id · **FK:** 2.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `organization_id` | uuid | No | FK organizations |
| `created_by` | uuid | No | FK users |
| `original_filename` | varchar(255) | No |  |
| `mime_type` | varchar(160) | No |  |
| `size_bytes` | integer | No |  |
| `sha256` | varchar(64) | No |  |
| `processor_version` | integer | No |  |
| `status` | varchar(30) | No | default: 'UPLOADED' |
| `total_rows` | integer | No | default: 0 |
| `valid_rows` | integer | No | default: 0 |
| `rejected_rows` | integer | No | default: 0 |
| `duplicate_rows` | integer | No | default: 0 |
| `existing_rows` | integer | No | default: 0 |
| `tariff_rejected_rows` | integer | No | default: 0 |
| `confirmed_rows` | integer | No | default: 0 |
| `created_at` | timestamp | No | default: defaultNow() |
| `started_at` | timestamp | Sí |  |
| `completed_at` | timestamp | Sí |  |
| `confirmed_at` | timestamp | Sí |  |
| `last_error_code` | varchar(80) | Sí |  |

**Claves foráneas:** `organization_id → organizations(id)`; `created_by → users(id)`.

**Referenciada por:** `authorization_items(created_from_batch_id)`; `authorization_items(last_load_id)`; `bulk_import_jobs(authorization_import_batch_id)`; `import_rows(import_batch_id)`; `import_source_files(import_batch_id)`; `inventory_allocation_batches(import_batch_id)`; `novelties(import_batch_id)`.

**Índices / unicidad declarados:** `import_batches_status_idx` (index); `import_batches_hash_idx` (index).

**Checks declarados:** `import_batches_size_bytes_check`; `import_batches_processor_version_check`; `import_batches_status_check`; `import_batches_total_rows_check`; `import_batches_valid_rows_check`; `import_batches_rejected_rows_check`; `import_batches_duplicate_rows_check`; `import_batches_existing_rows_check`; `import_batches_tariff_rejected_rows_check`; `import_batches_confirmed_rows_check`.

#### `import_rows`

**Columnas:** 11 · **Clave primaria:** id · **FK:** 2.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `import_batch_id` | uuid | No | FK import_batches |
| `row_number` | integer | No |  |
| `raw_data` | jsonb | No |  |
| `normalized_data` | jsonb | Sí |  |
| `authorization_key` | varchar(511) | Sí |  |
| `result_code` | varchar(80) | No |  |
| `result_message` | text | No |  |
| `confirmable` | boolean | No | default: false |
| `authorization_item_id` | uuid | Sí | FK authorization_items |
| `created_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `import_batch_id → import_batches(id)`; `authorization_item_id → authorization_items(id)`.

**Referenciada por:** `validation_errors(import_row_id)`.

**Índices / unicidad declarados:** `import_rows_batch_row_unique` (unique); `import_rows_batch_result_idx` (index).

**Checks declarados:** `import_rows_row_number_check`; `import_rows_result_code_check`.

#### `import_source_files`

**Columnas:** 9 · **Clave primaria:** id · **FK:** 1.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `import_batch_id` | uuid | No | FK import_batches |
| `original_filename` | varchar(255) | No |  |
| `mime_type` | varchar(160) | No |  |
| `size_bytes` | integer | No |  |
| `sha256` | varchar(64) | No |  |
| `content` | bytea | Sí |  |
| `created_at` | timestamp | No | default: defaultNow() |
| `processed_at` | timestamp | Sí |  |

**Claves foráneas:** `import_batch_id → import_batches(id)`.

**Índices / unicidad declarados:** `import_source_files_batch_idx` (uniqueIndex).

**Checks declarados:** `import_source_files_size_bytes_check`.

#### `job_results`

**Columnas:** 7 · **Clave primaria:** id · **FK:** 0.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `queue` | varchar(120) | No |  |
| `job_name` | varchar(120) | No |  |
| `idempotency_key` | varchar(200) | No |  |
| `result` | jsonb | No |  |
| `correlation_id` | uuid | No |  |
| `completed_at` | timestamp | No | default: defaultNow() |

**Índices / unicidad declarados:** `job_results_queue_idempotency_idx` (uniqueIndex).

#### `outbox_events`

**Columnas:** 14 · **Clave primaria:** id · **FK:** 1.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `event_type` | varchar(120) | No |  |
| `version` | integer | No |  |
| `payload` | jsonb | No |  |
| `correlation_id` | uuid | No |  |
| `organization_id` | uuid | Sí | FK organizations |
| `idempotency_key` | varchar(200) | No |  |
| `status` | varchar(30) | No | default: 'PENDING' |
| `attempts` | integer | No | default: 0 |
| `available_at` | timestamp | No | default: defaultNow() |
| `created_at` | timestamp | No | default: defaultNow() |
| `dispatched_at` | timestamp | Sí |  |
| `processed_at` | timestamp | Sí |  |
| `last_error` | text | Sí |  |

**Claves foráneas:** `organization_id → organizations(id)`.

**Índices / unicidad declarados:** `outbox_events_idempotency_key_idx` (uniqueIndex); `outbox_events_dispatch_idx` (index).

**Checks declarados:** `outbox_events_status_check`.

#### `validation_errors`

**Columnas:** 6 · **Clave primaria:** id · **FK:** 1.

| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |
| --- | --- | --- | --- |
| `id` | uuid | No | PK; default: defaultRandom() |
| `import_row_id` | uuid | No | FK import_rows |
| `field_name` | varchar(160) | No |  |
| `code` | varchar(80) | No |  |
| `message` | text | No |  |
| `created_at` | timestamp | No | default: defaultNow() |

**Claves foráneas:** `import_row_id → import_rows(id)`.

**Índices / unicidad declarados:** `validation_errors_row_idx` (index).

---

**Interpretación:** una FK refleja únicamente relaciones declaradas en Drizzle; no prueba reglas de negocio, relaciones lógicas sin FK, cardinalidades reales, permisos ni consistencia de un entorno desplegado. Consulta siempre los servicios/repositorios y las migraciones pertinentes.
