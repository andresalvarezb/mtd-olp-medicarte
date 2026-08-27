# SPEC-006 — Auditoría, hallazgos y consolidación
**Fase:** 6

## Flujo
`NOT_STARTED -> READY -> IN_REVIEW -> APPROVED|REJECTED`.

Un rechazo puede requerir corrección de soportes sin borrar evidencia ni la revisión anterior.

## Funciones
- iniciar revisión;
- crear hallazgos tipificados;
- rechazar;
- registrar subsanación;
- aprobar;
- generar consolidado asíncrono;
- calcular indicadores.

## Reglas confirmadas
- Solo `audit_status = APPROVED` es elegible para el consolidado definitivo.
- Un registro rechazado o pendiente no puede entrar al consolidado.
- Las exportaciones deben soportar CSV y XLSX/Excel.
- Se generan bajo demanda y no se persiste una copia del archivo exportado.
- Debe auditarse la acción de exportar.
- `READY_FOR_ADMISSION` se deriva. La UI no puede marcarlo manualmente.

## Aprobación de auditoría
- La revisión es humana y visual.
- Solo un auditor autorizado puede producir `APPROVED`.
- No existe aprobación automática.
- La acción explícita de aprobar soportes es condición suficiente para `audit_status = APPROVED`.
- Deben registrarse actor y timestamp.

## Aceptación
No permitir aprobación automática; únicamente un auditor autorizado puede ejecutar la aprobación explícita; export no bloquea API; permisos y auditoría aplicados.
