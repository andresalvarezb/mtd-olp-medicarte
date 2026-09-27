# ADR-044 — REALTIME-01: invalidación operacional global

## Estado

ACCEPTED / WAVE REALTIME-1.

## Decisión

Toda transacción de dominio que, una vez confirmada, pueda modificar directa o
indirectamente un recurso, estado derivado, bandeja, novedad, contador o indicador
visible registra dentro de la misma transacción una invalidación durable en
`outbox_events` para cada organización destinataria autorizada.

PostgreSQL continúa siendo la única fuente de verdad. El canal realtime no transporta
el estado de negocio ni sustituye la API: únicamente indica qué proyecciones deben
reconciliarse.

```text
business transaction
  -> outbox_events (same transaction)
  -> COMMIT
  -> worker
  -> Redis Pub/Sub
  -> authenticated fetch-SSE
  -> RealtimeProvider
  -> topic invalidation
  -> API refetch
  -> PostgreSQL
```

## Garantías

1. Nunca se publica una invalidación de una transacción no confirmada.
2. La pérdida de un mensaje realtime no implica pérdida de datos: conexión inicial y
   reconexión invalidan nuevamente los read models montados y fuerzan consulta a API.
3. Un evento duplicado no duplica efectos funcionales. El cliente deduplica por
   `eventId` y los cambios funcionales viven exclusivamente en PostgreSQL.
4. Redis/BullMQ no son fuente de verdad.
5. El frontend no es frontera de seguridad. Cada refetch conserva RBAC, organización y
   point scope de la API.
6. El mensaje realtime no incluye datos clínicos ni personales; contiene solamente
   organización, topics y metadatos de correlación. Las referencias de recurso son
   opcionales en el contrato, pero REALTIME-1 no las publica a audiencias organizacionales
   amplias para no filtrar IDs a usuarios limitados por point scope.

## Transporte

La Web usa SSE sobre `fetch`, no `EventSource` nativo, porque la autenticación actual
usa `Authorization: Bearer` almacenado por sesión y el stream debe conservar el mismo
modelo de autenticación que el resto de la API.

Una sesión mantiene una sola conexión para la organización activa.

## Topics REALTIME-1

- `AUTHORIZATIONS`
- `NOVELTIES`
- `PURCHASE_ORDERS`
- `INVENTORY`
- `DASHBOARD`
- `TARIFF_ANNEX`
- `IMPORTS`

Un cambio puede invalidar múltiples topics. Los topics representan read models, no
comandos ni eventos de negocio.

## Productores cubiertos en REALTIME-1

- cargue/recarga de autorizaciones al finalizar el lote;
- cambios del Anexo Tarifario y revalidación derivada de AUTO;
- creación/modificación/emisión/cancelación/gestión OLP de OC;
- entregas OLP;
- recepción Medicarte;
- asignación/disponibilidad de inventario;
- liberación automática por vencimiento;
- cambio diario de vigencia derivada.

## Consumidores cubiertos en REALTIME-1

- consulta/cargue de autorizaciones;
- OC MTD/OLP/Medicarte y detalle operacional universal;
- entregas/recepciones;
- inventario y disponibilidad;
- Anexo Tarifario;
- Dashboard, incluidos contadores de novedades derivados.

## Fuera de alcance de la invalidación

No generan invalidación por sí solos cambios técnicos que no alteran una proyección
funcional visible, por ejemplo `job_results`, transición interna del outbox,
idempotencia, telemetría o heartbeats.

## Reconexión

Estados de UI:

```text
● Sincronizado
○ Reconectando…
```

Cada `ready` del stream, incluido después de una reconexión, invalida los topics
montados. La reconciliación posterior lee nuevamente la API y cierra el hueco de
mensajes que Redis Pub/Sub pudiera perder mientras el navegador estuvo desconectado.

## Consecuencias

- No se adopta event sourcing.
- No se agrega una segunda base de estado.
- No se requiere migración para REALTIME-1: se reutiliza `outbox_events`.
- Nuevos módulos operacionales deben declarar explícitamente qué read models invalidan.
- REALTIME-2 amplía productores/consumidores; no debe introducir otra arquitectura de
  sincronización.


## REALTIME-2-WAVE1

Cobertura incremental sobre la infraestructura aprobada en REALTIME-1:

- programación de pacientes y su historial;
- aplicaciones al paciente;
- resultados de no aplicación y novedades operacionales;
- traslados de inventario;
- períodos de planeación;
- consolidación de demanda proyectada;
- fulfillment confirmado;
- auditoría de fulfillment y auditoría de aplicación;
- consumidores de programación, aplicaciones, outcomes, inventario, planeación, demanda, auditoría y analítica.

La invalidación continúa siendo un hint. PostgreSQL sigue siendo la fuente autoritativa y el
frontend reconcilia mediante refetch autenticado. MIPRES y reconciliación asíncrona se abordan
en REALTIME-2-WAVE2 porque usan consumidores/transactions basados en pg/worker y requieren un
adaptador transaccional separado.


## REALTIME-2-WAVE2B

Se incorpora el topic RECONCILIATION para invalidar y volver a consultar
la fuente autoritativa después de cambios en runs, findings, issues,
comentarios, políticas, ejecuciones y notificaciones.

Las operaciones que ya poseen una transacción PostgreSQL escriben el
evento realtime dentro de esa misma transacción. En las operaciones
autocommit el evento se genera inmediatamente después de la mutación
autoritativa.

El payload realtime nunca reemplaza estado de negocio en el cliente:
es únicamente una señal para refetch.

MIPRES W2A se considera NOT_APPLICABLE en este worktree porque no existe
un MipresProcessor ejecutable bajo apps/worker.
