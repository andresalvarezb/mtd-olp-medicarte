# Contrato MIPRES de direccionamientos y sandbox

**Estado:** PENDING

## Bloqueo

No existe en el repositorio evidencia autoritativa suficiente para congelar el contrato HTTP real ni acceso al sandbox. Fase 3 no puede implementar `MipresHttpAdapter`, configurar credenciales reales ni crear fixtures presentados como oficiales hasta cerrar este documento.

La capa de dominio, el puerto y un fake pueden prepararse solo si no inventan nombres, valores o semantica del proveedor.

## Evidencia requerida para resolver

- URL base y endpoint de direccionamientos del sandbox.
- Metodo HTTP, version del contrato y parametros requeridos.
- Mecanismo de autenticacion, headers y proceso de rotacion/revocacion.
- Credenciales entregadas por un canal seguro; nunca se documentan sus valores en Git.
- Esquema oficial de solicitud y respuesta, incluida paginacion si aplica.
- Definicion de campos para identificar autorizacion/paciente/medicamento y `fecha_maxima`.
- Semantica oficial de respuesta vacia y de estados HTTP 400, 401, 403, 404, 429 y 5xx.
- Fixtures anonimizados aprobados: direccionamiento vigente, vencido, ausencia, respuesta invalida y error.
- Limites de cuota, timeout recomendado y restricciones de concurrencia del proveedor.
- Responsable funcional y tecnico que aprueba el mapeo externo-interno.

## Contrato interno ya aceptado

- Solo se consulta para `coverage_type = NO_PBS` y `enablement_status = ENABLED`.
- `CONFIRMED` requiere al menos un direccionamiento con `current_date(America/Bogota) < fecha_maxima`.
- Igualdad con `fecha_maxima` no es valida.
- Ausencia de direccionamiento produce `PENDING`; un fallo tecnico produce `QUERY_ERROR`.
- Cada intento crea evidencia historica y no sobrescribe respuestas anteriores.
- El dominio depende de `MipresPort`; los nombres del proveedor no se filtran fuera del adaptador.

## Gestion de credenciales

Cuando sean entregadas, las credenciales se referencian mediante secretos por ambiente. Solo se documentaran nombres de variables o referencias al gestor, propietario, fecha de alta y procedimiento de rotacion; nunca tokens, claves o datos personales.

## Criterio de cierre

El estado cambia a `ACCEPTED` unicamente cuando los artefactos anteriores hayan sido verificados contra sandbox y aprobados. El cambio debe sincronizar este contrato, `DECISIONS_PENDING.md`, `SPEC-003`, fixtures de contrato e `IMPLEMENTATION_PLAN.md`.
