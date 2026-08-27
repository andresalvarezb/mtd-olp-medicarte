# Decisiones de negocio — registro de cierre

Estados:
- `RESOLVED`: suficientemente cerrada para implementación.
- `PARTIAL`: existe una decisión válida, pero falta una definición estructural.
- `PENDING`: no existe información suficiente.

## Resumen

| ID | Estado | Decisión |
|---|---|---|
| DEC-001 | RESOLVED | Un direccionamiento MIPRES es válido únicamente cuando `current_date(America/Bogota) < fecha_maxima`. |
| DEC-002 | RESOLVED | Una llave existente solo puede actualizarse explícitamente si `operation_status = READY_TO_DISPENSE`. Se bloquea desde `DISPENSATION_REPORTED` en adelante. |
| DEC-003 | RESOLVED | `DISPENSED` solo se alcanza cuando `audit_status = APPROVED`. |
| DEC-004 | RESOLVED | Medicarte registra la dispensación al cargar los soportes; el sistema usa `DISPENSATION_REPORTED` hasta aprobación. |
| DEC-005 | RESOLVED | Los reportes se envían todos los días a las 08:00 `America/Bogota`, con novedades del día anterior. Los destinatarios son parametrizables. |
| DEC-006 | RESOLVED | La auditoría es humana y visual. La aprobación explícita del auditor es condición suficiente para `APPROVED`; no existe aprobación automática. |
| DEC-007 | RESOLVED | Los soportes permanecen en Drive sin vencimiento automático. Las exportaciones CSV/XLSX se generan bajo demanda y no se almacenan como copia persistente. |
| DEC-008 | RESOLVED | Máximo 20 MB por archivo y volumen esperado de hasta 2.500 archivos por mes. |
| DEC-009 | RESOLVED | Despliegue esperado en Render, Google Cloud como alternativa, región requerida Colombia. |
| DEC-010 | RESOLVED | El código se alojará en un repositorio nuevo e independiente en GitHub, estructurado como monorepo. |

---

## DEC-001 — Vigencia de direccionamiento MIPRES

**Estado:** RESOLVED

```text
current_date(America/Bogota) < fecha_maxima
    => direction_status = CONFIRMED
```

La comparación es estricta. Si la fecha actual es igual o superior a `fecha_maxima`, el direccionamiento no es válido.

---

## DEC-002 — Actualización de una llave existente

**Estado:** RESOLVED

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

5. La actualización debe conservar auditoría de antes/después, actor, fecha e idempotencia.

---

## DEC-003 — Momento de `DISPENSED`

**Estado:** RESOLVED

```text
audit_status = APPROVED
    => operation_status = DISPENSED
```

---

## DEC-004 — Registro y confirmación de dispensación

**Estado:** RESOLVED

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

**Estado:** RESOLVED

- Hora: `08:00`.
- Zona horaria: `America/Bogota`.
- Ventana: día calendario inmediatamente anterior.
- Segmentación: cada entidad recibe únicamente sus novedades.
- Destinatarios: parametrizables; pueden agregarse o retirarse sin cambiar código.
- Los cambios de destinatarios deben quedar auditados y protegidos por permiso administrativo.

---

## DEC-006 — Auditoría

**Estado:** RESOLVED

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

**Estado:** RESOLVED

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

**Estado:** RESOLVED

- Máximo por archivo: `20 MB`.
- Volumen esperado: hasta `2.500 archivos por mes`.
- La cifra de 2.500 es un supuesto de dimensionamiento, no un límite funcional mensual automático.

---

## DEC-009 — Despliegue

**Estado:** RESOLVED

- Destino esperado: Render.
- Alternativa: Google Cloud.
- Región requerida: Colombia.
- Aplicación empaquetada con Docker para mantener portabilidad.

Si algún servicio seleccionado no ofrece presencia física compatible en Colombia, el despliegue productivo debe detenerse hasta una decisión explícita; ningún agente puede sustituir silenciosamente la región.

---

## DEC-010 — Repositorio

**Estado:** RESOLVED

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
