# RF-PAC-001 — Maestro dinámico de pacientes e integración con MTDOM

**Estado:** propuesta funcional para revisión; no aprobada ni implementada.
**Proyecto:** MTD OLP Medicarte. **Base analizada:** `develop`, 2026-11-06.
**Alcance:** identidad y ficha local de pacientes, importación de autorizaciones y consumo de Patients Read API v1. Sin modificaciones de OC, inventario, puntos o producción.

## 1. Antecedentes verificados

- El esquema de Medicarte no declara una entidad maestra `patients`. `authorization_items.source_data` conserva información original de las autorizaciones; `patient_schedules` modela programaciones y `patient_default_dispensing_points` guarda el punto habitual mediante `patient_document`. Esta última está documentada en código como solución transitoria anterior al maestro de pacientes.
- MTDOM dispone de **Patients Read API v1**, de solo lectura, en `https://api.mtdom.com` con `GET /v1/patients`, `GET /v1/patients/changes` y `POST /v1/patients/lookup`.
- La identidad en MTDOM es `tipo_identificacion + identificacion`. La consulta por número sin tipo puede devolver `409 AMBIGUOUS_PATIENT_IDENTITY`.
- Hay perfiles `basic` y `personal`. El segundo incluye fecha de nacimiento, dirección, barrio, zona, coordenadas, teléfonos y correo. Los puntos operacionales de Medicarte no son parte de esa API.

## 2. Objetivo

Crear un **maestro local, dinámico y normalizado de pacientes**: registrar identidades presentes en autorizaciones, evitar duplicados, enriquecer los campos autorizados mediante MTDOM y mantenerlos actualizados sin que la disponibilidad de la API externa condicione el cargue de autorizaciones ni la operación habitual de Medicarte.

**Diseño candidato:** altas desde autorizaciones, consultas puntuales asíncronas para pacientes nuevos o pendientes, y actualización incremental periódica de los ya conocidos. Estas decisiones requieren aprobación antes de implementar.

## 3. Alcance y actores

- **MTD:** importa autorizaciones y consulta la información de pacientes permitida por su perfil vigente.
- **Sistema Medicarte:** identifica pacientes sin duplicar, conserva fuentes históricas, encola enriquecimiento y controla sincronización.
- **MTDOM:** fuente de verdad de los atributos personales autorizados. La API es solo lectura.
- **Responsable de datos:** aprueba campos, finalidad, acceso, retención y tratamiento de datos personales antes de habilitar perfil `personal`.

No se define en este RF un nuevo esquema de permisos por ubicaciones; las decisiones de acceso a una eventual ficha de pacientes quedan para diseño específico.

## 4. Reglas funcionales propuestas

**RF-01 — Registro con autorización.** Al confirmar una autorización, Medicarte crea o reutiliza una identidad de paciente según los datos suficientes y confiables del archivo. El proceso de importación debe completarse sin esperar la respuesta de MTDOM. No se realiza HTTP externo dentro de la transacción principal.

**RF-02 — Sin duplicación.** Una identidad verificada se distingue por tipo y número de identificación normalizados, conservando sus valores originales. Importaciones repetidas o simultáneas vinculan el mismo paciente.

**RF-03 — Identidades incompletas o ambiguas.** Si falta un componente de identidad o los datos se contradicen, no se fuerza un vínculo. Se conserva la autorización y un estado pendiente de resolución. Si lookup solo por número devuelve `409`, no se elige arbitrariamente un paciente.

**RF-04 — Enriquecimiento puntual.** Una tarea asíncrona consulta `POST /v1/patients/lookup` para identidades nuevas o pendientes; no se consulta MTDOM por cada fila de Excel ni cada vez que se abre una ficha. Ante `404` se conserva el paciente pendiente, ante `401/403` se alerta sobre configuración, ante timeout/`429`/`5xx` se considera reintento limitado según política.

**RF-05 — Actualización.** Las modificaciones de MTDOM se incorporan mediante `GET /v1/patients/changes` y UPSERT idempotente por identidad. El delta es global y debe filtrarse a pacientes pertinentes a Medicarte; no implica descargar y guardar todos los pacientes de MTDOM.

**RF-06 — Datos locales.** Las vistas habituales consultan PostgreSQL local. Se registran origen, versión/fecha del dato externo, última sincronización y estado de verificación. No se guarda el cuerpo completo de la API si solo se requieren campos seleccionados.

**RF-07 — Independencia operacional.** MTDOM no es autoridad para puntos predeterminados, programación, autorizaciones, cantidades, OC, inventario, recepción ni consumo. Cambios de nombre, EPS, dirección o estado personal no alteran automáticamente esos registros.

**RF-08 — Históricos.** La información del Excel en `authorization_items.source_data` es evidencia de origen y no se reescribe a partir de MTDOM. Los enlaces a `patients` se migran progresivamente; mantener compatibilidad con autorizaciones aún no vinculadas.

**RF-09 — Estados distintos.** `activo`, `paciente_vivo` y `presente_en_fuente_actual` son campos diferentes. Ni su modificación ni la ausencia del paciente en el último snapshot suponen eliminación automática o cambio de elegibilidad operacional.

**RF-10 — Punto habitual.** `patient_default_dispensing_points` permanece inicialmente intacta. Un futuro vínculo a `patient_id` requiere conciliación de identidades, sin cambiar la prioridad actual: programación activa → punto predeterminado → mapeo AT.

## 5. Modelo de datos conceptual (pendiente de diseño físico)

| Componente propuesto | Contenido mínimo y función | Restricción clave |
| --- | --- | --- |
| `patients` | UUID, tipo y número de identidad normalizados/originales, nombres, datos administrativos autorizados, procedencia, estado y marcas de actualización | Único por `(tipo_identificacion, identificacion)` verificados; no unificar solo por número |
| Pendientes de identidad | Origen, autorización, motivo e identidad incompleta o ambigua, sin atribución forzada | No asignar `patient_id` si no se ha identificado inequívocamente |
| `authorization_items.patient_id` (nullable) | Referencia progresiva al paciente verificado | El cargue/consulta siguen funcionando con valor nulo |
| Control de sincronización | Checkpoint de MTDOM (`sync.as_of`), estado y auditoría de ejecuciones | Avanzar únicamente al finalizar todas las páginas correctamente |
| Cola/estado de enriquecimiento | Identidad, causa, próximo intento, conteo de intentos y error clasificado | Tareas idempotentes, backoff, sin PII en logs |
| `patient_default_dispensing_points` (existente) | Punto habitual operacional | No modificar ni migrar automáticamente en esta primera fase |

La estructura exacta, separación de tablas, índices, constraints, formato de fechas y migraciones deberán validarse con `drizzle-schema-safety`, sin introducir tablas redundantes por inercia.

## 6. Flujos de sincronización

### 6.1 Autorizaciones nuevas

1. Validar y confirmar el archivo con las reglas vigentes.
2. Identificar de forma normalizada al paciente, reutilizar uno verificado o registrar la necesidad de conciliación.
3. Crear una tarea deduplicada de enriquecimiento después de la confirmación transaccional.
4. Consultar MTDOM por backend; validar identidad, contrato, permisos y campos permitidos.
5. Aplicar actualización idempotente a la ficha; conservar siempre la autorización original.
6. Los errores de MTDOM se reportan y reintentan sin revertir una importación exitosa.

### 6.2 Pacientes de autorizaciones históricas

- Extraer identidades distintas existentes en Medicarte con un proceso de solo lectura para análisis inicial.
- Evaluar **lookup puntual vs snapshot paginado** según volumen medido; si se usa snapshot, almacenar solamente pacientes vinculados a Medicarte.
- Completar el snapshot siguiendo `next_cursor` opaco, registrar `sync.as_of` y ejecutar inmediatamente el delta posterior para capturar cambios intermedios.
- Resolver ambigüedades mediante informe de conciliación sin fusionar registros automáticamente.

### 6.3 Cambios incrementales

1. Solicitar `/v1/patients/changes?since=<checkpoint>` con la credencial y perfil autorizados.
2. Recorrer `next_cursor` sin modificarlo; no mezclar parámetros iniciales cuando el cursor ya existe.
3. Aplicar UPSERT idempotente solo para pacientes locales pertinentes; evitar sobrescribir con versiones antiguas.
4. **Confirmar el nuevo checkpoint solo después de procesar todas las páginas**. Si falla, repetir desde el checkpoint anterior sin perder datos.
5. Publicar métricas agregadas: total observado, candidatos locales, actualizados, no encontrados, ambiguos, errores y frescura, sin datos personales.

La frecuencia (por ejemplo, cada hora) es **propuesta, no aprobada**; verificar primero volumen, límites, duraciones y disponibilidad de MTDOM.

## 7. Seguridad y protección de datos

- Primera etapa sugerida con scope `patients.read.basic`, aplicando minimización. `patients.read.personal` se habilitará solo con justificación y aprobación de tratamiento de datos personales.
- Token Bearer específico para Medicarte guardado en secretos de backend. Nunca exponer en navegador, URL, Excel, commits, telemetría o chats.
- Lookup utiliza `POST` para no incluir documentos en la URL. Establecer timeout, rate limits, reintentos con backoff y alertas de fallos de autenticación.
- No registrar payloads completos, nombres, documentos, teléfonos, direcciones o correos en logs o resultados de CI. Probar con identidades sintéticas.
- Definir consentimiento/base legal, finalidad, conservación, corrección y eliminación de datos personales antes de poblar `personal`.
- El control de acceso a la futura ficha de pacientes deberá quedar aprobado antes de exponer datos personales en la interfaz; sin cambios de RBAC por punto dentro de RF-PAC-001.

## 8. Invariantes de compatibilidad

- La API de MTDOM es de **solo lectura**: Medicarte no le escribe.
- No bloquear importaciones válidas por indisponibilidad de MTDOM o datos incompletos de paciente.
- No duplicar pacientes ni tareas por recargas/reintentos.
- No alterar históricos de autorización, puntos, OC, recepción, inventario, reservas, asignaciones ni consumos.
- No inferir punto habitual de la dirección o ciudad del paciente.
- Mantener interoperabilidad de consumidores que hoy leen paciente desde `authorization_items.source_data`.
- Aplicar nuevas estructuras aditivamente y con compatibilidad temporal; no migrar puntos históricos de forma silenciosa.

## 9. Criterios de aceptación propuestos

1. **CA-01.** Dos autorizaciones de una identidad verificada se vinculan al mismo paciente, incluso si llegan concurrentemente.
2. **CA-02.** Recargas idénticas no crean duplicados ni tareas de enriquecimiento repetidas.
3. **CA-03.** Una autorización válida queda guardada aunque MTDOM esté caído, tarde o devuelva `404`.
4. **CA-04.** Una respuesta `200` coherente de lookup enriquece únicamente campos autorizados y guarda procedencia/fecha.
5. **CA-05.** Lookup sin tipo con `409` no fusiona pacientes ni fuerza un vínculo.
6. **CA-06.** Error `401/403` detiene reintentos innecesarios y alerta configuración; errores transitorios respetan límites.
7. **CA-07.** El delta actualiza un paciente conocido sin crear otra identidad.
8. **CA-08.** Un fallo a mitad de la paginación no avanza el checkpoint; un reintento recupera cambios sin duplicados.
9. **CA-09.** Paciente ausente del último snapshot conserva histórico y muestra un estado de presencia de origen independiente.
10. **CA-10.** Actualizar datos personales no cambia punto habitual, programación, OC, inventario o recibos.
11. **CA-11.** Autorizaciones sin `patient_id` siguen funcionando mientras se completa la vinculación progresiva.
12. **CA-12.** La integración no registra secretos ni PII en logs ni expone datos fuera del backend.
13. **CA-13.** Con la integración deshabilitada, la plataforma conserva los comportamientos operacionales actuales.

## 10. Plan por etapas

1. Validación funcional, legal y técnica; inventario real de formatos y datos de identidad en autorizaciones.
2. Esquema aditivo y contrato mínimo de paciente, con integración deshabilitada por defecto.
3. Registro de identidades y lookup asíncrono con stubs/pruebas de duplicación y fallos.
4. Backfill histórico controlado y conciliación de identidades.
5. Delta incremental con checkpoint durable, seguridad y métricas.
6. Ficha de consulta y eventual migración del punto habitual a `patient_id` mediante iniciativa separada.

No ejecutar migraciones, resets, credenciales reales o pruebas contra producción durante el análisis. Antes de implementar, usar `AGENTS.md`, `requirements-implementation` y `drizzle-schema-safety`; validar con pruebas unitarias y PostgreSQL aislado.

## 11. Decisiones pendientes para la próxima conversación

| ID | Decisión | Propuesta a evaluar (no aprobada) |
| --- | --- | --- |
| DP-01 | ¿Sincronizar solo pacientes con autorizaciones o todo MTDOM? | Solo relacionados con Medicarte |
| DP-02 | ¿Qué campos se necesitan realmente y con qué base de tratamiento? | Perfil `basic` primero |
| DP-03 | ¿Cada cuánto ejecutar delta y cuándo refrescar a demanda? | Configurable tras medir volumen |
| DP-04 | ¿Qué hacer si no hay tipo de documento, cambia identidad o hay varias coincidencias? | Pendiente de conciliación, nunca fusionar solo por número |
| DP-05 | ¿Qué prevalece si existen datos personales corregidos localmente? | MTDOM para atributos de su competencia, con excepciones explícitas |
| DP-06 | ¿Cuánto reintentar `404`, timeout, `429` o `5xx`? | Backoff y límites por definir |
| DP-07 | ¿Cómo conservar o suprimir PII y quién autoriza el perfil personal? | Aprobación de responsable de datos |
| DP-08 | ¿Cuándo migrar `patient_default_dispensing_points` a vínculo por `patient_id`? | Después de conciliar identidades |
| DP-09 | ¿Quién consulta ficha personal y qué información se presenta? | Definir en una etapa de UI; sin revisar RBAC por puntos ahora |
| DP-10 | ¿Snapshot inicial o lookups puntuales y qué volumen/SLA? | Medir antes de elegir |

## 12. Fuera de alcance

- Cambiar reglas o prioridades de OC, inventario, puntos, atención o recepción.
- Modificar permisos por ubicación/punto, ejecutar despliegues o alterar datos de producción.
- Crear endpoints de escritura en MTDOM, importar indiscriminadamente toda la población o borrar históricos.
- Implementar funcionalidades sin resolver las decisiones que afectan identidades, PII y estados.

## 13. Fuentes revisadas

**Medicarte**
- [`AGENTS.md`](https://github.com/andresalvarezb/mtd-olp-medicarte/blob/develop/AGENTS.md)
- [Skill de requisitos](https://github.com/andresalvarezb/mtd-olp-medicarte/blob/develop/.agents/skills/requirements-documentation/SKILL.md)
- [Esquema actual](https://github.com/andresalvarezb/mtd-olp-medicarte/blob/develop/packages/database/src/schema.ts)
- [Flujo MTD](https://github.com/andresalvarezb/mtd-olp-medicarte/blob/develop/docs/flujo-mtd.md)

**MTDOM**
- [Catálogo de endpoints](https://github.com/FelipeMTD/mtdom-apis/blob/main/docs/api/API_CATALOG.md)
- [Patients Read API v1 — Consumo](https://github.com/FelipeMTD/mtdom-apis/blob/main/docs/api/PATIENTS_READ_API_V1_USAGE.md)
- [Patients Read API v1 — Operaciones](https://github.com/FelipeMTD/mtdom-apis/blob/main/docs/api/PATIENTS_READ_API_V1_OPERATIONS.md)

**Validación:** inspección estática de fuentes mediante GitHub; no hay pruebas, consultas autenticadas a MTDOM ni modificaciones de código. Los nombres de tablas propuestas no constituyen una migración aprobada.
