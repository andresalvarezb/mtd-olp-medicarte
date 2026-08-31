# Decisiones de negocio — registro de cierre

Estados:

- `ACCEPTED`: suficientemente cerrada para implementación.
- `PARTIAL`: existe una decisión válida, pero falta una definición estructural.
- `PENDING`: no existe información suficiente.

## Resumen

| ID      | Estado   | Decisión                                                                                                                                                                                |
| ------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEC-001 | ACCEPTED | Un direccionamiento MIPRES es válido únicamente cuando `current_date(America/Bogota) < fecha_maxima`.                                                                                   |
| DEC-002 | ACCEPTED | La evidencia F2 de una llave existente solo se actualiza explícitamente en `LISTO_PARA_DISPENSAR`; el bloqueo posterior no aplica a los bulk updates tipados.                          |
| DEC-003 | ACCEPTED | `DISPENSADO` solo se alcanza cuando `audit_status = APROBADO`.                                                                                                                          |
| DEC-004 | ACCEPTED | OLP reporta `fecha_dispensacion` por carga masiva; el sistema usa `DISPENSACION_REPORTADA` hasta aprobación humana.                                                                     |
| DEC-005 | ACCEPTED | Los reportes se envían todos los días a las 08:00 `America/Bogota`, con novedades del día anterior. Los destinatarios son parametrizables.                                              |
| DEC-006 | ACCEPTED | La auditoría es humana y visual. La aprobación explícita del auditor es condición suficiente para `APROBADO`; no existe aprobación automática.                                         |
| DEC-007 | ACCEPTED | Medicarte administra soportes directamente en Drive fuera de la aplicación; las exportaciones CSV/XLSX son on-demand y no persistentes.                                                 |
| DEC-008 | ACCEPTED | Máximo 20 MB por archivo para importaciones y actualizaciones masivas.                                                                                                                  |
| DEC-009 | ACCEPTED | Despliegue esperado en Render, Google Cloud como alternativa, región requerida Colombia.                                                                                                |
| DEC-010 | ACCEPTED | El código se alojará en un repositorio nuevo e independiente en GitHub, estructurado como monorepo.                                                                                     |
| DEC-011 | ACCEPTED | Medicarte actualiza masivamente `lugar_dispensacion`; cada asignación o cambio persistido notifica a OLP.                                                                               |
| DEC-012 | ACCEPTED | Las autorizaciones son registros únicos y compartidos; el alcance se resuelve por usuario, organización, permisos y relación explícita del recurso, sin duplicar `authorization_items`. |
| DEC-013 | ACCEPTED | Integración de lectura con `WSSUMMIPRESNOPBS` para validar vigencia de direccionamientos. Contrato aceptado en `contracts/MIPRES_DIRECCIONAMIENTOS_CONTRATO.md`; autoriza Fase 3.       |
| DEC-014 | ACCEPTED | Una actualización explícita permitida recalcula `operation_status`: conserva `LISTO_PARA_DISPENSAR` solo si los prerrequisitos siguen válidos; en caso contrario queda `BLOQUEADO`. |
| DEC-015 | ACCEPTED | Un pipeline tipado reutilizable procesa las tres actualizaciones operativas; descargas completas y cargas de llave + un campo.                                                          |
| DEC-016 | ACCEPTED | La columna `No.PRESCRIPCION` clasifica la cobertura: vacía produce `PBS`, no vacía produce `NO_PBS`; la API MIPRES recibe el valor sin sus últimos 3 dígitos.                           |
| DEC-017 | ACCEPTED | La reversión de cargues usa hard delete controlado (ADR-023); las notificaciones de creación LISTO/EPS no bloquean y cualquier otra actividad posterior sí bloquea con causal estable. |
| DEC-018 | ACCEPTED | Solo los registros exclusivamente LISTO_PARA_DISPENSAR sin intervención operativa expiran por FECHA_FINAL_VIGENCIA; los registros con actividad operativa preservan su estado y trazabilidad. |
| DEC-019 | ACCEPTED | Columnas canónicas de descarga estandarizadas en todas las exportaciones: NUMERO_AUTORIZACION, NUM_DOCUMENTO, NOMBRE_PACIENTE, CDGN001, COD_COMERCIAL, CUPS_AUTORIZADO, CANTIDAD, DOSIS, FECHA_ASIGNACION, FECHA_FINAL_VIGENCIA, ESTADO_AUTORIZACION, No.PRESCRIPCION, más columnas derivadas del proceso; CPRG se omite. |

---

## DEC-001 — Vigencia de direccionamiento MIPRES

**Estado:** ACCEPTED

```text
current_date(America/Bogota) < fecha_maxima
    => direction_status = CONFIRMADO
```

La comparación es estricta. Si la fecha actual es igual o superior a `fecha_maxima`, el direccionamiento no es válido.

---

## DEC-002 — Actualización de evidencia F2 de una llave existente

**Estado:** ACCEPTED

Llave:

```text
NUMERO_AUTORIZACION + COD_COMERCIAL
```

Si ya existe y se intenta reemplazar la evidencia de importación F2:

1. No se actualiza automáticamente.
2. Se reporta para verificación humana.
3. Puede habilitarse una actualización explícita únicamente si:

```text
operation_status = LISTO_PARA_DISPENSAR
```

4. Debe bloquearse si:

```text
operation_status = DISPENSACION_REPORTADA
```

o si ya avanzó a `DISPENSADO`.

5. La actualización debe conservar auditoría de antes/después, actor, fecha e idempotencia. La evidencia compara las dimensiones F2 normalizadas, referencia las filas de importación anterior y nueva, y enlaza el registro idempotente sin duplicar datos sensibles del archivo en `audit_events`.

El resultado operacional posterior a una actualización permitida se rige por DEC-014.

Esta decisión no prohíbe las correcciones de `lugar_dispensacion`, `fecha_dispensacion` o `fecha_aplicacion` definidas en DEC-015/ADR-022; esos contratos no reemplazan evidencia F2 y aplican sus propias precondiciones.

---

## DEC-003 — Momento de `DISPENSADO`

**Estado:** ACCEPTED

```text
audit_status = APROBADO
    => operation_status = DISPENSADO
```

---

## DEC-004 — Registro y confirmación de dispensación

**Estado:** ACCEPTED

```text
LISTO_PARA_DISPENSAR
    -> DISPENSACION_REPORTADA
    -> DISPENSADO
```

- OLP registra masivamente `fecha_dispensacion` después de recibir `lugar_dispensacion`.
- La primera persistencia válida de la fecha produce `DISPENSACION_REPORTADA`.
- Una modificación posterior conserva trazabilidad y no retrocede el estado.
- La auditoría es posterior.
- Solo `audit_status = APROBADO` produce `DISPENSADO`.
- Un rechazo no elimina el historial operativo ni los soportes externos.

---

## DEC-005 — Reportes diarios

**Estado:** ACCEPTED

- Hora: `08:00`.
- Zona horaria: `America/Bogota`.
- Ventana: día calendario inmediatamente anterior.
- Segmentación: cada entidad recibe únicamente sus novedades.
- Destinatarios: parametrizables; pueden agregarse o retirarse sin cambiar código.
- Los cambios de destinatarios deben quedar auditados y protegidos por permiso administrativo.

---

## DEC-006 — Auditoría

**Estado:** ACCEPTED

- La auditoría es humana y visual.
- Solo un auditor autorizado puede aprobar o rechazar.
- No existe aprobación automática.
- La acción humana explícita **Aprobar** produce:

```text
audit_status = APROBADO
```

- La aprobación habilita:
  - `operation_status = DISPENSADO`;
  - inclusión en consolidado;
  - derivación de `admission_status = READY`, que habilita la descarga de la base para el proceso de admisión externo.
- Deben conservarse actor, fecha y decisión.
- La aplicación no determina completitud documental. La existencia de ambas fechas habilita la revisión, pero solo la decisión humana produce aprobación.

---

## DEC-007 — Drive y exportaciones

**Estado:** ACCEPTED

### Soportes

- Medicarte los carga y administra directamente en el Drive corporativo, fuera del flujo de archivos de la aplicación.
- La aplicación no sube, descarga, versiona, cuenta ni valida soportes individuales.
- No existe relación obligatoria `attachment -> authorization_item` ni estado automático de completitud.
- La referencia al Drive/carpeta puede mantenerse como configuración administrativa de MTD, sin que implique integración por archivo.
- Retención, movimiento y versionado de archivos pertenecen a las políticas externas de Drive.

### Exportaciones

- Formatos: CSV y XLSX.
- Se generan cuando el usuario solicita exportar.
- No se conserva una copia persistente en el sistema.
- Puede usarse streaming, memoria o almacenamiento temporal efímero durante la respuesta.
- Si existe un temporal, debe eliminarse al completar/fallar la descarga.
- Sí se conserva auditoría de la exportación: actor, fecha, filtros, formato y resultado.

---

## DEC-008 — Capacidad inicial

**Estado:** ACCEPTED

- Máximo por archivo de importación o actualización masiva: `20 MB`.
- El supuesto previo de 2.500 soportes mensuales queda retirado porque la aplicación ya no recibe esos archivos.

---

## DEC-009 — Despliegue

**Estado:** ACCEPTED

- Destino esperado: Render.
- Alternativa: Google Cloud.
- Región requerida: Colombia.
- Aplicación empaquetada con Docker para mantener portabilidad.

Si algún servicio seleccionado no ofrece presencia física compatible en Colombia, el despliegue productivo debe detenerse hasta una decisión explícita; ningún agente puede sustituir silenciosamente la región.

---

## DEC-010 — Repositorio

**Estado:** ACCEPTED

Decisión final:

- Se creará un repositorio **nuevo e independiente en GitHub**.
- La estructura será un **monorepo**.
- Nombre lógico recomendado: `authorization-platform`.
- No se incorporará esta plataforma a `vita-back` ni `vita-core`.

Estructura base:

```text
authorization-platform/
├── apps/
│   ├── web/
│   ├── api/
│   └── worker/
├── packages/
│   ├── contracts/
│   ├── database/
│   ├── domain/
│   ├── ui/
│   └── config/
├── docs/
├── infra/
├── tests/
└── .agent/
```

La estructura física definitiva debe respetar los límites de módulos y dependencias definidos en la arquitectura y los ADR.

---

## Regla de mantenimiento

Al cambiar una decisión:

1. actualizar este archivo;
2. actualizar ADR afectado;
3. actualizar SPEC afectada;
4. actualizar pruebas;
5. revisar `IMPLEMENTATION_PLAN.md` e `INDEX.md`.

---

## DEC-011 — Coordinación logística del lugar de dispensación

**Estado:** ACCEPTED

1. Cuando un registro entra en `LISTO_PARA_DISPENSAR`, se generan notificaciones event-driven a:
   - OLP;
   - Medicarte.
2. Medicarte descarga la base completa permitida y define `lugar_dispensacion` mediante carga masiva reducida.
3. El valor vigente se persiste en `authorization_items` y cada cambio conserva historial y auditoría.
4. La primera asignación produce `DISPENSATION_LOCATION_ASSIGNED`.
5. Una modificación produce `DISPENSATION_LOCATION_CHANGED`.
6. Cada asignación/modificación genera una notificación event-driven a OLP con la dirección vigente.
7. La notificación permite a OLP saber dónde coordinar el envío del medicamento.
8. OLP reporta `fecha_dispensacion`; Medicarte reporta `fecha_aplicacion`, ambos por carga masiva reducida.
9. Los soportes permanecen externos y la auditoría continúa como decisión humana.
10. El reporte diario de las 08:00 sigue existiendo como consolidado y no reemplaza estas notificaciones operativas.

---

## DEC-012 — Alcance multi-organización de autorizaciones

**Estado:** ACCEPTED

Una autorización es un único registro global. La llave `NUMERO_AUTORIZACION + COD_COMERCIAL` no se replica por organización.

El acceso se decide en backend usando, conjuntamente:

- identidad local del usuario;
- organización seleccionada;
- membresía y permisos vigentes;
- relación explícita entre la autorización y la organización, salvo MTD, que tiene lectura global según su permiso.

En el alcance inicial:

- MTD tiene lectura global y acciones según sus permisos;
- Compensar, OLP y Medicarte tienen lectura de autorizaciones relacionadas y autorizada por `authorizations.read`;
- las acciones específicas de OLP y Medicarte quedan fuera de Fase 2 y dependerán del estado posterior del proceso.

Fase 2 persiste la relación en `authorization_item_organizations` y no crea copias del ítem principal. Para los cuatro organismos iniciales de la plataforma, un ítem confirmado queda relacionado con cada organización activa del alcance inicial; organizaciones futuras requieren una relación explícita.

La UI puede ocultar acciones, pero toda consulta y mutación vuelve a validar el alcance en el backend y en la consulta a PostgreSQL. Un replay idempotente no omite esta validación y redacta su respuesta con los permisos sensibles vigentes.

---

## DEC-013 — Consulta MIPRES de direccionamientos

**Estado:** ACCEPTED

Se adopta la integración de producción con:

```text
WSSUMMIPRESNOPBS
```

Base URL:

```text
https://wsmipres.sispro.gov.co/WSSUMMIPRESNOPBS
```

La integración tendrá exclusivamente el propósito de consultar los direccionamientos asociados al número de prescripción de una fórmula NO PBS habilitada y determinar si existe alguno vigente. Es de solo lectura: no crea, modifica ni anula direccionamientos, ni consulta programación, entrega o suministro.

Endpoints utilizados:

```http
GET /api/GenerarToken/{nit}/{token}

GET /api/DireccionamientoXPrescripcion/{nit}/{token}/{noPrescripcion}
```

El NIT y token inicial son secretos de infraestructura configurados mediante:

```text
MIPRES_NIT
MIPRES_INITIAL_TOKEN
```

La base URL se configura mediante:

```text
MIPRES_BASE_URL
```

El token operativo se obtiene mediante `GenerarToken` y es responsabilidad de `MipresTokenProvider`.

La vigencia se determina utilizando `FecMaxEnt`.

Regla:

```text
current_date(America/Bogota) < FecMaxEnt
```

La igualdad con `FecMaxEnt` no es válida.

Un direccionamiento anulado no puede producir `CONFIRMADO`.

Resultados internos:

```text
CONFIRMADO
PENDIENTE
ERROR_DE_CONSULTA
```

`CONFIRMADO` requiere al menos un direccionamiento vigente.

`PENDIENTE` representa ausencia de direccionamientos o existencia únicamente de direccionamientos no vigentes.

`ERROR_DE_CONSULTA` representa incapacidad técnica de determinar el resultado.

El dominio depende exclusivamente de `MipresPort`.

Los contratos y nombres propios de MIPRES permanecen dentro de `MipresHttpAdapter`.

Cada consulta conserva evidencia histórica y no sobrescribe consultas anteriores.

Nunca se almacenan o registran tokens completos en Git, frontend, logs, auditoría o payloads históricos.

El detalle técnico completo del contrato está en `contracts/MIPRES_DIRECCIONAMIENTOS_CONTRATO.md`. La fuente de `noPrescripcion` quedó resuelta con DEC-016: la columna `No.PRESCRIPCION` del archivo de importación, tras retirar sus últimos 3 dígitos.

Con esta decisión queda autorizado implementar el alcance correspondiente de Fase 3.

---

## DEC-014 — Invariante operacional de actualización explícita

**Estado:** ACCEPTED

La actualización explícita reemplaza la evidencia de origen y reevalúa las cuatro columnas de negocio de la fila aprobada. Solo puede comenzar cuando el estado actual es `LISTO_PARA_DISPENSAR`, conforme a DEC-002.

La pareja normalizada `NUMERO_AUTORIZACION + COD_COMERCIAL` debe coincidir con la llave del ítem existente; sus componentes de identidad no cambian mediante esta acción.

Después de clasificar la nueva fila, la transacción recalcula `operation_status` con la regla pura centralizada:

```text
HABILITADO + PBS + NO_APLICA
o
HABILITADO + NO_PBS + CONFIRMADO
    => LISTO_PARA_DISPENSAR

cualquier otra combinación
    => BLOQUEADO
```

En Fase 2, `NO_PBS + HABILITADO` tiene direccionamiento `PENDIENTE` porque MIPRES pertenece a Fase 3; por tanto, esa actualización queda `BLOQUEADO` sin realizar llamadas externas. Las actualizaciones posteriores a `DISPENSACION_REPORTADA` o `DISPENSADO` continúan prohibidas.

La actualización conserva control de versión, idempotencia y auditoría dentro de la misma transacción. La restricción equivalente en PostgreSQL impide persistir `LISTO_PARA_DISPENSAR` con prerrequisitos incompatibles desde cualquier ruta de escritura.

---

## DEC-015 — Descargas y actualizaciones operativas masivas

**Estado:** ACCEPTED

- Se adopta un único pipeline parametrizado por tipos cerrados, conforme a ADR-022 y SPEC-013.
- MEDICARTE: `authorization_key` + `lugar_dispensacion`, o `authorization_key` + `fecha_aplicacion_medicamento`; esta última columna externa persiste en el campo de negocio `fecha_aplicacion DATE`.
- OLP: llave + `fecha_dispensacion`.
- Las descargas contienen la base completa que el actor pueda consultar; las cargas no reutilizan esa base completa como contrato de escritura.
- Backend valida esquema exacto, actor, permiso, alcance, estado y campo por fila.
- Se reutilizan máximo 20 MB, PostgreSQL `BYTEA` temporal, BullMQ con identificadores, staging, causales, auditoría e idempotencia.
- Los valores vigentes viven en `authorization_items` y los cambios en historial append-only.
- `lugar_dispensacion` es texto libre; sin validación de estructura de dirección.
- `fecha_aplicacion` es corregible mientras `audit_status` no sea `APROBADO`; tras la aprobación el campo queda inmutable.
- La existencia de `fecha_dispensacion` y `fecha_aplicacion` produce `audit_status = LISTO`; la aprobación continúa siendo exclusivamente humana.

---

## DEC-016 — Clasificación PBS/NO PBS por `No.PRESCRIPCION`

**Estado:** ACCEPTED

1. El archivo de importación agrega la columna `No.PRESCRIPCION`. El diccionario pasa de 25 a 26 columnas; el encabezado es obligatorio, pero su valor puede ser vacío.
2. La clasificación de cobertura se define por la presencia del valor normalizado:

```text
No.PRESCRIPCION vacio      => coverage_type = PBS
No.PRESCRIPCION no vacio   => coverage_type = NO_PBS
```

3. `CUPS_PRINCIPAL` pierde su semántica de negocio y pasa a columna de evidencia, igual que `COD_CUPS_PRINCIPAL`.
4. El contenido de `No.PRESCRIPCION` es numérico. Para consumir la API MIPRES se deriva:

```text
no_prescripcion = No.PRESCRIPCION sin sus ultimos 3 digitos de la derecha
```

5. Validación de la columna: si el valor no está vacío debe contener solo dígitos y tener longitud mayor a 3 (para que la truncación sea posible); en caso contrario la fila produce `INVALID_FIELD_FORMAT`.
6. Se conserva el valor original como evidencia y el valor derivado como dato de negocio que alimenta `MipresPort`.
7. Las cuatro columnas de negocio de F2 quedan: `NUMERO_AUTORIZACION`, `COD_COMERCIAL`, `ESTADO_AUTORIZACION` y `No.PRESCRIPCION`.
8. Las reglas previas no cambian: `ESTADO_AUTORIZACION = 5` habilita; PBS usa `direction_status = NO_APLICA`; solo `NO_PBS + HABILITADO` consulta MIPRES; la actualización explícita reevalúa cobertura con esta regla conforme a DEC-014.

---

## DEC-017 — Reversión segura de cargues de autorizaciones

**Estado:** ACCEPTED (aprobada por el responsable en sesión de diseño del 2026-08-31; detalle completo en ADR-023)

1. Modelo adoptado: **hard delete controlado**. Se descarta soft delete/invalidación porque el índice único `numero_autorizacion + codigo_medicamento` bloquearía la reimportación de la llave corregida y obligaría a filtrar el flag en todas las lecturas del sistema. La evidencia sobrevive en `import_rows`, `import_source_files` y `audit_events`.
2. La selección de ítems es exclusivamente por `created_from_batch_id`. Los ítems preexistentes detectados o actualizados por el cargue nunca se eliminan.
3. Las notificaciones `AUTHORIZATION_READY_TO_DISPENSE` y `EPS_DIRECTION_PENDING`, generadas por la propia confirmación del cargue, **no bloquean** la eliminación (forman parte de la unidad revertida; los correos ya enviados son un riesgo documentado). Cualquier otra notificación del ítem bloquea.
4. Actividad posterior que bloquea con causal estable: auditoría (`audit_status <> NO_INICIADO` o `audit_reviews`), MIPRES (`mipres_checks`), actualizaciones operativas/logística (`operational_field_changes`, `bulk_update_rows`, `operational_version > 0`, lugar o fechas no nulas), evidencia de origen reemplazada (`coverage_evaluations` v>1) y referencias de cargues posteriores (`import_rows` de otros lotes).
5. El `import_batch` nunca se elimina: `COMPLETADO → REVIRTIENDO → REVERTIDO` con `reverted_at`, `reverted_by` y contadores; la transacción completa (plan, borrados, estado, auditoría, idempotencia) o rollback total.
6. Permiso atómico `imports.revert`, únicamente MTD_ADMIN; validado en backend en preview y ejecución.
7. Auditoría inmutable: `IMPORT_BATCH_REVERTED` y `AUTHORIZATION_ITEM_REMOVED_BY_IMPORT_ROLLBACK`, con correlation ID; sobreviven al borrado del negocio.
8. Confirmaciones del responsable (sesión del 2026-08-31): no se requiere retractar los correos ya enviados por las notificaciones de creación; la acción de reversión en UI se limita a los lotes de la sesión vigente (no hay reversión de sesiones anteriores).

---

## DEC-018 — Expiración solo para registros sin intervención operativa

**Estado:** ACCEPTED

La regla de expiración por `FECHA_FINAL_VIGENCIA` solo se aplica a registros que están exclusivamente en `LISTO_PARA_DISPENSAR` y no han tenido ninguna actividad operativa. Si un registro tuvo cualquier intervención operativa (asignación de lugar, reporte de dispensación, reporte de aplicación, cambio de versión operativa), se preserva su estado y trazabilidad aunque la vigencia haya expirado.

**Criterios de intervención operativa:**

```text
lugar_dispensacion IS NOT NULL
or fecha_dispensacion IS NOT NULL
or fecha_aplicacion IS NOT NULL
or operational_version > 0
```

**Implementación:**

1. `deriveOperationStatus` acepta un flag opcional `hasOperationalIntervention: boolean`. Cuando es `true` y el estado derivado sería `VENCIDO`, devuelve `LISTO_PARA_DISPENSAR` en su lugar.
2. `runExpirationSweep` (worker) excluye registros con intervención operativa del UPDATE.
3. Los procesadores MIPRES y revalidación tarifaria pasan el flag basándose en los campos del registro.

---

## DEC-019 — Columnas canónicas de descarga

**Estado:** ACCEPTED

Todas las exportaciones operativas, consolidadas y de EPS novedades incluyen exactamente las siguientes columnas de origen:

| Columna origen      | Alias de destino     | Descripción                       |
| ------------------- | -------------------- | --------------------------------- |
| NUMERO_AUTORIZACION | codigo_autorizacion  | Número de autorización            |
| NUM_DOCUMENTO       | numero_documento     | Documento del paciente            |
| NOMBRE_PACIENTE     | nombre_paciente      | Nombre completo del paciente      |
| COD_COMERCIAL       | codigo_producto      | Código comercial del medicamento  |
| CUPS_AUTORIZADO     | nombre_producto      | Nombre CUPS del producto          |
| CANTIDAD            | cantidad             | Cantidad autorizada               |
| DOSIS               | dosis                | Dosis prescrita                   |
| FECHA_ASIGNACION    | fecha_asignacion     | Fecha de asignación               |
| FECHA_FINAL_VIGENCIA| fecha_vigencia       | Fecha final de vigencia           |
| ESTADO_AUTORIZACION | estado_autorizacion  | Estado original del archivo       |
| No.PRESCRIPCION     | no_prescripcion      | Número de prescripción            |

A estas columnas se suman las columnas derivadas del proceso: `id`, `authorization_key`, `enablement_status`, `coverage_type`, `direction_status`, `operation_status`, `tariff_membership_status`, `lugar_dispensacion`, `fecha_dispensacion`, `fecha_aplicacion_medicamento`, `audit_status`, `admission_status` (si aplica), `application_site_status`, `operational_version`, `version`, `created_at`, `updated_at`, y columnas específicas de EPS (`resultado_validacion`, `causal`, `detalle_novedad`).
