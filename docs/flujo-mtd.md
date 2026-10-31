# Flujo de trabajo — MTD

**Alcance:** AT, AUTO, OC y gobierno del proceso. **Base:** `develop` @ `7ced5792` (17-10-2026). `IMPLEMENTADO EN CÓDIGO` no significa `PROBADO EN PRODUCCIÓN`.

## MTD-AT-01 — Cargar y actualizar el Anexo Tarifario

**Responsable:** usuario de MTD autorizado. **Pantalla:** `/ordenes-compra/configuracion` → **Anexo Tarifario**. **Permiso:** `tariff_annex.import` para carga/confirmación y `tariff_annex.read` para consulta. El servicio además exige organización MTD.

**Entrada:** XLSX obtenido del botón **Descargar plantilla**. La UI genera una hoja `Anexo Tarifario` con las columnas:

```text
CODIGO_MEDICAMENTO, TARIFA_UNIDAD, NUMERO_EXPEDIENTE_INVIMA,
CONSECUTIVO_INVIMA_PRESENTACION, DESCRIPCION_GENERICA_MEDICAMENTO,
DESCRIPCION_COMERCIAL_MEDICAMENTO, LABORATORIO_MEDICAMENTO,
TIPO_INCLUSION_MEDICAMENTO, CANTIDAD_MINIMA, CODIGO_CUM_FINAL,
MODELO, PUNTO_APLICACION_PREDETERMINADO
```

**Pasos observados:**

1. Descargar la plantilla vigente; completar código comercial, tarifa y demás campos conforme al archivo contractual.
2. En la pantalla, seleccionar **Cargar Anexo Tarifario** y elegir el XLSX (máximo 20 MiB en API).
3. La UI ejecuta `POST /api/v1/admin/tariff-annex/imports` y `POST /api/v1/admin/tariff-annex/imports/:id/prepare`; no confirma automáticamente.
4. Revisar preview: `PREVIEW_NEW`, `PREVIEW_UNCHANGED`, `PREVIEW_CHANGED`, `PREVIEW_ANOMALOUS`, `PREVIEW_REJECTED`. **PREPARE no cambia el catálogo activo.**
5. Si hay anomalías, evaluar diferencia y justificar el override con mínimo 10 caracteres; no es un trámite automático.
6. Confirmar de manera deliberada (`POST /api/v1/admin/tariff-annex/imports/:id/confirm`); consultar productos y resultado.

**Salida:** productos/revisiones actualizadas y evidencia de importación. Las filas rechazadas no equivalen a productos creados. Un registro sin cambio se trata como NO_OP; cambiar tarifa puede generar nueva revisión. **Excepciones:** archivo distinto de `.xlsx`, vacío, estado de importación inválido o anomalía sin motivación.

**Control:** la tarifa del AT usada para la relación MTD–COMPENSAR **no debe confundirse** con el costo unitario que OLP informa a MTD. Véanse contrato de OC y el campo `supplierUnitCost` en revisión de líneas OLP.

## MTD-AUTO-01 — Cargar autorizaciones

**Responsable:** MTD con `bulk_imports.manage`; lectura con `bulk_imports.read`. **Pantalla:** `/autorizaciones` (**no** `/importaciones`, que redirige).

**Entrada:** XLSX de **Descargar plantilla**, con hoja `Autorizaciones` y hoja `METADATA` (`templateVersion=ESP014_AUTHORIZATIONS_V1`, `importType=AUTHORIZATIONS`). El contrato impone **28 encabezados**; no elimine columnas de la plantilla ni cambie metadatos. Columnas especialmente relevantes:

| Campo                                            | Interpretación                                             |
| ------------------------------------------------ | ---------------------------------------------------------- |
| `NUMERO_AUTORIZACION` + `CODIGO_COMERCIAL`       | Identidad operacional de la AUTO y del producto            |
| `CANTIDAD`                                       | Cantidad autorizada original                               |
| `FECHA_ASIGNACION`                               | Fecha de contexto/planeación                               |
| `FECHA_FINAL_VIGENCIA`                           | Vigencia hasta la cual se evalúa la operación              |
| `ESTADO_AUTORIZACION`                            | Estado recibido desde la fuente                            |
| `TIPO_IDENTIFICACION`, `IDENTIFICACION_PACIENTE` | Identidad clínica; evitar divulgar en evidencias de prueba |
| `NUMERO_PRESCRIPCION`                            | Referencia cuando existe y corresponde                     |

**Pasos:**

1. Descargar plantilla actual desde `/autorizaciones` y completar las 28 columnas según la fuente. Mantener las fechas en forma inequívoca; evitar ambigüedad regional Excel/WPS.
2. Seleccionar XLSX (`POST /api/v1/bulk-imports/authorizations/upload`). La carga de autorizaciones admite hasta 50 MiB, y el parser rechaza macros y celdas con fórmulas.
3. Revisar el job: `READY`, `INVALID` y cantidades de filas válidas/inválidas. **En la carga inicial se exige la identidad `NUMERO_AUTORIZACION` + `CODIGO_COMERCIAL`; las demás compuertas de negocio no necesariamente impiden persistir.**
4. Confirmar el job (`POST /api/v1/bulk-imports/:id/confirm`); revisar `COMPLETED`, `PARTIALLY_COMPLETED` o `FAILED` y el detalle de filas.
5. Descargar **filas rechazadas** (`GET /api/v1/bulk-imports/:id/rejected.xlsx`) o resultado, corregir en la fuente, y recargar/reintentar según el estado. `retry-failed` está disponible solo para estados permitidos.
6. Consultar la AUTO en `/autorizaciones/consulta`. Confirmar habilitación, vigencia, cobertura, validación AT, cantidades y permisos de operación por separado.

**Salida:** AUTO conservada o actualizada con trazabilidad de carga y estado operacional calculado; **no** se asignan medicamentos físicos con el cargue. Importar una autorización vencida, con cantidad insuficiente o no presente en AT puede conservar su registro, pero no habilitar compra/atención.

**Casos particulares:** recarga con mismos datos (comportamiento sin cambios esperado); cambio de vigencia/estado 16 → 5 sujeto a [BR-AUTO-REN-001](requirements/BR-AUTO-REN-001-estado-16-vigencia.md); anulación irreversible para AUTO sin entrega/aplicación con [BR-AUTO-ANNUL-001](requirements/BR-AUTO-ANNUL-001-anulacion-autorizacion.md). No presentar estas excepciones como recuperación libre de consumo.

## MTD-OC-01 — Preparar, cargar y emitir una OC

**Responsable:** MTD con `purchase_orders.manage`. **Pantalla:** `/ordenes-compra`. **Entradas:** cobertura de compra, OC, AUTOs elegibles y códigos comerciales. Se puede construir una OC desde demanda consolidada o mediante el archivo de importación directa.

**Archivo oficial:** `GET /api/v1/purchase-orders/import/template.xlsx`. Versión actual `PURCHASE_ORDERS_V3`, hoja `ORDENES_COMPRA` más `METADATA` (`templateVersion`, `importType=PURCHASE_ORDERS`). Cinco columnas y este orden **exacto**:

```csv
CLAVE_AUTORIZACION_ORIGEN,CLAVE_AUTORIZACION_DESTINO,OC,CODIGO_PRODUCTO,CANTIDAD
```

**La acción se infiere del contenido, no se envía una columna ACCION:**

| OC en sistema | Clave origen | Significado                                        |
| ------------- | ------------ | -------------------------------------------------- |
| No existe     | Vacía        | **Crear** nueva OC para la AUTO destino            |
| Existe        | Vacía        | **Asignar** cantidad disponible a esa OC existente |
| Existe        | Informada    | **Reasignar** desde AUTO origen hacia AUTO destino |

- La clave destino, OC, código y cantidad entera positiva son obligatorios; el importador no permite repetir `AUTO_DESTINO + OC` dentro del mismo archivo.
- La misma AUTO puede repartir su saldo de compra entre varias OC, bajo los límites de cobertura. Ejemplo conceptual: autorizada 10 → OC-A 4 y OC-B 6. Requiere validar realmente elegibilidad y saldo.
- **Reasignación 1:1** exige reglas estrictas de producto, cantidad completa, origen no consumido, destino válido y contexto operacional. **No se debe interpretar como reasignación parcial libre.**
- Si se crea una OC nueva correctamente desde la carga, el código la **emite** para OLP; no necesita asumir una emisión manual posterior. En la creación por API interactiva, `create` y `issue` son acciones separadas.
- El resultado del importador incluye `acceptedRows`, `rejectedRows`, `createdOrders` y reporte de errores. **Revisar resultados antes de comunicar OC a OLP**; no asumir éxito total por el solo envío del archivo.

**Ejemplos sintéticos ilustrativos** (usar siempre la plantilla XLSX oficial):

```text
origen=(vacío), destino=AU100|PROD1, OC=OC-200, producto=PROD1, cantidad=4  → OC nueva
origen=(vacío), destino=AU100|PROD1, OC=OC-201, producto=PROD1, cantidad=6  → segunda OC, si hay saldo
origen=AU100|PROD1, destino=AU101|PROD1, OC=OC-200, producto=PROD1, cantidad=4 → NO asumir válido: debe cumplir contrato 1:1 completo
```

No use estos valores como claves reales. La columna destino puede resolverse desde la clave persistida o por número de autorización junto con código comercial, sujeto a ausencia de ambigüedad.

## MTD-CONTROL-01 — Seguimiento, auditoría y excepciones

- Verificar estado de OC en `/ordenes-compra` y consulta de detalle operacional. Registrar si OLP aceptó, fecha comprometida, recibido acumulado y cantidad pendiente.
- Contrastar recepción real y asignaciones en `/inventario/disponibilidad`; la OC no crea existencia ficticia.
- Consultar exportables de candidatos AUTO/OC y auditorías (incluida facturación) conforme a permisos.
- Anular una AUTO **solo sin entrega/aplicación confirmada**; liberar reservas no cancela la OC ni modifica snapshots de compra.
- Supervisar MIPRES y novedades como compuertas separadas; la aprobación administrativa interna no reemplaza prueba externa cuando aplique.
- Ejecutar reconciliación en un entorno autorizado y registrar issues sin modificar históricos por fuera de flujos soportados.

**Comprobación antes de dar por cerrado un día:** archivos aceptados/rechazados, totales OC, compromiso OLP, recepción acumulada y diferencias abiertas; cualquier `409`/`403` requiere clasificación, no reintentos ciegos.

**Archivos fuente:** `apps/api/src/tariff-annex/*`, `bulk-imports/*`, `purchase-orders/*`, `clinical/*`; contratos en `packages/contracts/src/index.ts`; UI en `apps/web/features/purchase-orders` y `apps/web/features/authorizations`.

## MTD-OC-02 — Reutilización tras anulación

1. Confirmar que la autorización anterior quedó anulada sin consumo.
2. Consultar la OC y verificar producto, punto y saldo.
3. Distinguir disponibilidad física y compra pendiente.
4. Preparar importación con AUTO_ORIGEN vacía y nueva AUTO_DESTINO.
5. Verificar las filas aceptadas o rechazadas.
6. Comprobar la nueva fuente de compra y el evento de auditoría.
7. Confirmar que no se modificaron las recepciones ni el solicitado de OC.

Ver [AC-FIN-001](requirements/AC-FIN-001-capacidad-compra-anulaciones.md).

## MTD-RECAUDO-01 — Recaudo único de cuota moderadora

MTD registra el 100 % de la cuota moderadora una sola vez por autorización;
MEDICARTE solo consulta el estado financiero. Antes de la primera entrega o
aplicación se exige producto asignado y reserva activa; después de un
cumplimiento parcial o completo se permite el recaudo total. El registro no
modifica inventario, reservas ni cumplimientos.

Cada autorización aprobada corresponde a un producto y N unidades. El servicio
serializa el registro sobre su fila, exige una atención confirmada o una reserva
activa con saldo, rechaza autorizaciones anuladas y considera cerrada la
obligación si existe cualquier `COLLECTED` histórico. Los números históricos
asociados a más de un producto se bloquean para conciliación; no se infiere una
identidad financiera global. Ver
[RF-MTD-RECAUDO-001](requirements/RF-MTD-RECAUDO-001-recaudo-unico-cuota-moderadora.md).
