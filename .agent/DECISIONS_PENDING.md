# Decisiones de negocio — registro de cierre

Estados:

- `ACCEPTED`: suficientemente cerrada para implementación.
- `PARTIAL`: existe una decisión válida, pero falta una definición estructural.
- `PENDING`: no existe información suficiente.

## Resumen

| ID      | Estado   | Decisión                                                                                                                                                                                |
| ------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEC-001 | ACCEPTED | Un direccionamiento MIPRES es válido únicamente cuando `current_date(America/Bogota) < fecha_maxima`.                                                                                   |
| DEC-002 | ACCEPTED | Una llave existente solo puede actualizarse explícitamente si `operation_status = READY_TO_DISPENSE`. Se bloquea desde `DISPENSATION_REPORTED` en adelante.                             |
| DEC-003 | ACCEPTED | `DISPENSED` solo se alcanza cuando `audit_status = APPROVED`.                                                                                                                           |
| DEC-004 | ACCEPTED | Medicarte registra la dispensación al cargar los soportes; el sistema usa `DISPENSATION_REPORTED` hasta aprobación.                                                                     |
| DEC-005 | ACCEPTED | Los reportes se envían todos los días a las 08:00 `America/Bogota`, con novedades del día anterior. Los destinatarios son parametrizables.                                              |
| DEC-006 | ACCEPTED | La auditoría es humana y visual. La aprobación explícita del auditor es condición suficiente para `APPROVED`; no existe aprobación automática.                                          |
| DEC-007 | ACCEPTED | Los soportes permanecen en Drive sin vencimiento automático. Las exportaciones CSV/XLSX se generan bajo demanda y no se almacenan como copia persistente.                               |
| DEC-008 | ACCEPTED | Máximo 20 MB por archivo y volumen esperado de hasta 2.500 archivos por mes.                                                                                                            |
| DEC-009 | ACCEPTED | Despliegue esperado en Render, Google Cloud como alternativa, región requerida Colombia.                                                                                                |
| DEC-010 | ACCEPTED | El código se alojará en un repositorio nuevo e independiente en GitHub, estructurado como monorepo.                                                                                     |
| DEC-011 | ACCEPTED | Medicarte define y versiona el punto de aplicación; cada asignación o cambio notifica a OLP.                                                                                            |
| DEC-012 | ACCEPTED | Las autorizaciones son registros únicos y compartidos; el alcance se resuelve por usuario, organización, permisos y relación explícita del recurso, sin duplicar `authorization_items`. |
| DEC-013 | PENDING  | Falta contrato HTTP oficial de direccionamientos y acceso seguro al sandbox MIPRES. Su implementación real está prohibida.                                                              |
| DEC-014 | ACCEPTED | Una actualización explícita permitida recalcula `operation_status`: conserva `READY_TO_DISPENSE` solo si los prerrequisitos siguen válidos; en caso contrario queda `BLOCKED`.          |

---

## DEC-001 — Vigencia de direccionamiento MIPRES

**Estado:** ACCEPTED

```text
current_date(America/Bogota) < fecha_maxima
    => direction_status = CONFIRMED
```

La comparación es estricta. Si la fecha actual es igual o superior a `fecha_maxima`, el direccionamiento no es válido.

---

## DEC-002 — Actualización de una llave existente

**Estado:** ACCEPTED

Llave:

```text
NUMERO_AUTORIZACION + COD_COMERCIAL
```

Si ya existe:

1. No se actualiza automáticamente.
2. Se reporta para verificación humana.
3. Puede habilitarse una actualización explícita únicamente si:

```text
operation_status = READY_TO_DISPENSE
```

4. Debe bloquearse si:

```text
operation_status = DISPENSATION_REPORTED
```

o si ya avanzó a `DISPENSED`.

5. La actualización debe conservar auditoría de antes/después, actor, fecha e idempotencia. La evidencia compara las dimensiones F2 normalizadas, referencia las filas de importación anterior y nueva, y enlaza el registro idempotente sin duplicar datos sensibles del archivo en `audit_events`.

El resultado operacional posterior a una actualización permitida se rige por DEC-014.

---

## DEC-003 — Momento de `DISPENSED`

**Estado:** ACCEPTED

```text
audit_status = APPROVED
    => operation_status = DISPENSED
```

---

## DEC-004 — Registro y confirmación de dispensación

**Estado:** ACCEPTED

```text
READY_TO_DISPENSE
    -> DISPENSATION_REPORTED
    -> DISPENSED
```

- Medicarte registra la dispensación cuando carga los soportes requeridos.
- Ese hecho produce `DISPENSATION_REPORTED`.
- La auditoría es posterior.
- Solo `audit_status = APPROVED` produce `DISPENSED`.
- Un rechazo no elimina los soportes ni el registro histórico de dispensación.

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
- La acción humana explícita **Aprobar soportes** es suficiente para:

```text
audit_status = APPROVED
```

- La aprobación habilita:
  - `operation_status = DISPENSED`;
  - inclusión en consolidado;
  - derivación posterior de `READY_FOR_ADMISSION` cuando apliquen las demás reglas.
- Deben conservarse actor, fecha y decisión.

---

## DEC-007 — Drive y exportaciones

**Estado:** ACCEPTED

### Soportes

- Permanecen en el Drive corporativo.
- No existe fecha máxima de eliminación definida por esta aplicación.
- No se ejecutará borrado automático por antigüedad.
- El ID del Drive/carpeta destino es parametrizable.
- Cambiar el destino afecta únicamente cargas futuras y no rompe referencias históricas.

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

- Máximo por archivo: `20 MB`.
- Volumen esperado: hasta `2.500 archivos por mes`.
- La cifra de 2.500 es un supuesto de dimensionamiento, no un límite funcional mensual automático.

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

## DEC-011 — Coordinación logística del punto de aplicación

**Estado:** ACCEPTED

1. Cuando un registro entra en `READY_TO_DISPENSE`, se generan notificaciones event-driven a:
   - OLP;
   - Medicarte.
2. Medicarte define el punto/dirección donde realizará la aplicación.
3. La dirección se persiste, versiona y audita.
4. La primera asignación produce `APPLICATION_SITE_ASSIGNED`.
5. Una modificación produce `APPLICATION_SITE_CHANGED`.
6. Cada asignación/modificación genera una notificación event-driven a OLP con la dirección vigente.
7. La notificación permite a OLP saber dónde coordinar el envío del medicamento.
8. La aplicación/registro de dispensación requiere `application_site_status = ASSIGNED`.
9. El flujo posterior de soportes, auditoría y `DISPENSED` continúa sin cambios.
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

## DEC-013 — Contrato y sandbox MIPRES

**Estado:** PENDING

No se recibieron endpoint, autenticación, esquema oficial, fixtures aprobados ni credenciales de sandbox. El detalle de la evidencia necesaria está en `contracts/MIPRES_DIRECCIONAMIENTOS_SANDBOX.md`.

Mientras esta decisión permanezca abierta:

1. no implementar `MipresHttpAdapter` contra un contrato inferido;
2. no presentar fixtures inventados como respuestas oficiales;
3. no almacenar secretos en Git, documentación, frontend, logs o base de datos;
4. no iniciar el alcance funcional de Fase 3 que dependa del proveedor real.

Sí se mantienen como decisiones internas aceptadas la precondición `NO_PBS + ENABLED`, los estados internos, la capa anticorrupción y la comparación estricta de `fecha_maxima`.

---

## DEC-014 — Invariante operacional de actualización explícita

**Estado:** ACCEPTED

La actualización explícita reemplaza la evidencia de origen y reevalúa las cuatro columnas de negocio de la fila aprobada. Solo puede comenzar cuando el estado actual es `READY_TO_DISPENSE`, conforme a DEC-002.

La pareja normalizada `NUMERO_AUTORIZACION + COD_COMERCIAL` debe coincidir con la llave del ítem existente; sus componentes de identidad no cambian mediante esta acción.

Después de clasificar la nueva fila, la transacción recalcula `operation_status` con la regla pura centralizada:

```text
ENABLED + PBS + NOT_APPLICABLE
o
ENABLED + NO_PBS + CONFIRMED
    => READY_TO_DISPENSE

cualquier otra combinación
    => BLOCKED
```

En Fase 2, `NO_PBS + ENABLED` tiene direccionamiento `PENDING` porque MIPRES pertenece a Fase 3; por tanto, esa actualización queda `BLOCKED` sin realizar llamadas externas. Las actualizaciones posteriores a `DISPENSATION_REPORTED` o `DISPENSED` continúan prohibidas.

La actualización conserva control de versión, idempotencia y auditoría dentro de la misma transacción. La restricción equivalente en PostgreSQL impide persistir `READY_TO_DISPENSE` con prerrequisitos incompatibles desde cualquier ruta de escritura.
