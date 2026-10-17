# Matriz de aceptación operativa — MTD / OLP / MEDICARTE

**Estado:** casos de certificación **propuestos**, no resultados `PASS`. **Rama estudiada:** `develop` @ `7ced5792`. Ejecutar en base aislada con datos sintéticos; registrar SHA, ambiente, timestamp, request/correlationId (sin tokens), before/after de PostgreSQL y resultado esperado/real.

## Checklist de certificación

| ID | Escenario | Resultado esperado | Evidencia mínima | Estado |
| --- | --- | --- | --- | --- |
| T-AT-01 | Cargar AT nuevo → PREPARE | Preview indica NEW; catálogo no cambia | Respuesta prepare + conteo AT antes/después | PENDIENTE |
| T-AT-02 | CONFIRM de AT sin cambios repetido | Sin revisiones duplicadas; idempotencia | Conteo revisiones y auditoría | PENDIENTE |
| T-AT-03 | Anomalía tarifaria sin override suficiente | Conflicto; no aplica anomalía | Código `TARIFF_IMPORT_OVERRIDE_REQUIRED` y snapshot | PENDIENTE |
| T-AUTO-01 | XLSX de AUTO con 28 cabeceras y METADATA válido | Job listo; confirmación persiste las filas operables | Job/filas/AUTO por clave | PENDIENTE |
| T-AUTO-02 | AUTO con identidad completa pero vigencia vencida | Persistida, pero no elegible para operación | AUTO + vigencia/enablement | PENDIENTE |
| T-AUTO-03 | AUTO sin número o código | Fila rechazada; XLSX de errores legible | `rejected.xlsx`, error por fila | PENDIENTE |
| T-AUTO-04 | Reimportación idéntica | No duplicar AUTO ni recrear línea histórica de OC | Clave, versión, timestamps | PENDIENTE |
| T-AUTO-05 | Renovación 16 → 5 con fecha posterior válida | Regla y trazabilidad de renovación, sin saltarse otros gates | before/after + historial | PENDIENTE |
| T-OC-01 | AUTO 10 → nueva OC-A 4 + nueva OC-B 6 | Dos fuentes de OC, saldo de compra 0 | Líneas/poas + cobertura | PENDIENTE |
| T-OC-02 | Intentar tercera OC por 1 sobre la AUTO cubierta 10/10 | Rechazo sin sobrecompra | Código/error + suma fuentes | PENDIENTE |
| T-OC-03 | Archivo V3 con misma AUTO destino + OC repetidas | Rechazo de duplicidad | Resultados por fila | PENDIENTE |
| T-OC-04 | Reasignar desde AUTO de producto distinto | Error y ninguna reasignación física/histórica | Producto/sources/allocations before/after | PENDIENTE |
| T-OC-05 | Reasignación parcial donde contrato exige completa 1:1 | Rechazo; preservar origen | Sources/allocations | PENDIENTE |
| T-OLP-01 | Aceptación con `expectedVersion`, fecha y cantidades válidas | Aceptación persistida con trazabilidad | Campos OLP por OC y líneas | PENDIENTE |
| T-OLP-02 | Aceptación sin fecha comprometida | 400/validación, no muta OC | Response, status/versión | PENDIENTE |
| T-OLP-03 | Aceptar versión desactualizada | Conflicto, sin sobrescribir aceptación vigente | VERSION_CONFLICT + before/after | PENDIENTE |
| T-MED-01 | OC 10, OLP acepta, MEDICARTE recibe 5 | Acumulado recibido=5, pendiente=5 y asignación ≤5 | Recepción/allocations/disponibilidad | PENDIENTE |
| T-MED-02 | MEDICARTE intenta recibir OC sin aceptación | Rechazo sin recepción | `DIRECT_RECEIPT_OLP_NOT_ACCEPTED` | PENDIENTE |
| T-MED-03 | Recibir 5 más cuando ya hay 5 de 10 | Total ≤10 sin duplicar asignaciones/consumos | Recepciones y total acumulado | PENDIENTE |
| T-MED-04 | Entrega/aplicación por 6 tras recepción de 5 | Conflicto, nada consumido | Error + líneas fulfillment + saldo | PENDIENTE |
| T-MED-05 | Entrega por 2; luego anular AUTO | Anulación rechazada por consumo | `409`, fulfillment preservado | PENDIENTE |
| T-MED-06 | AUTO sin consumo con reserva 6 → anular | Marca inmutable, 6 liberadas y OC histórica intacta | sourceData, allocations, poas | PENDIENTE |
| T-SEC-01 | MTD ejecuta endpoint solo OLP | 403, OC sin cambios | respuesta y snapshot | PENDIENTE |
| T-SEC-02 | OLP ejecuta fulfillment solo MEDICARTE | 403, sin consumo | respuesta y snapshot | PENDIENTE |
| T-SEC-03 | Usuario con point scope ajeno consulta datos | Sin acceso indebido | 403/no visibilidad, logs redacted | PENDIENTE |
| T-CON-01 | Dos recepciones simultáneas sobre mismo saldo 5 | No recibir > remanente; bloqueo/guard transaccional | sum(receipts), OC y logs | PENDIENTE |
| T-CON-02 | Reasignación y fulfillment simultáneos | No mover unidades ya consumidas ni duplicar reserva | locks, allocated/released/consumed | PENDIENTE |
| T-CON-03 | Anulación y fulfillment simultáneos | Exactamente una ruta válida; estado consistente | transacciones, marks y ledger | PENDIENTE |
| T-REC-01 | Reconciliar OC con recepciones `quantity-only` | Proyección consistente sin materialización ficticia | read model, receipts, allocations | PENDIENTE |

## Pruebas de documentación adicional

1. Comparar rutas de pantalla con las realmente visibles al entrar con cuentas MTD, OLP y MEDICARTE.
2. Descargar en UI cada plantilla oficial; comparar **encabezados, hojas y metadatos** con el contrato de backend.
3. Probar descargas de XLSX y archivos de filas rechazadas con diferentes estados de jobs y volumen controlado.
4. Confirmar códigos HTTP reales: el código de negocio y el estado HTTP no siempre se corresponden 1:1.
5. Validar que las visualizaciones de OC, disponibilidad y consulta de AUTO reflejen estado de DB después de SSE/reconexión.
6. Ejecutar la suite existente (`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:integration`) y registrar resultado real; esta documentación no sustituye esas ejecuciones.

## Plantilla de acta para cada test

```text
CASO:
COMMIT_SHA:
AMBIENTE / BASE AISLADA:
ACTOR Y PERMISO:
PRECONDICIONES:
PETICIÓN (sin datos clínicos reales ni secreto):
RESULTADO ESPERADO:
RESULTADO REAL / HTTP / CODE:
POSTESTADO PG / AUDITORÍA:
EVIDENCIA EN REPOSITORIO O ARTEFACTO:
CONCLUSIÓN: PASS / FAIL / BLOCKED
```
