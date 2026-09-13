# Especificaciones funcionales y plan de implementación

## 1. Objetivo general

Transformar el modelo operativo actual, donde la orden de compra, la entrega de OLP y la aplicación están asociadas directamente a cada `authorization_item`, hacia un modelo en el cual:

**Autorización → programación → demanda proyectada → consolidación → orden de compra → entrega → recepción → inventario → aplicación al paciente.**

La autorización seguirá siendo la unidad clínica y contractual del paciente, pero dejará de ser la unidad logística de abastecimiento.

La unidad de abastecimiento será:

**período + punto físico + código comercial + cantidad.**

La unidad física de inventario será:

**punto físico + código comercial + lote + vencimiento.**

El código comercial será la identidad operativa del producto y presupone coincidencia de principio activo, concentración, forma farmacéutica y presentación.

La plataforma manejará únicamente el inventario generado dentro del proceso MTD → OLP → Medicarte. No sustituirá los sistemas corporativos de inventario, ERP, contabilidad o WMS.

La recepción deberá conservar cantidad, lote, vencimiento y conformidad. Esto es coherente con la Resolución 1403 de 2007, que exige verificar en recepción cantidades, lotes, fechas de vencimiento y condiciones técnicas, y establece rotación priorizando productos próximos a vencer.

---

# ESP-001 — Separación del dominio clínico y logístico

## Objetivo

Eliminar la dependencia estructural entre una autorización individual y la orden de compra, entrega e inventario.

## Requerimiento funcional

`authorization_items` continuará representando la autorización y sus productos autorizados.

No deberá contener la nueva lógica de:

* orden de compra;
* entrega OLP;
* recepción Medicarte;
* inventario;
* lote;
* saldo físico;
* transferencias.

La autorización podrá originar una o varias programaciones, pero ninguna unidad física deberá considerarse propiedad de un paciente antes de su aplicación.

Debe conservarse trazabilidad desde la aplicación final hasta la autorización que originó la necesidad.

## Regla fundamental

Debe ser posible que:

```text
Paciente X → necesita COD001
Paciente Y → necesita COD001

Demanda consolidada → COD001 × 2
```

y posteriormente:

```text
X no asiste → inventario no cambia
Y asiste → inventario -1
```

sin ninguna operación de reasignación X → Y.

## Modelo objetivo preliminar

```text
authorization_items
        │
        ▼
patient_schedules
        │
        ▼
demand_sources
        │
        ▼
projected_demand_lines
```

El flujo logístico continúa independientemente:

```text
projected_demand_lines
        │
        ▼
purchase_order_lines
        │
        ▼
deliveries
        │
        ▼
receipts
        │
        ▼
inventory_movements
```

La aplicación vuelve a unir ambos dominios:

```text
authorization_item
        │
        ▼
patient_application
        │
        ▼
inventory_consumption
```

## Criterios de aceptación

1. Crear una OC no modifica ninguna autorización.
2. Cancelar una programación no modifica directamente ninguna OC emitida.
3. Una recepción genera inventario sin asignarlo a pacientes.
4. Una aplicación identifica posteriormente qué autorización consumió inventario.
5. El histórico anterior permanece consultable.

## Plan de trabajo

### PT-001.1 — Inventario del modelo actual

Tareas:

* Mapear campos actuales de OC, dispensación y aplicación existentes en `authorization_items`.
* Localizar servicios NestJS que leen/escriben esos campos.
* Localizar contratos Zod/TypeScript afectados.
* Localizar componentes Next.js afectados.
* Identificar XLSX que actualmente contienen OC o dispensación por autorización.
* Mapear pruebas F1–F9 afectadas.

### PT-001.2 — Crear modelo TO-BE

Tareas:

* Definir entidades nuevas.
* Definir claves primarias y foráneas.
* Definir invariantes.
* Definir máquinas de estados.
* Añadir modelos al `packages/domain`.
* Añadir contratos a `packages/contracts`.
* Definir ADR del cambio arquitectónico.

### PT-001.3 — Persistencia

Tareas:

* Crear esquema Drizzle.
* Crear índices.
* Crear restricciones `NOT NULL`, `UNIQUE` y `CHECK`.
* Generar migración aditiva.
* Crear repositorios.
* Crear pruebas de persistencia.

Las restricciones deben vivir también en PostgreSQL y no exclusivamente en frontend/API; Drizzle soporta constraints, índices y transacciones para mantener estas invariantes.

---

# ESP-002 — Períodos de planificación

## Objetivo

Crear ventanas operativas sobre las cuales Medicarte programa pacientes y MTD posteriormente consolida la demanda.

## Requerimiento funcional

La operación normal será semanal, pero la duración deberá ser parametrizable.

Un período tendrá:

```text
fecha_inicio
fecha_fin
fecha_limite_programacion
fecha_limite_oc
fecha_esperada_entrega
estado
```

Configuración inicial:

```text
Martes:
cierre esperado programación Medicarte.

Miércoles noche:
OC de MTD.

Jueves:
OLP debe conocer requerimientos.

Lunes siguiente:
medicamento esperado en las sedes.
```

No deberán hardcodearse los nombres de los días como reglas inmutables.

## Estados sugeridos

```text
OPEN
PLANNING_CLOSED
PURCHASING
IN_FULFILLMENT
OPERATIONAL
CLOSED
```

## Regla de cierre

Cerrar un período congela sus cifras de planificación.

**No elimina ni bloquea inventario sobrante.**

## Criterios de aceptación

* Puede crearse un período semanal.
* Puede crearse uno de duración diferente.
* El período identifica claramente fecha de corte.
* Se identifican programaciones extemporáneas.
* Cerrar el período no cambia el inventario.

## Plan de trabajo

### PT-002.1 — Modelo

Tareas:

* Crear `planning_periods`.
* Crear configuración de calendario operacional.
* Implementar validaciones de solapamiento.
* Implementar estados y transiciones.

### PT-002.2 — API

Tareas:

* Crear endpoints de consulta.
* Crear administración MTD de períodos.
* Crear endpoint de cierre.
* Implementar validación de corte.

### PT-002.3 — Frontend

Tareas:

* Crear selector de período.
* Mostrar período actual.
* Mostrar próximas fechas operativas.
* Mostrar visualmente períodos cerrados.
* Alertar programación posterior al corte.

---

# ESP-003 — Programación de pacientes por Medicarte

## Objetivo

Convertir la programación realizada por Medicarte en la fuente de la demanda proyectada.

## Requerimiento funcional

Medicarte podrá programar mediante:

1. carga XLSX;
2. búsqueda por autorización;
3. búsqueda por paciente;
4. edición individual.

Cada programación deberá identificar:

```text
authorization_item
paciente
COD_COMERCIAL
cantidad
punto_aplicacion
fecha_programada
periodo
```

Una autorización puede contener varios productos.

Un paciente puede requerir varias unidades.

## Regla de prioridad

La plataforma calculará proximidad del vencimiento de la autorización.

Debe existir advertencia visual:

```text
CRÍTICA
ALTA
NORMAL
```

La alerta **no reservará inventario ni decidirá automáticamente qué paciente será atendido**.

Medicarte mantiene la decisión operativa.

## Programación extemporánea

Después del corte deberá seleccionarse:

```text
OC complementaria
```

o:

```text
Siguiente período
```

## Criterios de aceptación

* Medicarte puede programar individualmente.
* Puede programar masivamente.
* El sistema rechaza códigos comerciales inválidos.
* La programación genera demanda.
* Modificar fecha/punto conserva histórico.
* Programaciones tardías quedan identificadas.

## Plan de trabajo

### PT-003.1 — Datos

Tareas:

* Crear `patient_schedules`.
* Relacionarlo con autorización, punto y período.
* Crear historial append-only de modificaciones.
* Crear campos de prioridad por vencimiento.

### PT-003.2 — Backend

Tareas:

* Crear servicios de programación.
* Implementar búsqueda por paciente.
* Implementar búsqueda por autorización.
* Crear carga XLSX con staging.
* Reutilizar validaciones y patrón de importaciones existente.

### PT-003.3 — Frontend

Tareas:

* Crear pantalla Programación.
* Crear búsqueda individual.
* Crear edición.
* Crear importador XLSX.
* Mostrar prioridad de autorización.
* Mostrar si está dentro/fuera del período.

---

# ESP-004 — Consolidación de demanda proyectada

## Objetivo

Transformar múltiples necesidades individuales en una necesidad logística agregada.

## Clave de consolidación

```text
planning_period_id
+ dispensing_point_id
+ commercial_code
```

## Ejemplo

```text
Paciente A → COD01 × 1
Paciente B → COD01 × 2
Paciente C → COD02 × 1
```

produce:

```text
Sede X / COD01 → 3
Sede X / COD02 → 1
```

## Reglas

La consolidación no crea inventario.

La consolidación no reserva unidades.

Debe mantenerse el lineage que permita saber qué programaciones originaron cada cantidad.

Debe permitirse recalcular mientras la demanda esté abierta.

Al generar una OC, deberá crearse un snapshot que impida que cambios posteriores modifiquen silenciosamente la OC emitida.

## Criterios de aceptación

* N pacientes pueden producir una sola línea consolidada.
* Es posible navegar del consolidado a sus pacientes origen.
* Cambiar programación antes del corte recalcula demanda.
* Cambiar programación después de emitir OC no modifica aquella OC.

## Plan de trabajo

### PT-004.1 — Dominio

Tareas:

* Crear `projected_demand_lines`.
* Crear `demand_sources`.
* Diseñar algoritmo determinista de consolidación.
* Implementar snapshots.

### PT-004.2 — Backend

Tareas:

* Crear servicio de consolidación.
* Implementar reconstrucción idempotente.
* Exponer resumen por período/sede/producto.
* Registrar eventos de auditoría.

### PT-004.3 — Interfaz MTD

Tareas:

* Crear vista Demanda Consolidada.
* Mostrar cantidad.
* Mostrar pacientes origen.
* Mostrar cambios desde última consolidación.
* Mostrar demanda extemporánea.

---

# ESP-005 — Orden de compra consolidada MTD → OLP

## Objetivo

Convertir la demanda consolidada en una OC logística independiente de las autorizaciones.

## Estructura

### Cabecera

```text
purchase_orders
- id
- codigo_oc_mtd
- planning_period_id
- estado
- fecha_emision
- created_by
```

### Líneas

```text
purchase_order_lines
- purchase_order_id
- commercial_code
- dispensing_point_id
- requested_quantity
- accepted_quantity
- supplier_unit_cost
```

Una sola OC podrá contener múltiples productos y múltiples puntos.

## Regla económica

El precio del anexo tarifario:

```text
COMPENSAR → MTD
```

es diferente del precio:

```text
OLP → MTD
```

OLP registra su propio costo unitario.

Nunca deberán almacenarse ambos conceptos en un único campo `precio`.

## Estados sugeridos

```text
DRAFT
ISSUED
UNDER_OLP_REVIEW
ACCEPTED
PARTIALLY_ACCEPTED
IN_FULFILLMENT
PARTIALLY_DELIVERED
DELIVERED
CLOSED
CANCELLED
```

## Regla de aceptación

MTD puede solicitar:

```text
100
```

y OLP aceptar:

```text
85
```

sin requerir segunda aprobación de MTD.

La diferencia deberá ser visible como faltante.

## OC complementaria

Una necesidad tardía o faltante podrá generar otra OC vinculada al mismo período.

## Criterios de aceptación

* La OC no necesita `authorization_item_id`.
* Una OC contiene múltiples sedes.
* Una línea tiene solicitado y aceptado independientemente.
* OLP puede registrar un costo unitario.
* Una reducción de cantidad no bloquea el proceso.
* Se soportan OCs complementarias.

## Plan de trabajo

### PT-005.1 — Persistencia

Tareas:

* Crear `purchase_orders`.
* Crear `purchase_order_lines`.
* Crear constraints de cantidades positivas.
* Crear unique del código OC de MTD.
* Registrar snapshot de demanda origen.

### PT-005.2 — API MTD

Tareas:

* Crear borrador desde consolidado.
* Permitir revisión.
* Permitir código OC MTD.
* Emitir OC.
* Crear OC complementaria.
* Bloquear cambios incompatibles después de emisión.

### PT-005.3 — Interfaz

Tareas:

* Crear módulo Órdenes de Compra.
* Crear vista de cabecera.
* Crear tabla de líneas.
* Mostrar solicitado/aceptado/faltante.
* Mostrar estado general y por línea.

---

# ESP-006 — Validación y abastecimiento por OLP

## Objetivo

Dar a OLP una operación centrada en productos, cantidades, sedes y fechas, sin exposición de pacientes.

## Visibilidad OLP

Puede conocer:

```text
OC
producto
presentación
cantidad solicitada
punto
fecha requerida
cantidad aceptada
precio OLP
entregas
```

No podrá conocer:

```text
nombre paciente
documento paciente
autorización
MIPRES
diagnóstico
información clínica
```

## Requerimiento funcional

OLP podrá:

* consultar OC;
* aceptar cantidades;
* aceptar parcialmente;
* colocar costo unitario;
* programar una o varias entregas;
* registrar entrega parcial;
* finalizar suministro.

## Entregas

Una línea:

```text
COD01 aceptado = 100
```

puede producir:

```text
Entrega 1 = 40
Entrega 2 = 35
Entrega 3 = 25
```

## Plan de trabajo

### PT-006.1 — Modelo

Tareas:

* Crear `deliveries`.
* Crear `delivery_lines`.
* Relacionar con línea OC.
* Permitir entregas parciales.
* Calcular saldo pendiente.

### PT-006.2 — API OLP

Tareas:

* Endpoint de aceptación.
* Endpoint de precio proveedor.
* Endpoint de creación de entrega.
* Endpoint de despacho.
* Validar que no se entregue más de lo permitido salvo regla explícita.

### PT-006.3 — Portal OLP

Tareas:

* Lista de OCs.
* Detalle OC.
* Aceptación por líneas.
* Registro del costo.
* Creación de entregas.
* Consulta de pendientes.

---

# ESP-007 — Recepción operacional Medicarte

## Objetivo

Registrar lo que físicamente recibe Medicarte de cada entrega de OLP.

No sustituirá el acta formal de recepción farmacéutica.

## Datos mínimos

```text
delivery
fecha/hora
punto
commercial_code
cantidad_entregada
cantidad_aceptada
cantidad_rechazada
lote
fecha_vencimiento
conformidad
observación
usuario
```

La Resolución 1403 contempla expresamente inspección de cantidades, lotes, vencimientos y condiciones durante recepción.

## Conformidad

```text
CONFORMING
PARTIALLY_CONFORMING
NON_CONFORMING
```

Ejemplo:

```text
Entregado: 20
Aceptado: 18
Rechazado: 2
```

Solo las 18 unidades aceptadas ingresan al inventario.

## Regla

Cada entrega parcial debe confirmarse individualmente por Medicarte.

## Plan de trabajo

### PT-007.1 — Modelo

Tareas:

* Crear `receipts`.
* Crear `receipt_lines`.
* Permitir múltiples lotes por recepción.
* Implementar cantidades aceptadas/rechazadas.
* Crear catálogo de causas de no conformidad.

### PT-007.2 — Transacción de recepción

Tareas:

* Validar entrega.
* Crear recepción.
* Crear lotes.
* Crear movimientos de inventario.
* Registrar auditoría.
* Ejecutar todo en una transacción PostgreSQL.

### PT-007.3 — Interfaz Medicarte

Tareas:

* Bandeja Entregas pendientes.
* Confirmación total.
* Confirmación parcial.
* Captura de lote/vencimiento.
* Captura de observaciones.

---

# ESP-008 — Inventario operacional y ledger

## Objetivo

Mantener una representación confiable del stock generado exclusivamente por este proceso.

## Principio técnico

No existirá un número editable:

```text
stock = X
```

como fuente primaria.

El saldo se deriva de movimientos.

## Movimientos mínimos

```text
RECEIPT
APPLICATION
TRANSFER_OUT
TRANSFER_IN
DAMAGE
EXPIRATION
RETURN_TO_SUPPLIER
ADJUSTMENT
NON_REUSABLE
```

No existirá:

```text
RESERVED
```

## Identidad del stock

```text
commercial_code
+ point
+ lot
+ expiration_date
```

## Propiedad y custodia

```text
Propiedad: MTD
Custodia física: Medicarte
```

## Sobrantes

Cerrar un período no afecta disponibilidad.

Un producto recibido en semana N puede consumirse en semana N+1.

## Vencimientos

Medicarte escogerá el lote manualmente.

El sistema deberá advertir cuando exista otro lote compatible con vencimiento anterior.

La regulación exige mecanismos para controlar vencimientos y priorizar los medicamentos de vencimiento próximo.

La advertencia no deberá impedir necesariamente la selección, pero la excepción deberá quedar registrada.

## Integridad

Nunca deberá permitirse inventario negativo.

Los cambios de inventario deberán ejecutarse transaccionalmente; Drizzle dispone de transacciones y savepoints apropiados para operaciones que requieren atomicidad.

## Plan de trabajo

### PT-008.1 — Persistencia

Tareas:

* Crear `inventory_lots`.
* Crear `inventory_movements`.
* Definir índices por producto/sede/lote.
* Crear constraints de cantidades.
* Crear referencia al evento origen.

### PT-008.2 — Motor de inventario

Tareas:

* Crear servicio único para movimientos.
* Prohibir modificación directa de saldo.
* Calcular disponibilidad.
* Implementar locking/concurrencia.
* Implementar idempotencia.

### PT-008.3 — FEFO asistido

Tareas:

* Ordenar lotes por vencimiento.
* Señalar lote recomendado.
* Alertar selección diferente.
* Guardar motivo de excepción.

### PT-008.4 — UI

Tareas:

* Vista de inventario por sede.
* Vista por producto.
* Vista por lote.
* Vista de movimientos.
* Alertas de vencimiento.

---

# ESP-009 — Transferencias entre puntos Medicarte

## Objetivo

Permitir reubicar stock sin perder trazabilidad.

## Entidad

```text
stock_transfers
```

Estados:

```text
CREATED
DISPATCHED
RECEIVED
CANCELLED
```

## Regla

Al despachar:

```text
sede A → deja de estar AVAILABLE
```

pero aún no aparece disponible en:

```text
sede B
```

hasta que B confirma recepción.

## Plan de trabajo

### PT-009.1 — Modelo

Tareas:

* Crear transferencia.
* Crear líneas por lote/producto.
* Registrar origen/destino.
* Registrar usuarios y timestamps.

### PT-009.2 — Inventario

Tareas:

* Generar `TRANSFER_OUT`.
* Manejar unidades en tránsito.
* Generar `TRANSFER_IN`.
* Resolver cancelaciones.

### PT-009.3 — Frontend

Tareas:

* Crear transferencia.
* Despachar.
* Consultar en tránsito.
* Confirmar recepción.
* Mostrar historial.

---

# ESP-010 — Aplicación al paciente y consumo del inventario

## Objetivo

Crear el vínculo definitivo entre una unidad física y la autorización únicamente cuando el paciente recibe el medicamento.

## Requerimiento

Medicarte podrá registrar aplicación:

* individualmente;
* mediante XLSX.

La aplicación deberá indicar:

```text
authorization_item
fecha
punto
commercial_code
cantidad
lote
usuario
```

## Regla

La aplicación:

1. valida autorización;
2. valida código comercial;
3. valida lote disponible;
4. valida cantidad;
5. registra aplicación;
6. crea `APPLICATION` en inventario;
7. disminuye saldo;
8. cambia estado clínico-operacional.

Todo deberá ocurrir en una única transacción.

## Terminología

Internamente recomiendo:

```text
APPLIED
```

y no `DISPENSED`, porque OLP también realiza una entrega logística.

La interfaz podrá mostrar:

**Aplicado / dispensado al paciente**

si ese es el lenguaje de negocio utilizado por los usuarios.

## Medicamento no aplicado

Solo podrá retornar a disponible si Medicarte confirma que conserva las condiciones para reutilizarlo.

De lo contrario:

```text
NON_REUSABLE
```

## Plan de trabajo

### PT-010.1 — Dominio

Tareas:

* Crear `patient_applications`.
* Definir invariantes.
* Relacionar autorización.
* Relacionar lote/movimiento.

### PT-010.2 — Aplicación individual

Tareas:

* Búsqueda paciente/autorización.
* Mostrar programación.
* Mostrar lotes.
* Mostrar FEFO.
* Confirmar aplicación.

### PT-010.3 — Carga masiva

Tareas:

* Diseñar XLSX.
* Staging.
* Validación fila a fila.
* Preview.
* Confirmación.
* Procesamiento idempotente.

---

# ESP-011 — Estados del paciente, novedades y reprogramación

## Objetivo

Separar el estado operacional de la razón por la cual una autorización no avanzó.

## Estados sugeridos

```text
DIRECTIONED
SCHEDULED
APPLIED
NOT_APPLIED
CANCELLED
AUDIT_PENDING
AUDITED
```

## Novedades

Reutilizar el modelo actual de `novelty_codes` y `novelties` donde sea posible.

Catálogo inicial:

```text
PATIENT_NO_SHOW
INCORRECT_PRESCRIPTION
PRODUCT_NOT_CONTRACTED
AUTHORIZATION_CANCELLED
INSUFFICIENT_STOCK
RESCHEDULED
OTHER
```

No usar:

```text
status = PATIENT_NO_SHOW
```

Debe ser:

```text
status = NOT_APPLIED
novelty = PATIENT_NO_SHOW
```

## Reprogramación

Falta de inventario no será resuelta automáticamente.

Medicarte podrá mover al paciente al siguiente período.

## Plan de trabajo

### PT-011.1 — Estado

Tareas:

* Diseñar máquina de estados.
* Mapear estados anteriores.
* Implementar transiciones.
* Añadir validaciones.

### PT-011.2 — Novedades

Tareas:

* Completar catálogo.
* Asociar novedad a programación/aplicación.
* Implementar observaciones.
* Mantener auditoría.

### PT-011.3 — Prioridad

Tareas:

* Calcular días restantes de autorización.
* Crear niveles de alerta.
* Mostrar alertas visuales.
* No crear reservas automáticas.

---

# ESP-012 — Auditoría MTD

## Objetivo

Mantener el proceso vigente mediante el cual MTD corrobora que la autorización efectivamente fue consumida.

## Flujo

```text
APPLIED
   ↓
READY_FOR_AUDIT
   ↓
IN_REVIEW
   ├── REJECTED
   └── APPROVED
           ↓
       admission_status = READY
```

La auditoría no determina existencia física; verifica la aplicación y los soportes externos existentes en Drive.

## Plan de trabajo

### PT-012.1 — Adaptación

Tareas:

* Desacoplar auditoría de antiguos campos de OC.
* Usar `patient_applications` como evidencia operacional.
* Mantener `audit_reviews`.
* Mantener `audit_findings`.
* Mantener Drive externo.

### PT-012.2 — Estados derivados

Tareas:

* Ajustar `operation_status`.
* Ajustar `audit_status`.
* Ajustar `admission_status`.
* Actualizar filtros/tableros.

### PT-012.3 — Pruebas

Tareas:

* Aplicación correcta + aprobación.
* Aplicación rechazada.
* Sin aplicación.
* Novedad.
* Reauditoría cuando corresponda.

---

# ESP-013 — Modelo económico y tablero operacional

## Objetivo

Mostrar cantidades y valores sin convertir la aplicación en un sistema contable.

## Dos precios independientes

### Tarifa Compensar → MTD

Fuente:

```text
anexo tarifario
```

### Costo OLP → MTD

Fuente:

```text
supplier_unit_cost registrado por OLP
```

## Regla de snapshot

El precio aplicable deberá congelarse en la transacción correspondiente.

Cambiar mañana el anexo tarifario no debe modificar retrospectivamente una operación histórica.

## Indicadores mínimos

### Demanda

```text
cantidad proyectada
valor tarifario proyectado
```

### Compra

```text
cantidad solicitada
cantidad aceptada OLP
valor solicitado
valor aceptado
```

### Abastecimiento

```text
cantidad entregada
cantidad recibida
cantidad rechazada
valor recibido
```

### Aplicación

```text
cantidad aplicada
costo OLP aplicado
valor tarifario asociado
```

### Inventario

```text
cantidad disponible
valor proveedor del stock
```

### Desviaciones

```text
proyectado vs aplicado
OC vs recibido
% cumplimiento OLP
% no-show
% utilización
sobrante
faltante
pérdidas
```

## Plan de trabajo

### PT-013.1 — Datos económicos

Tareas:

* Separar tarifa y costo.
* Definir snapshots.
* Relacionar anexo tarifario.
* Añadir supplier cost.

### PT-013.2 — Consultas

Tareas:

* Crear agregaciones SQL.
* Crear indicadores por período.
* Crear indicadores por producto.
* Crear indicadores por punto.

### PT-013.3 — Dashboard

Tareas:

* Tablero MTD completo.
* Tablero Medicarte sin costos sensibles.
* Tablero OLP limitado a su relación comercial.
* Exportación XLSX.

---

# ESP-014 — Operación manual y masiva

## Objetivo

Mantener los dos modos operacionales requeridos.

## Procesos con ambos modos

### Medicarte

```text
programación
aplicación
```

### OLP

```text
aceptación de OC
entregas
```

La plataforma continuará trabajando mediante cargas manuales; no se implementará todavía integración API externa con Medicarte u OLP.

## Arquitectura

Los XLSX voluminosos deberán continuar utilizando staging + worker + resultados por fila.

La arquitectura BullMQ existente es apropiada para estos procesos porque permite sacar trabajos pesados del ciclo síncrono HTTP y procesarlos mediante workers persistidos en Redis.

## Plan de trabajo

### PT-014.1 — Plantillas

Tareas:

* Plantilla programación.
* Plantilla aplicación.
* Plantilla recepción/entrega si resulta operacionalmente conveniente.
* Versionar plantillas.

### PT-014.2 — Staging

Tareas:

* Reutilizar `bulk_update_batches`.
* Separar tipo de operación.
* Normalizar filas.
* Validar.
* Preview.
* Confirmar.

### PT-014.3 — Worker

Tareas:

* Crear jobs.
* Implementar idempotencia.
* Reintentos.
* DLQ.
* Reporte por fila.

---

# ESP-015 — RBAC y segregación por organización

## Objetivo

Garantizar que las tres empresas vean únicamente la información necesaria.

## MTD

Puede visualizar:

* pacientes;
* autorizaciones;
* demanda;
* OC;
* precios Compensar;
* precios OLP;
* entregas;
* inventario;
* aplicaciones;
* auditoría;
* indicadores.

## OLP

Puede visualizar:

* OCs;
* productos;
* cantidades;
* puntos;
* fechas;
* su precio;
* entregas.

No puede visualizar pacientes ni información clínica.

## Medicarte

Puede visualizar:

* pacientes;
* programación;
* entregas destinadas a sus puntos;
* recepción;
* inventario operacional;
* lotes;
* aplicación;
* novedades.

No necesita visualizar valores económicos de las OCs.

## Plan de trabajo

### PT-015.1 — Permisos

Tareas:

* Inventariar permisos actuales.
* Crear permisos nuevos por módulo.
* Definir roles MTD/OLP/Medicarte.
* Definir alcance por organización/punto.

### PT-015.2 — Backend

Tareas:

* Guards.
* filtros obligatorios por organización.
* protección de DTOs.
* impedir filtración por endpoints indirectos.

### PT-015.3 — Seguridad funcional

Tareas:

* Pruebas de acceso cruzado.
* OLP intentando acceder a paciente.
* Medicarte intentando consultar precios.
* Organización A intentando consultar registros de otra.

---

# ESP-016 — Migración completa del modelo anterior

## Objetivo

Migrar todos los registros existentes al nuevo dominio sin perder trazabilidad histórica.

## Estrategia

Se utilizará:

```text
EXPAND
   ↓
BACKFILL
   ↓
VERIFY
   ↓
SWITCH
   ↓
CONTRACT
```

Las migraciones Drizzle permiten mantener los cambios de esquema bajo control de versiones y aplicarlos de forma reproducible.

## Regla

No eliminar inicialmente los campos antiguos.

Primero deben convertirse en datos históricos de compatibilidad.

## Lineage

Un registro antiguo conservará referencias suficientes para responder:

```text
¿qué OC aparecía en esta autorización?
¿qué fecha OLP tenía?
¿qué aplicación tenía?
¿cómo fue migrado?
```

pero el nuevo código no podrá depender de esos campos para crear operaciones futuras.

## Plan de trabajo

### PT-016.1 — Análisis de datos

Tareas:

* Inventariar registros.
* Clasificarlos por estado.
* Identificar inconsistencias.
* Determinar mapeo legado → nuevo.

### PT-016.2 — Migración aditiva

Tareas:

* Crear nuevas tablas.
* No borrar columnas.
* Añadir referencias legacy.
* Implementar script idempotente.

### PT-016.3 — Backfill

Tareas:

* Migrar períodos.
* Migrar programaciones.
* Reconstruir aplicaciones.
* Crear lineage OC histórico.
* Crear inventario solo cuando exista evidencia suficiente.

No se deberá fabricar stock histórico a partir de datos ambiguos.

### PT-016.4 — Validación

Tareas:

* Conteos antes/después.
* Conciliación por autorización.
* Conciliación de aplicaciones.
* Reporte de excepciones.
* Muestreo manual.

### PT-016.5 — Cutover

Tareas:

* Cambiar servicios de escritura.
* Cambiar consultas.
* Bloquear nuevas escrituras legacy.
* Mantener lectura histórica.
* Retirar código muerto cuando el nuevo modelo esté estable.

---

# ESP-017 — Auditoría técnica, idempotencia y trazabilidad

## Objetivo

Mantener las propiedades fuertes que ya existen en el MVP.

Toda operación crítica deberá registrar:

```text
actor
organización
timestamp
entidad
operación
estado anterior
estado posterior
correlation_id
```

## Operaciones críticas

* programación;
* consolidación;
* generación OC;
* aceptación OLP;
* cambio de precio;
* entrega;
* recepción;
* movimiento inventario;
* transferencia;
* aplicación;
* novedad;
* auditoría.

## Plan de trabajo

### PT-017.1 — Eventos

Tareas:

* Definir eventos del dominio.
* Reutilizar `audit_events`.
* Reutilizar outbox.
* Añadir correlation IDs.

### PT-017.2 — Idempotencia

Tareas:

* OC.
* entregas.
* recepciones.
* movimientos.
* aplicaciones.
* cargas XLSX.

### PT-017.3 — Concurrencia

Tareas:

* bloqueo lógico de lotes durante consumo;
* optimistic locking donde corresponda;
* pruebas concurrentes;
* impedir doble consumo.

---

# ESP-018 — Suite de pruebas y salida preproductiva

## Objetivo

No considerar completado el cambio únicamente porque `lint`, `typecheck` o pruebas unitarias pasen.

El flujo debe validarse con PostgreSQL, Redis, API y Worker reales.

## Casos E2E mínimos

### Escenario 1 — Flujo ideal

```text
autorización
→ programación
→ demanda
→ OC
→ aceptación OLP
→ entrega
→ recepción
→ stock
→ aplicación
→ auditoría
```

### Escenario 2 — No-show

```text
X genera demanda
X no asiste
stock no cambia
Y consume la unidad
```

### Escenario 3 — OLP acepta parcialmente

```text
MTD solicita 100
OLP acepta 80
faltante = 20
```

### Escenario 4 — Recepción parcial

```text
20 entregadas
18 aceptadas
2 rechazadas
stock +18
```

### Escenario 5 — Varias entregas

```text
100 aceptadas
40 + 35 + 25
```

### Escenario 6 — Transferencia

```text
A -5
en tránsito 5
B +5 después de recepción
```

### Escenario 7 — Concurrencia

Dos aplicaciones intentan consumir la última unidad.

Solo una debe poder completarse.

### Escenario 8 — Cierre de período

```text
stock sobrante permanece disponible
```

### Escenario 9 — Prioridad autorización

Alerta visible sin reserva automática.

### Escenario 10 — Seguridad

OLP no puede acceder a información del paciente.

## Plan de trabajo

### PT-018.1 — Pruebas de dominio

Tareas:

* máquinas de estado;
* consolidación;
* inventario;
* cantidades;
* vencimientos;
* precios.

### PT-018.2 — Integración

Tareas:

* PostgreSQL real;
* Redis real;
* BullMQ;
* API;
* Worker.

### PT-018.3 — E2E

Tareas:

* escenarios anteriores;
* cargas XLSX;
* RBAC;
* migración.

### PT-018.4 — Gate de release

Ejecutar como mínimo:

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build

docker compose up -d --build

pnpm test:integration
```

No promover a preproducción mientras haya fallas en las pruebas transaccionales de inventario o migración.

---

# Orden obligatorio de implementación

## Fase A — Fundamentos

Primero:

```text
ESP-001 Dominio
ESP-002 Períodos
ESP-015 RBAC
ESP-017 Auditoría técnica
```

No desarrollar inventario antes de estos fundamentos.

---

## Fase B — Generación de demanda

Después:

```text
ESP-003 Programación
ESP-004 Consolidación
```

Al terminar esta fase debe poder responderse:

> ¿Qué producto, cuánto y en qué punto probablemente necesitaremos para el siguiente período?

---

## Fase C — Compra y abastecimiento

Después:

```text
ESP-005 Orden de compra
ESP-006 OLP
ESP-007 Recepción
```

Al terminar:

> ¿Qué pidió MTD, qué aceptó OLP, qué entregó y qué recibió realmente Medicarte?

---

## Fase D — Inventario físico

Después:

```text
ESP-008 Inventario
ESP-009 Transferencias
```

Al terminar:

> ¿Qué cantidad existe físicamente, dónde está y de qué lote proviene?

---

## Fase E — Paciente

Después:

```text
ESP-010 Aplicación
ESP-011 Estados y novedades
ESP-012 Auditoría
```

Al terminar:

> ¿Qué autorización efectivamente consumió qué medicamento?

---

## Fase F — Control

Después:

```text
ESP-013 Indicadores
ESP-014 Cargas masivas
```

Aunque parte de las cargas masivas puede implementarse paralelamente con cada módulo, la lógica de negocio debe existir primero.

---

## Fase G — Migración y cutover

Finalmente:

```text
ESP-016 Migración
ESP-018 Validación integral
```

La migración se desarrolla previamente, pero el cutover debe ejecutarse únicamente cuando los módulos nuevos estén completos.

---

# Dependencias críticas

```text
ESP-001
 ├── ESP-002
 │     ├── ESP-003
 │     │     └── ESP-004
 │     │            └── ESP-005
 │     │                   └── ESP-006
 │     │                          └── ESP-007
 │     │                                 └── ESP-008
 │     │                                        ├── ESP-009
 │     │                                        └── ESP-010
 │     │                                               ├── ESP-011
 │     │                                               └── ESP-012
 │     │
 │     └── ESP-013
 │
 ├── ESP-015
 ├── ESP-017
 └── ESP-016

Todos
  ↓
ESP-018
```

---

# Decisiones explícitamente fuera de alcance

Esta evolución **no debe incorporar**:

* WMS corporativo;
* inventario completo de Medicarte;
* contabilidad;
* kardex fiscal;
* facturación;
* cartera;
* costeo financiero completo;
* optimización automática de compras;
* stock de seguridad;
* asignación automática de pacientes cuando existe escasez;
* integración API automática con OLP;
* integración API automática con Medicarte;
* gestión documental interna;
* formalización del acta farmacéutica de recepción;
* sustitución terapéutica entre códigos comerciales;
* reservas físicas por paciente.

---

# Resultado arquitectónico esperado

Al finalizar el cambio, el centro de la operación dejará de ser:

```text
authorization_item
```

para convertirse en varios agregados independientes:

```text
CLÍNICO
authorization
patient_schedule
patient_application

PLANIFICACIÓN
planning_period
projected_demand

ABASTECIMIENTO
purchase_order
delivery
receipt

INVENTARIO
inventory_lot
inventory_movement
stock_transfer

CONTROL
novelty
audit_review
audit_event
```

Esto permite mantener PostgreSQL como fuente definitiva de verdad y Redis/BullMQ solamente para coordinación de trabajos asíncronos, en línea con la arquitectura actual y con el uso recomendado de BullMQ para procesamiento persistente y desacoplado.

El cambio central puede resumirse así:

> **El paciente genera la necesidad, pero no es dueño del inventario.
> La demanda determina cuánto abastecer.
> La recepción crea inventario.
> La aplicación consume inventario y recién en ese momento vincula físicamente producto y paciente.**

Ese debe ser el invariante principal del nuevo modelo.
