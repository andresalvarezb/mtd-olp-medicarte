# Preparador de Anexo Tarifario

## Propósito

`prepare-tariff-annex.mjs` convierte un XLSX comercial recibido de un proveedor al formato requerido para el cargue manual del Anexo Tarifario.

La herramienta únicamente prepara el archivo. No modifica el backend, la base de datos ni las reglas del importador.

## Uso

Validar sin generar archivo:

    pnpm prepare:tariff-annex -- --input "C:/ruta/anexo.xlsx" --check-only

Generar archivo:

    pnpm prepare:tariff-annex -- --input "C:/ruta/anexo.xlsx"

Elegir salida:

    pnpm prepare:tariff-annex -- --input "C:/ruta/anexo.xlsx" --output "C:/ruta/anexo-listo.xlsx"

## Contrato de salida

La salida contiene una sola hoja llamada `Tarifario` y exactamente estas columnas:

1. CODIGO_MEDICAMENTO
2. TARIFA_UNIDAD
3. NUMERO_EXPEDIENTE_INVIMA
4. CONSECUTIVO_INVIMA_PRESENTACION
5. DESCRIPCION_GENERICA_MEDICAMENTO
6. DESCRIPCION_COMERCIAL_MEDICAMENTO
7. LABORATORIO_MEDICAMENTO
8. TIPO_INCLUSION_MEDICAMENTO

## Mapeo del formato comercial conocido

| Fuente | Salida |
|---|---|
| Código Interno Medicamento Del Proveedor | CODIGO_MEDICAMENTO |
| Tarifa de la unidad Farmacéutica | TARIFA_UNIDAD |
| Número de Expediente del INVIMA | NUMERO_EXPEDIENTE_INVIMA |
| Consecutivo INVIMA (Presentación) | CONSECUTIVO_INVIMA_PRESENTACION |
| Descripción Genérica del Medicamento (DCI) | DESCRIPCION_GENERICA_MEDICAMENTO |
| Descripción Comercial del Medicamento | DESCRIPCION_COMERCIAL_MEDICAMENTO |
| Laboratorio del Medicamento | LABORATORIO_MEDICAMENTO |
| Tipo de Inclusion del Medicamento (PBS/NOPBS) | TIPO_INCLUSION_MEDICAMENTO |

La detección tolera diferencias de espacios, mayúsculas, signos y acentos.

## Filas omitidas

Una fila se omite únicamente cuando las ocho columnas contractuales están vacías.

El script reporta:

- `SKIPPED_EMPTY_ROWS`: fila completamente vacía.
- `SKIPPED_NON_CONTRACTUAL_ONLY_ROWS`: fila con datos únicamente en columnas que no pertenecen al Anexo.
- `SKIPPED_ROWS_TOTAL`: total de filas omitidas.

No se elimina una fila que tenga al menos un dato en cualquiera de las ocho columnas contractuales. La validación posterior corresponde al backend.

## Caso validado de septiembre de 2026

El archivo `1.AT Alto Costo MEDICINAS Y TERAPIAS 20260901.xlsx` tiene 80 filas físicas después del encabezado.

El preparador conserva 78 filas contractuales:

- una fila estaba completamente vacía;
- una fila solo tenía información en AVAL/Vbo, RESPONSABLE, Asunto correo/Evidencia y Nivel RC.

Por tanto, 78 es el resultado esperado para ese archivo.

## Comportamiento posterior del sistema

El preparador no modifica la semántica del Anexo Tarifario:

- producto nuevo: `PRODUCT_CREATED`;
- producto activo existente: `PRODUCT_EXISTING`;
- producto inactivo: `PRODUCT_REACTIVATED`;
- duplicado dentro del archivo: `DUPLICATE_IN_FILE`.

Un producto activo existente no es reemplazado por este script.

## Cuando cambia el formato del proveedor

Ejecutar primero:

    pnpm prepare:tariff-annex -- --input "C:/ruta/nuevo-anexo.xlsx" --check-only

Si aparece `MISSING_COLUMNS`, revisar los nuevos encabezados.

Solo debe ampliarse `HEADER_ALIASES` cuando el nuevo encabezado sea inequívocamente equivalente a uno de los ocho campos contractuales.

No se deben agregar nuevas columnas de salida sin cambiar previamente la especificación funcional.

## Pruebas

    pnpm test:prepare-tariff-annex

    node --check scripts/prepare-tariff-annex.mjs
    node --check scripts/prepare-tariff-annex.test.mjs
