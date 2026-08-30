# SPEC-006 — Auditoría humana, hallazgos y consolidación

**Fase:** 6

## Flujo

```text
NOT_STARTED -> READY -> IN_REVIEW -> APPROVED | REJECTED
```

`READY` significa disponible para revisión, no “soportes completos”. Un rechazo puede dar lugar a correcciones externas en Drive y a una revisión posterior sin borrar decisiones ni hallazgos previos.

Después de correcciones externas, un auditor autorizado puede iniciar una nueva revisión `REJECTED -> IN_REVIEW`. La plataforma no detecta automáticamente cambios en Drive y cada revisión conserva su propia decisión e historial.

`NOT_STARTED -> READY` se deriva cuando existen `fecha_dispensacion` y `fecha_aplicacion`. Esta derivación no inspecciona soportes ni aprueba el registro.

## Funciones

- iniciar revisión;
- registrar observaciones y hallazgos cuando correspondan;
- aprobar o rechazar explícitamente;
- registrar revisiones posteriores conservando historial;
- generar consolidado on-demand;
- calcular indicadores.

## Regla de soportes

El auditor consulta externamente los soportes administrados por MEDICARTE en Drive. La plataforma no enumera archivos, no valida tipos/cantidades y no calcula completitud. La suficiencia documental es una decisión humana.

Solo un auditor MTD autorizado puede producir `APPROVED` o `REJECTED`. Cada decisión registra actor, organización, timestamp, observaciones y hallazgos cuando existan. Ningún job, conteo, integración o regla automática puede producir `APPROVED`.

## Consolidación

- Solo `audit_status = APPROVED` es elegible para el consolidado definitivo.
- Un registro rechazado o pendiente no entra al consolidado.
- `APPROVED` deriva `operation_status = DISPENSED` y habilita la derivación de `admission_status = READY`.
- CSV/XLSX se genera on-demand, sin copia persistente, y se audita.
- `admission_status = READY` se deriva; la UI no puede marcarlo manualmente. La descarga de la base de registros en ese estado inicia el proceso de admisión, que es externo a la plataforma: no existe handoff, cola ni estados posteriores de admisión en el núcleo.

## Aceptación

- Solo un auditor autorizado puede aprobar/rechazar.
- Toda decisión conserva actor, fecha, observaciones e historial.
- Un auditor puede registrar su evaluación manual sin que la plataforma afirme completitud automática.
- Ningún soporte o cambio en Drive altera estados automáticamente.
- Exportación no bloquea la API y aplica permisos y auditoría.
