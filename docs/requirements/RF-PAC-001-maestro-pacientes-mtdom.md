# RF-PAC-001 — Maestro dinámico de pacientes e integración con MTDOM

**Estado:** propuesta funcional ajustada a decisiones aprobadas; no implementada.
**Proyecto:** MTD OLP Medicarte. **Base analizada:** `origin/develop`, 2026-11-06.
**Alcance:** maestro local de pacientes relacionados con autorizaciones de Medicarte, sincronización de lectura con MTDOM y acceso de usuario por organización y punto. No autoriza migraciones ni cambios de operación.

## 1. Objetivo y antecedentes

Crear un maestro local único, enlazable con `patient_id`, que mantenga la identidad de pacientes asociados a autorizaciones, enriquezca su ficha desde MTDOM y conserve compatibilidad con autorizaciones, programaciones, puntos y demás consumidores vigentes.

En `origin/develop` el esquema no declara una tabla maestra `patients`. La identidad usada por varios consumidores se obtiene desde `authorization_items.source_data`; `patient_schedules` referencia la autorización y el punto, mientras `patient_default_dispensing_points` se identifica por `patient_document`. La auditoría de referencias identificó otras dependencias directas e indirectas en consulta, demanda, compra, inventario, aplicaciones, reportes y auditoría. Ver [matriz de impacto y regresión](RF-PAC-001-impacto-tecnico.md); sus rutas y símbolos fueron contrastados con el código, sin inferir comportamiento solo desde Graphify.

MTDOM publica Patients Read API v1 como API de solo lectura en `https://api.mtdom.com`, con `POST /v1/patients/lookup`, `GET /v1/patients` y `GET /v1/patients/changes`. La identidad es compuesta por `tipo_identificacion + identificacion`; consultar solo el número puede resultar en `409 AMBIGUOUS_PATIENT_IDENTITY`. El contrato define perfiles `basic` y `personal`, Bearer scopes separados, cursor opaco y checkpoints `sync.as_of`.

## 2. Decisiones funcionales aprobadas

Estas decisiones forman parte del alcance aprobado para documentar y planear; no equivalen a implementación ni a aprobación legal del tratamiento de datos.

| ID    | Decisión aprobada                                                                                                                                                                                                                                      |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DP-01 | Registrar y sincronizar únicamente pacientes relacionados con autorizaciones de Medicarte. No mantener una copia completa del maestro de MTDOM.                                                                                                        |
| DP-02 | La ficha local objetivo contiene los atributos personales, de contacto, ubicación y aseguramiento que MTDOM exponga en el perfil autorizado; aplicar minimización de almacenamiento, acceso y exposición conforme a la decisión legal pendiente DP-07. |
| DP-03 | Actualizar automáticamente desde MTDOM con reglas explícitas para campos ausentes, discrepancias e identidad ambigua. Los datos oficiales personales se consultan/corrigen en MTDOM según DP-06; no inferir precedencia para excepciones pendientes.   |
| DP-04 | Crear/reutilizar identidad local al confirmar una autorización y ejecutar carga histórica inicial de todos los pacientes relacionados con autorizaciones existentes de Medicarte.                                                                      |
| DP-05 | Consultar nuevos pacientes por evento de confirmación y ejecutar sincronización incremental cada 60 minutos, con reintentos, alertas y supervisión. Las importaciones nunca esperan la disponibilidad de MTDOM.                                        |
| DP-06 | MTD autorizado administra conciliaciones; MEDICARTE consulta pacientes solo dentro de su alcance por organización y punto; OLP no accede al maestro. Los datos personales oficiales se corrigen en MTDOM.                                              |
| DP-08 | Centralizar la identidad en `patient_id` y migrar consumidores/relaciones progresivamente, manteniendo compatibilidad completa durante la transición.                                                                                                  |

**DP-07 — pendiente de aprobación definitiva:** base jurídica/finalidad, responsable, campos concretos del perfil `personal`, retención, supresión, atención de derechos y controles organizacionales. No implementar la carga de datos personales hasta resolverla. No archivar ni retirar pacientes automáticamente por inactividad; su conservación/supresión queda sujeta a DP-07 y a las obligaciones aplicables.

## 3. Actores, autoridad y límites

- **MTD autorizado:** confirma autorizaciones; administra conciliaciones locales de identidad bajo permisos que se definan para ese fin.
- **MEDICARTE:** consulta ficha dentro de su organización y puntos autorizados; no corrige atributos oficiales personales.
- **OLP:** no consulta ni administra el maestro ni recibe ficha personal por exportaciones o contratos indirectos.
- **Medicarte backend:** mantiene identidades, relaciones, cola/checkpoints y aplica controles de autorización. La credencial MTDOM no llega al navegador.
- **MTDOM:** autoridad de los atributos de paciente expuestos por Patients Read API v1; API de solo lectura.
- **Responsable de datos/seguridad:** resuelve DP-07 y aprueba scope `patients.read.personal`, campos, finalidad y salvaguardas antes de su habilitación.

La autorización existente para leer una autorización, programación o aplicación no concede por sí sola acceso a una ficha personal centralizada. La nueva consulta requiere enforcement server-side por rol, organización y punto; las relaciones indirectas deben respetar su autorización y no crear una vía de acceso por ID.

## 4. Reglas funcionales

**RF-01 — Registro en confirmación.** Al confirmar una autorización, crear o reutilizar una identidad local si los datos permiten determinarla sin ambigüedad. Persistir una tarea de enriquecimiento en el mismo límite transaccional o mediante un mecanismo durable equivalente. No realizar HTTP a MTDOM dentro de la transacción ni retrasar el resultado del cargue.

**RF-02 — Identidad compuesta.** La identidad canónica externa es `(tipo_identificacion, identificacion)`. Normalizar para comparar, guardar el valor de origen y evitar unicidad por número solamente. Las reglas de normalización deben conservar ceros y caracteres que puedan ser significativos para el tipo documental y fijarse con los contratos/fuentes reales antes del esquema.

**RF-03 — Pendientes y conflictos.** Si falta tipo/número o hay contradicción entre autorizaciones/fuentes, mantener la autorización y registrar el caso para conciliación sin asignar una identidad verificada. No resolver automáticamente identidades repetidas, cambiadas o ambiguas; `409` requiere conciliación MTD autorizada. Un `404` no borra el paciente ni la autorización.

**RF-04 — Enriquecimiento por evento.** Un proceso asíncrono consulta `POST /v1/patients/lookup` con identidad compuesta y perfil aprobado. No llamar por fila XLSX, apertura de vista ni cada reintento del importador. Validar que la respuesta corresponde a la identidad solicitada antes de aplicar un UPSERT.

**RF-05 — Históricos y delta.** Cargar identidades distintas obtenidas de autorizaciones históricas y resolverlas contra MTDOM; almacenar solo identidades enlazadas o conciliadas como pertinentes a Medicarte. Después, consumir `/v1/patients/changes` cada 60 minutos con checkpoint durable. El API de cambios documentado entrega cambios globales; el cliente debe filtrar candidatos locales. Este contrato no evita que respuestas ajenas al alcance transiten por el cliente y es un bloqueo de minimización/seguridad a resolver antes de producción (sección 11).

**RF-06 — Paginación y checkpoints.** En snapshot y cambios, seguir `next_cursor` exactamente como opaco. Al usar cursor no volver a enviar/modificar `since`, `profile` ni `limit` de la página inicial. El delta puede repetir registros en el límite inclusivo del checkpoint: UPSERT idempotente. Avanzar `sync.as_of` solo tras completar y persistir todas las páginas; al fallar, reiniciar desde el checkpoint anterior.

**RF-07 — Perfiles, datos y estado.** DP-02 define ficha completa objetivo, pero DP-07 bloquea el uso de perfil `personal` hasta su aprobación. No guardar respuesta cruda completa por conveniencia; persistir campos autorizados, procedencia, `actualizado_en`, última sincronización y estado/error técnico mínimo. Mantener separados `activo`, `paciente_vivo` y `presente_en_fuente_actual`; ausencia o cambio de esos indicadores no borra identidad ni cambia elegibilidad operacional.

**RF-08 — Precedencia del punto habitual.** No derivar punto de domicilio, ciudad o coordenadas. La prioridad vigente se conserva: programación activa → punto predeterminado → mapeo AT. Durante la migración, consultar vínculo por `patient_id` y fallback histórico solo de forma explícita, sin cambiar resultados ni fusionar registros automáticamente.

**RF-09 — Históricos y compatibilidad.** `authorization_items.source_data` y sus valores originales son evidencia del archivo y no se reescriben con MTDOM. Los lectores siguen operando cuando `patient_id` es nulo. Una referencia nueva complementa la evidencia histórica; no reemplaza de golpe sus consumidores.

**RF-10 — Separación operacional.** MTDOM no determina autorizaciones, cantidades, estados de compra, prioridad de puntos, inventario, recibos, dispensaciones, aplicaciones ni elegibilidad. Cambios de perfil personal solo actualizan atributos admitidos de la ficha local.

**RF-11 — Acceso a ficha.** MTD autorizado puede administrar conciliación con permiso específico; MEDICARTE puede consultar solo cuando la autorización abarca la organización y punto relacionados; OLP queda denegado. Filtros, detalle, exportación y endpoints aplican el mismo control server-side y no filtran datos de otros alcances.

## 5. Modelo conceptual y viabilidad

El diseño físico es pendiente y debe revisarse con `drizzle-schema-safety` en implementación. Se propone evaluar:

| Entidad/relación conceptual               | Propósito y límites                                                                                                                                                                                             |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `patients`                                | UUID interno, identidad normalizada y original, atributos MTDOM autorizados, procedencia/frescura y estados independientes. Unicidad compuesta solo para identidad resuelta.                                    |
| Identidad provisoria/conciliación         | Conservar autorización de origen, componentes conocidos, motivo y resolución/auditoría; sin asignar identidad verificada por documento aislado. Puede ser tabla o estado explícito según idempotencia/consulta. |
| `authorization_items.patient_id` nullable | Enlace progresivo; debe ser consistente con tipo/número asociados y permitir `NULL` hasta conciliación. No cambiar clave de autorización ni datos operacionales.                                                |
| Punto habitual                            | Integrar vínculo opcional por `patient_id` con unicidad y política de conciliación. Preservar temporalmente `patient_document`; no backfill automático sin reporte/resolución de colisiones.                    |
| Sincronización                            | Checkpoint por perfil/flujo, `sync.as_of`, ejecución y páginas completadas. Cursor no necesita persistirse fuera de una ejecución reanudable; si se persiste, protegerlo como token opaco.                      |
| Cola/reintentos                           | Clave idempotente paciente+causa, intentos, `next_attempt_at` y clase de error; no incluir PII/secretos en mensajes/logs.                                                                                       |

El snapshot completo de MTDOM no puede poblarse indiscriminadamente: DP-01 limita filas locales a pacientes relacionados con Medicarte. El esquema debe permitir almacenar solo la proyección personal autorizada y separar datos de identidad, estado de conciliación y sincronización sin redundancias prematuras.

## 6. Contrato MTDOM contrastado

Verificado directamente en `FelipeMTD/mtdom-apis` `main` commit `020747eb02ad072f2263430df8383fb5de67e617` el 2026-11-06; no se usaron credenciales ni datos reales.

| Operación                  | Contrato observado                                                                                                                                                                  | Implicación                                                                                                                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /v1/patients/lookup` | Bearer; body con tipo+documento (preferido) y `profile`. `200`, `400`, `401`, `403`, `404 PATIENT_NOT_FOUND`, `409 AMBIGUOUS_PATIENT_IDENTITY`, `500`. POST evita documento en URL. | `404` conserva identidad pendiente; `401/403` alerta y pausa llamadas incompatibles; `409` se deriva a conciliación. La guía también permite lookup por número solo: evitarlo para el flujo ordinario. |
| `GET /v1/patients`         | Snapshot paginado; perfil default `basic`, límite default 1000 / máximo 5000, cursor opaco; responde `pagination.has_next`, `next_cursor` y `sync.as_of`.                           | No usar snapshot para replicar población completa; construir conjunto de claves locales y diseñar bootstrap que minimice transferencia personal.                                                       |
| `GET /v1/patients/changes` | Requiere `since` RFC3339 en primera página; siguientes páginas solo cursor; checkpoint inclusivo puede repetir pacientes; `sync.as_of` solo se persiste tras todas las páginas.     | Consume delta global y no documenta filtro por IDs/organización. Aplicar deduplicación/upsert por identidad y checkpoint transaccional.                                                                |
| `basic`                    | Identidad, nombres, sexo, ubicación administrativa, aseguramiento y estados (`activo`, `paciente_vivo`, `presente_en_fuente_actual`, otros).                                        | DP-02 permite los atributos seleccionados, sujeto a minimización/DP-07. No tratar los estados como sinónimos.                                                                                          |
| `personal`                 | Incluye `basic` más nacimiento, dirección, barrio, zona, coordenadas, teléfonos y correo/validación. Requiere `patients.read.personal`; `basic` no puede pedir personal (403).      | Habilitar solamente tras aprobar DP-07 y permiso de campo/rol; evitar exposición a OLP.                                                                                                                |
| Credenciales               | Token Bearer individual por consumidor, `mtdpat_...`; operaciones revocables/auditables.                                                                                            | Secreto exclusivo en backend/secret manager; no en cliente, URL, repositorio, logs ni reportes.                                                                                                        |

## 7. Seguridad, privacidad e invariantes

- MTDOM solo lectura; Medicarte no intenta escribir, corregir ni eliminar allí.
- DP-07 bloquea uso productivo de perfil personal hasta aprobar base/finalidad, retención/supresión, derechos, responsable y controles.
- Resolver el delta global con MTDOM: filtrar almacenamiento no basta si el cliente recibe información personal de todos los pacientes. Antes de implementación productiva, acordar con MTDOM un endpoint/filtro acotado o justificar y autorizar el procesamiento transitorio del delta global con minimización, memoria/logging, análisis de seguridad y prueba de que datos ajenos no se persisten.
- Aplicar RBAC, organización y punto en endpoints, listados, detalle, batch, métricas y exportaciones. El servicio de sincronización no debe usar autorización de usuario final como sustituto de credencial técnica ni exponer bypasses de OLP.
- No almacenar body bruto ni PII en logs, trazas, error reports, métricas, CI o fixtures. Tests usan identidades sintéticas.
- No bloquear importación por timeout, caída, `404`, `429` o `5xx`; establecer límites, backoff, jitter y alerta. `401/403` detienen retries inútiles y requieren corrección de credenciales/scope.
- `source_data` conserva la fila original; no alterar cantidades, autorizaciones, puntos, historial, ordenes/recepciones, asignaciones, inventario, dispensaciones o aplicaciones.
- No purgar ni archivar por inactividad. Aplicar únicamente la política legal que resulte de DP-07.

## 8. Criterios de aceptación propuestos

1. Dos autorizaciones con identidad compuesta verificada comparten un `patient_id`, incluso ante confirmación concurrente; un componente faltante no fuerza asociación.
2. Recarga/reintento no duplica paciente ni job y una falla MTDOM no revierte una autorización confirmada.
3. Lookup `200` solo actualiza identidad coincidente/campos autorizados; `404`, `409`, `401/403` y errores transitorios siguen las salidas definidas sin fusionar ni borrar.
4. Backfill contiene solo pacientes con referencias de autorización Medicarte; muestra conteo de no encontrados/ambiguos para conciliación y no modifica `source_data`.
5. Delta cada 60 min es idempotente frente a repetición; un fallo de cualquier página no confirma checkpoint; reintentar alcanza frescura sin saltos.
6. Cambio o ausencia de `activo`, `paciente_vivo` o `presente_en_fuente_actual` conserva registro y no modifica elegibilidad o consumo.
7. `patient_id` nullable permite transición; autorización, programación, compras/recepción, inventario, asignación, dispensación, aplicación, informes y exportaciones mantienen resultados equivalentes antes/después.
8. Punto resultante respeta programación activa → punto habitual → mapeo AT; datos de dirección no seleccionan punto; conflicto de punto no crea asignación.
9. MTD y MEDICARTE consultan solo según la política autorizada y punto; OLP, otros puntos/organizaciones, acceso por ID y exportación quedan denegados.
10. Antes de DP-07 no se habilita `personal`; después, datos personales quedan en backend/local conforme a política, sin PII en logs/CI y con auditoría de acceso.
11. Una corrección de nombre/dirección/EPS no altera autorización, OC, cantidades, recepción, inventario, reservas ni aplicaciones.
12. Ninguna sincronización elimina o archiva pacientes por inactividad/ausencia; supresión se sujeta a política aprobada.

## 9. Matriz de impacto y regresión

La matriz con archivos, símbolos, dependencias directas/indirectas, cambio propuesto, riesgo y prueba requerida está en [RF-PAC-001 — Impacto técnico y regresión](RF-PAC-001-impacto-tecnico.md). Es evidencia de navegación revisada y lista inicial para implementar; no sustituye una nueva búsqueda de consumidores al cambiar contratos/código.

## 10. Plan de implementación futura

1. **Resolver bloqueos previos:** DP-07; consulta global del delta; normalización documental; mapeo exacto de organización/punto y campos personal. Aprobar threat model y criterios de datos.
2. **Esquema aditivo/contratos:** paciente, claves compuestas, pendencias, enlace nullable, checkpoint/cola; constraints, índices, migraciones y plan de rollback con `drizzle-schema-safety`.
3. **Confirmación de autorización:** crear/reusar identidad local y outbox idempotente en flujo confirmado; compatibilidad con reload/retry y campos incompletos.
4. **Lookup asíncrono:** cliente backend, secreto y scopes, timeout/backoff/clasificación de error; stubs contractuales y verificación de identidad.
5. **Backfill histórico:** inventario read-only de identidades distintas; resolver vía lookup en lotes; resumen de duplicados/ambiguos; aplicar solo claves conciliadas.
6. **Delta incremental:** programador cada 60 minutos, paginación opaca, global filtering controlado, UPSERT, checkpoints durables, métricas agregadas y alertas.
7. **Conciliación/seguridad:** pantalla y endpoints solo para MTD autorizado; auditoría, RBAC organizacional/punto y tratamiento de estados/identidad cambiada.
8. **Consulta de pacientes:** interfaz MEDICARTE dentro de punto/organización; OLP bloqueado; endpoints y exportaciones de pacientes protegidos. Habilitar personal solo tras DP-07.
9. **Migración progresiva de consumidores:** filtros/autorizaciones, programación, punto habitual, compra/demanda, inventario, aplicación/dispensación, auditoría, exportes y reportes; fallback para `patient_id IS NULL`, comparación dual y retiro por etapas.
10. **Regresión y corte:** pruebas enfocadas por cada capa durante desarrollo; PostgreSQL aislado para contratos, constraints/concurrencia y migraciones; suite completa en CI antes de habilitar. No usar datos ni DB de producción.

## 11. Bloqueos y decisiones pendientes

- **DP-07 (decisión pendiente formal):** base legal/finalidad; conjunto exacto de atributos; responsable/retención; reglas de supresión y ejercicio de derechos; autorización del scope `patients.read.personal`.
- **Bloqueo de minimización de delta:** la API documentada es global, sin filtro por conjunto de pacientes. Confirmar con MTDOM si puede limitar el feed o documentar y aprobar el procesamiento transitorio de cambios globales. No implementar el delta personal mientras no exista solución aprobada.
- **Normalización:** fijar catálogo real de tipos de identificación, tratamiento de espacios/separadores/ceros y cambios de documento. No asumir equivalencias que colapsen claves.
- **DP-03 casos límite:** definir resolución de conflicto de identidad cambiada y campo nulo en actualización (borrar valor, conservar último dato o marcar stale) sin contradecir autoridad de MTDOM ni DP-06.
- **Alcance organizacional/punto:** documentar cómo se deriva el alcance permitido para una persona cuando existen varias autorizaciones/puntos; verificar que listados/exportaciones y consultas históricas tengan la misma regla. DP-06 define actores; el enforcement exacto queda para diseño RBAC.
- **Operación:** definir número máximo de intentos, backoff, SLO de frescura/alertas, credencial de contingencia, tratamiento de `429` y revisión/rotación de token.

## 12. Fuera de alcance

- Implementar API, interfaz, worker, migración, seed o integración en esta tarea documental.
- Escribir en MTDOM, crear una copia completa de su población, o corregir atributos personales localmente como autoridad.
- Cambiar prioridad del punto habitual, lógica de autorización/compra, inventario/recepción, consumo, cantidades o estados operacionales.
- Archivar/purgar por inactividad, decidir DP-07 por inferencia, ejecutar migraciones o usar datos/credenciales/DB de producción.

## 13. Fuentes

**Medicarte (código contrastado en `origin/develop`):** [esquema](../../packages/database/src/schema.ts), [flujo MTD](../flujo-mtd.md), [matriz de impacto](RF-PAC-001-impacto-tecnico.md), [reglas de agentes](../../AGENTS.md), [skill de documentación de requisitos](../../.agents/skills/requirements-documentation/SKILL.md), [skill RBAC](../../.agents/skills/rbac-point-scope/SKILL.md), [skill de esquema](../../.agents/skills/drizzle-schema-safety/SKILL.md), [skill de integridad de compras/entrega](../../.agents/skills/purchase-fulfillment-integrity/SKILL.md).

**MTDOM (`main` @ `020747eb02ad072f2263430df8383fb5de67e617`, 2026-11-06):** [catálogo API](https://github.com/FelipeMTD/mtdom-apis/blob/020747eb02ad072f2263430df8383fb5de67e617/docs/api/API_CATALOG.md), [guía Patients Read v1](https://github.com/FelipeMTD/mtdom-apis/blob/020747eb02ad072f2263430df8383fb5de67e617/docs/api/PATIENTS_READ_API_V1_USAGE.md), [operación y administración](https://github.com/FelipeMTD/mtdom-apis/blob/020747eb02ad072f2263430df8383fb5de67e617/docs/api/PATIENTS_READ_API_V1_OPERATIONS.md).

**Validación documental/técnica:** inspección estática del código, esquema, contratos y nombres de pruebas; lectura directa del contrato MTDOM vía GitHub API. No se consultó endpoint ni dato real, no se usaron credenciales, no se ejecutaron pruebas/builds, y no se modificó código/esquema/base de datos.
