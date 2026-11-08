---
name: patient-master-integrity
description: Protege la identidad, el enlace histórico y la integración MTDOM de pacientes de Medicarte. Actívala al cambiar el maestro, el enlace de autorizaciones, el backfill/conciliación, la sincronización MTDOM o consumidores/accesos migrados por RF-PAC-001. No la actives solo porque una ruta incluya `patient`: excluye cambios aislados de presentación, programación o aplicación sin efecto en identidad, trazabilidad o compatibilidad.
---

# Integridad del maestro de pacientes Medicarte

## Alcance y fuentes

Esta skill es específica de identidad de pacientes y su transición desde autorizaciones; no es una regla general para módulos que contienen “patient” en el nombre. Leer `AGENTS.md`, `docs/requirements/RF-PAC-001-maestro-pacientes-mtdom.md` y `docs/requirements/RF-PAC-001-impacto-tecnico.md`, y confirmar en esquema, migraciones, contratos, código y pruebas actuales. La matriz es guía de navegación, no evidencia de comportamiento ni inventario exhaustivo.

Al implementar un requerimiento aprobado, delegar el flujo común a `requirements-implementation`; sumar `drizzle-schema-safety`, `rbac-point-scope` y `purchase-fulfillment-integrity` solo cuando se cumplan sus activadores. Para impacto entre módulos, usar `graphify` como mapa y confirmar relaciones en fuente y pruebas. Esta skill no sustituye esos procedimientos.

## Invariantes específicas de pacientes

1. La clave verificada es compuesta `(tipo_identificacion, identificacion)`. No quitar ceros ni colapsar tipos/separadores hasta aprobar reglas compatibles con las fuentes reales. No asignar una identidad canónica a componentes faltantes, contradictorios o ambiguos.
2. `authorization_items.patient_id` debe ser nullable durante la transición. `authorization_items.source_data` y las claves/autorizaciones históricas se conservan como evidencia; el enlace nuevo no reemplaza esas fuentes ni las relaciones operacionales.
3. Crear/reutilizar pacientes de manera idempotente aun con confirmaciones concurrentes. Backfill enlaza solo coincidencias únicas verificadas; los casos faltantes, en conflicto, `404` o `409` quedan pendientes de conciliación. Ningún fallo de identidad elimina o revierte una autorización.
4. La llamada HTTP a MTDOM es asíncrona y queda fuera de la transacción de confirmación/importación. Rechazar respuestas cuya identidad no corresponda a la solicitada. Reprocesar es seguro; el checkpoint no avanza hasta persistir todas las páginas y `next_cursor` se trata como opaco.
5. MTDOM es de solo lectura y no decide elegibilidad ni altera autorización, cantidades, prioridad de puntos, compra, recepción, inventario, reservas, dispensación, aplicación o auditoría. La ausencia/cambio de `activo`, `paciente_vivo` o presencia en fuente no purga ni cambia operación.
6. En consumidores, preservar equivalencia para filas enlazadas y `patient_id = NULL`, incluidos fallback y prioridad `programación activa → punto predeterminado → mapeo AT`. Nunca derivar punto de dirección o geografía ni reemplazar claves de trazabilidad.
7. OLP no accede al maestro. La ficha requiere permiso específico y enforcement de servidor por rol, organización y punto; leer una autorización relacionada no concede acceso automático a la ficha.
8. No habilitar perfil `personal` hasta decisión DP-07. No desplegar delta global mientras el feed pueda transferir datos de pacientes ajenos sin una solución y aprobación para ese procesamiento. No registrar secretos ni PII en logs, métricas, fixtures o reportes.

## Verificación específica y cierre

Exigir evidencia para identidad duplicada/concurrente, ambigüedad, importación con `NULL`, fallo externo, respuesta discordante, checkpoint con página fallida, conciliación y scope positivo/negativo cuando esas rutas cambien. Para regresión operacional, elegir pruebas del consumidor afectado; el nombre `patient-*` por sí solo no activa esta skill. Seguir `AGENTS.md` para Git y validación; nunca probar contra producción.

Al cerrar, informar invariantes cubiertas, pruebas efectivamente ejecutadas, límites y decisiones pendientes. No marcar como completa una fase sin evidencia.
