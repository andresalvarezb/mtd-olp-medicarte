# CE-20 a CE-25 — Soportes documentales y Google Drive

**Sistemas:** Drive, API NestJS, worker y PostgreSQL. **Fuentes:** `authorization-billing-audit-drive.service.ts`, `authorization-billing-audit.service.ts`, `apps/worker/src/authorization-drive-support-sync.ts`, `packages/config/src/index.ts`. La búsqueda es de **solo lectura** en Drive; el código revisado **no crea ni carga el PDF** en Drive.

## CE-20 — Búsqueda manual durante la auditoría

**Endpoint:** `POST /api/v1/authorization-billing-audits/:auditId/evidence/drive/search` (MTD con `application_audits.manage`). La API verifica credencial de service account, carpetas raíz autorizadas y consulta PDFs no eliminados por (a) nombre exacto `<numero_autorizacion>.pdf` y (b) `fullText contains <numero_autorizacion>`. **Combina y deduplica** los resultados por Drive file ID y comprueba pertenencia a las raíces permitidas. Un expediente puede tener **varios PDFs**; un soporte con nombre diferente puede coincidir por su contenido indexado.

El resultado guarda metadatos: fileId, nombre, MIME, enlace, tamaño, checksum si existe, fecha de modificación y descubrimiento. **No** presupone que el contenido del documento sea clínicamente válido ni que coincida con el paciente: el auditor debe revisarlo.

## CE-21 — Consultar contenido

`GET /api/v1/authorization-billing-audits/:auditId/evidence/:evidenceId/content` obtiene flujo de descarga/visualización para un soporte ligado a esa auditoría. La API usa `Cache-Control: private, no-store`. Devuelve `AUTHORIZATION_BILLING_AUDIT_EVIDENCE_NOT_FOUND` cuando la referencia no es accesible; los errores de Drive pueden indicar configuración faltante o falla remota. El endpoint se restringe a usuarios MTD autorizados.

## CE-22 — No existe PDF en Drive

La búsqueda puede devolver **lista vacía**. No cambiar automáticamente auditoría a `NO CUMPLE`. El proceso de decisión exige **observación** cuando no existen soportes; el auditor decide. La condición `WITHOUT_SUPPORT` es un **estado de soporte**, no un dictamen de auditoría. `UNKNOWN` significa ausencia de verificación confiable o error, no soporte faltante probado.

## CE-23 — Sincronización automática de soportes

**Worker opcional** controlado por `SCHEDULER_ENABLED` y `GOOGLE_DRIVE_AUDIT_SYNC_ENABLED` (por defecto `false`). Usa credenciales de service account y raíces configuradas. Al iniciar ejecuta un batch y luego ciclos con `GOOGLE_DRIVE_AUDIT_SYNC_POLL_INTERVAL_MS` (predeterminado 60000 ms). El lote por defecto es 10 autorizaciones, concurrencia 2; alcance `ALL` (default) o `CLOSED_ONLY`; reconsulta exitosa predeterminada cada 30 min y error cada 5 min; cada variable puede configurarse.

El worker consulta autorizaciones con `next_check_at` vencido, busca PDFs exactos y por texto, valida la pertenencia a carpetas raíz y conserva/actualiza `authorization_drive_supports` y `authorization_drive_support_sync`. Usa advisory lock para evitar dos procesos de sincronización simultáneos. Las fuentes de la auditoría individual y la proyección sincronizada se deben contrastar; son rutas relacionadas pero **no idénticas**.

## CE-24 — Soporte apareció, cambió o desapareció

En cada ciclo exitoso, la sincronización marca los soportes anteriores como ausentes (`is_present=false`, `missing_since`) y reactiva los que reaparecen. Preserva historia y metadatos de detección; no borra silenciosamente evidencia antigua. Errores de Google Drive se guardan con `last_error` y número de fallos, y se reintentan conforme a configuración. La sincronización por sí misma **no aprueba/rechaza** auditorías `REVIEWED`.

## CE-25 — Fallo de configuración, acceso o índice

Verificar, sin exponer secretos: `GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE`, `GOOGLE_DRIVE_AUDIT_ROOT_FOLDER_ID(S)`, permisos de lectura de la cuenta, `GOOGLE_DRIVE_AUDIT_SYNC_ENABLED`, `SCHEDULER_ENABLED`, acceso a Drive, indexación `fullText` y reloj del worker. Cuando no está configurado, API puede responder `AUTHORIZATION_BILLING_AUDIT_DRIVE_NOT_CONFIGURED`; cuando falla Drive, `AUTHORIZATION_BILLING_AUDIT_DRIVE_ERROR`.

**Privacidad:** nunca insertar PDFs reales en repositorio, fixtures o logs; no exponer URL, fileId, documentos de identidad ni credenciales en ejemplos públicos; la existencia de URL de Drive no reemplaza control de permisos.
