# MIPRES, PBS y NO PBS: bloqueos, decisiones y fallas externas

**Corte de evidencia:** `develop` commit `97ade0b87f1a6e87730c89bf718169df41254155` (17-10-2026). **Clasificación:** `IMPLEMENTADO EN FUENTE` = código observado, no funcionalidad probada; `SIN FLUJO VERIFICADO` = no se identificó una operación específica entre controladores/contratos revisados; `REQUIERE DECISIÓN` = propuesta, no regla aprobada. **No se ejecutaron pruebas ni se accedió a producción.**

## Actores y separación de responsabilidades

- **MTD**, con `mipres.decision.manage`, decide manualmente en casos **NO PBS**; el controlador `POST /api/v1/mipres/:id/decision` exige `X-Organization-Id` e `Idempotency-Key` y el servicio vuelve a verificar autoridad en transacción.
- La consulta y el recheck de MIPRES son operaciones separadas. `POST /api/v1/mipres/:id/recheck` exige `mipres.recheck` y llave idempotente.
- La vigencia externa considera confirmado un direccionamiento **no anulado** cuando la fecha de Bogotá es **anterior**, no igual, a `maximumDeliveryDate` (`evaluateMipresVigencia`).
- Un `QUERY_ERROR` por falla externa no demuestra ausencia o cancelación de direccionamiento. Conservar error técnico y reintentar por el mecanismo autorizado.

## Casos especiales

| ID | Situación | Comportamiento observado o decisión requerida | Estado |
| --- | --- | --- | --- |
| CE-33 | AUTO PBS vigente, requisitos operativos satisfechos | Gate MIPRES no exige habilitación manual; continúan vigencia, AT y cantidad | IMPLEMENTADO EN FUENTE |
| CE-34 | AUTO NO PBS con prescripción | Gate MIPRES comienza bloqueado hasta `MANUALLY_ENABLED`; el direccionamiento se mantiene como evidencia | IMPLEMENTADO EN FUENTE |
| CE-35 | NO PBS sin número de prescripción | Rechazar `:id/decision` con `MIPRES_DECISION_NOT_APPLICABLE` | IMPLEMENTADO EN FUENTE |
| CE-36 | Habilitación manual con AUTO `DISABLED` | Rechazar `ENABLE` (`MIPRES_ENABLE_REQUIRES_ELIGIBLE_AUTHORIZATION`) | IMPLEMENTADO EN FUENTE |
| CE-37 | Habilitación manual con AUTO `PENDING` | Se puede levantar gate MIPRES, **pero la AUTO permanece PENDING** hasta satisfacer condiciones naturales | IMPLEMENTADO EN FUENTE |
| CE-38 | Decisión MIPRES repetida, versión vieja o concepto incorrecto | Rechazar sin cambio; validar `expectedVersion`, concepto activo y observación cuando se requiera | IMPLEMENTADO EN FUENTE |
| CE-39 | Respuesta externa inválida, timeout o fallo | Registrar `QUERY_ERROR`; no convertir automáticamente en denegación clínica | IMPLEMENTADO EN FUENTE |
| CE-40 | Reset o deshabilitación manual | `RESET` retorna a pendiente sin concepto; `DISABLE` requiere concepto válido; generar evidencia de autor y auditoría | IMPLEMENTADO EN FUENTE |

## Secuencia operacional

1. Identificar `coverageType`, número de prescripción, estado efectivo de AUTO, vigencia, cantidad y membresía al Anexo Tarifario.
2. En NO PBS, revisar el estado manual (`PENDING_MANUAL_ENABLEMENT`, `MANUALLY_ENABLED`, `MANUALLY_DISABLED`) independientemente del estado de autorización.
3. Consultar historial y evidencia externa; si es necesario, efectuar `recheck` como acción separada.
4. Ejecutar una decisión solamente bajo usuario/organización autorizados, con concepto y `expectedVersion` vigentes.
5. Comprobar que el resultado **no cambia arbitrariamente** el estado natural de la AUTO ni habilita una AUTO inhabilitada.

## Restricciones y trazabilidad

- Ningún error de conexión a MIPRES autoriza asumir prescripción inexistente.
- El caso de AUTO 16→5 se rige por [edición de autorizaciones](edicion-autorizaciones.md) y BR-AUTO-REN-001: la habilitación MIPRES no sustituye dicha regla.
- Registrar organismo, actor, correlación, estado anterior/posterior, concepto, fecha y respuesta. No almacenar tokens en evidencia operativa.

**Código verificado:** `apps/api/src/mipres/mipres-decision.controller.ts`, `mipres-decision.service.ts`, `mipres-recheck.controller.ts`, `mipres-recheck.service.ts`, `mipres-read-model.ts`; `packages/domain/src/mipres.ts`; `packages/domain/src/mipres-manual-decision.ts`.
