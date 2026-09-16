---
name: tariff-annex-prepare
description: Prepara nuevos XLSX comerciales para el cargue manual del Anexo Tarifario mediante la herramienta canónica del monorepo.
metadata:
  version: "1.0.0"
  category: "data-preparation"
---

# Tariff Annex Prepare

## Cuándo usar

Usar cuando se reciba un nuevo Anexo Tarifario o XLSX comercial que deba convertirse al formato aceptado por el cargue manual.

## Herramienta canónica

Validar primero:

    pnpm prepare:tariff-annex -- --input "<archivo.xlsx>" --check-only

Generar:

    pnpm prepare:tariff-annex -- --input "<archivo.xlsx>"

No crear scripts temporales si esta herramienta cubre el formato recibido.

## Salida obligatoria

Una sola hoja `Tarifario` con:

1. CODIGO_MEDICAMENTO
2. TARIFA_UNIDAD
3. NUMERO_EXPEDIENTE_INVIMA
4. CONSECUTIVO_INVIMA_PRESENTACION
5. DESCRIPCION_GENERICA_MEDICAMENTO
6. DESCRIPCION_COMERCIAL_MEDICAMENTO
7. LABORATORIO_MEDICAMENTO
8. TIPO_INCLUSION_MEDICAMENTO

## Reglas

- No modificar el archivo fuente.
- No modificar backend ni base de datos.
- Descartar columnas y hojas ajenas al contrato.
- Omitir filas donde los ocho campos contractuales estén vacíos.
- Conservar filas que tengan al menos un dato contractual.
- No ampliar automáticamente el contrato.
- Si cambia un encabezado del proveedor, validar primero con `--check-only`.

## Semántica posterior

La herramienta solo prepara el XLSX.

El importador mantiene:

- nuevo: PRODUCT_CREATED;
- activo existente: PRODUCT_EXISTING;
- inactivo existente: PRODUCT_REACTIVATED;
- duplicado: DUPLICATE_IN_FILE.

## Cambio de formato del proveedor

Si aparece `MISSING_COLUMNS`:

1. revisar los nuevos encabezados;
2. comprobar su equivalencia semántica;
3. ampliar únicamente `HEADER_ALIASES`;
4. ejecutar `pnpm test:prepare-tariff-annex`;
5. actualizar `scripts/README-tariff-annex.md`.

Documentación operativa:

`scripts/README-tariff-annex.md`
