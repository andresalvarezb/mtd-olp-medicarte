#!/usr/bin/env node

import { existsSync, mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, parse, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const OUTPUT_HEADERS = Object.freeze([
  'CODIGO_MEDICAMENTO',
  'TARIFA_UNIDAD',
  'NUMERO_EXPEDIENTE_INVIMA',
  'CONSECUTIVO_INVIMA_PRESENTACION',
  'DESCRIPCION_GENERICA_MEDICAMENTO',
  'DESCRIPCION_COMERCIAL_MEDICAMENTO',
  'LABORATORIO_MEDICAMENTO',
  'TIPO_INCLUSION_MEDICAMENTO',
]);

const HEADER_ALIASES = Object.freeze({
  CODIGO_MEDICAMENTO: 'CODIGO_MEDICAMENTO',
  CODIGO_PRODUCTO: 'CODIGO_MEDICAMENTO',
  CODIGO_INTERNO_MEDICAMENTO_DEL_PROVEEDOR: 'CODIGO_MEDICAMENTO',

  TARIFA_UNIDAD: 'TARIFA_UNIDAD',
  TARIFA_DE_LA_UNIDAD_FARMACEUTICA: 'TARIFA_UNIDAD',

  NUMERO_EXPEDIENTE_INVIMA: 'NUMERO_EXPEDIENTE_INVIMA',
  NUMERO_DE_EXPEDIENTE_DEL_INVIMA: 'NUMERO_EXPEDIENTE_INVIMA',

  CONSECUTIVO_INVIMA_PRESENTACION: 'CONSECUTIVO_INVIMA_PRESENTACION',
  CONSECUTIVO_INVIMA_DE_PRESENTACION: 'CONSECUTIVO_INVIMA_PRESENTACION',

  DESCRIPCION_GENERICA_MEDICAMENTO: 'DESCRIPCION_GENERICA_MEDICAMENTO',
  DESCRIPCION_GENERICA_DEL_MEDICAMENTO_DCI: 'DESCRIPCION_GENERICA_MEDICAMENTO',

  DESCRIPCION_COMERCIAL_MEDICAMENTO: 'DESCRIPCION_COMERCIAL_MEDICAMENTO',
  DESCRIPCION_COMERCIAL_DEL_MEDICAMENTO: 'DESCRIPCION_COMERCIAL_MEDICAMENTO',

  LABORATORIO_MEDICAMENTO: 'LABORATORIO_MEDICAMENTO',
  LABORATORIO_DEL_MEDICAMENTO: 'LABORATORIO_MEDICAMENTO',

  TIPO_INCLUSION_MEDICAMENTO: 'TIPO_INCLUSION_MEDICAMENTO',
  TIPO_DE_INCLUSION_DEL_MEDICAMENTO_PBS_NOPBS: 'TIPO_INCLUSION_MEDICAMENTO',
});

function normalizeHeader(value) {
  return `${value ?? ''}`
    .replace(/^\uFEFF/, '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function isBlank(value) {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim() === '')
  );
}

function detectHeaderRow(rows) {
  let best = null;
  const scanLimit = Math.min(rows.length, 25);

  for (let rowIndex = 0; rowIndex < scanLimit; rowIndex += 1) {
    const row = Array.isArray(rows[rowIndex]) ? rows[rowIndex] : [];
    const mapping = new Map();
    const duplicates = new Set();

    row.forEach((cell, columnIndex) => {
      const normalized = normalizeHeader(cell);
      const target = HEADER_ALIASES[normalized];

      if (!target) return;

      if (mapping.has(target)) {
        duplicates.add(target);
        return;
      }

      mapping.set(target, {
        columnIndex,
        sourceHeader: `${cell ?? ''}`.trim(),
      });
    });

    const candidate = {
      rowIndex,
      rowLength: row.length,
      mapping,
      duplicates,
      score: mapping.size,
    };

    if (!best || candidate.score > best.score) {
      best = candidate;
    }

    if (
      candidate.score === OUTPUT_HEADERS.length &&
      candidate.duplicates.size === 0
    ) {
      return candidate;
    }
  }

  if (!best) {
    fail('HEADER_ROW_NOT_FOUND', 'No fue posible localizar una fila de encabezados.');
  }

  if (best.duplicates.size > 0) {
    fail(
      'AMBIGUOUS_COLUMNS',
      `Se encontraron columnas duplicadas para: ${[...best.duplicates].join(', ')}`,
    );
  }

  const missing = OUTPUT_HEADERS.filter(
    (header) => !best.mapping.has(header),
  );

  fail(
    'MISSING_COLUMNS',
    `Faltan columnas requeridas: ${missing.join(', ')}`,
  );
}

function printHelp() {
  console.log(`
Prepara un XLSX comercial para el cargue manual del Anexo Tarifario.

Uso:
  pnpm prepare:tariff-annex -- --input "<archivo.xlsx>"

Opciones:
  --input <ruta>       XLSX origen. Requerido.
  --output <ruta>      XLSX destino.
                       Por defecto: <archivo>-preparado.xlsx
  --sheet <nombre>     Hoja origen. Por defecto: Tarifario
  --check-only         Valida estructura sin escribir archivo.
  --force              Permite sobrescribir el archivo destino.
  --help               Muestra esta ayuda.

La salida contiene exclusivamente:
  ${OUTPUT_HEADERS.join('\n  ')}
`);
}

function main() {
  const rawArgs = process.argv.slice(2);
  const args = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;

  const { values } = parseArgs({
    args,
    options: {
      input: { type: 'string' },
      output: { type: 'string' },
      sheet: { type: 'string', default: 'Tarifario' },
      'check-only': { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  if (values.help) {
    printHelp();
    return;
  }

  if (!values.input) {
    fail('INPUT_REQUIRED', 'Debe indicar --input <archivo.xlsx>.');
  }

  const inputPath = resolve(values.input);

  if (!existsSync(inputPath)) {
    fail('INPUT_NOT_FOUND', `No existe el archivo: ${inputPath}`);
  }

  if (!statSync(inputPath).isFile()) {
    fail('INPUT_NOT_FILE', `La ruta no corresponde a un archivo: ${inputPath}`);
  }

  if (extname(inputPath).toLowerCase() !== '.xlsx') {
    fail('INVALID_EXTENSION', 'El archivo de entrada debe ser .xlsx.');
  }

  const workbook = XLSX.readFile(inputPath, {
    cellDates: false,
  });

  const requestedSheet = values.sheet;

  const sourceSheetName =
    workbook.SheetNames.find((name) => name === requestedSheet) ??
    workbook.SheetNames.find(
      (name) => name.toLowerCase() === requestedSheet.toLowerCase(),
    );

  if (!sourceSheetName) {
    fail(
      'SHEET_NOT_FOUND',
      `No existe la hoja "${requestedSheet}". Hojas disponibles: ${workbook.SheetNames.join(', ')}`,
    );
  }

  const worksheet = workbook.Sheets[sourceSheetName];

  const rows = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: null,
    raw: true,
    blankrows: true,
  });

  if (rows.length === 0) {
    fail('EMPTY_SHEET', `La hoja "${sourceSheetName}" está vacía.`);
  }

  const detected = detectHeaderRow(rows);

  const preparedRows = [];
  let skippedEmptyRows = 0;
  let skippedNonContractualOnlyRows = 0;

  for (const rawRow of rows.slice(detected.rowIndex + 1)) {
    const row = Array.isArray(rawRow) ? rawRow : [];

    const prepared = OUTPUT_HEADERS.map((header) => {
      const source = detected.mapping.get(header);
      return row[source.columnIndex] ?? null;
    });

    if (prepared.every(isBlank)) {
      if (row.every(isBlank)) {
        skippedEmptyRows += 1;
      } else {
        skippedNonContractualOnlyRows += 1;
      }
      continue;
    }

    preparedRows.push(prepared);
  }

  console.log('STATUS=VALID');
  console.log(`INPUT=${inputPath}`);
  console.log(`SOURCE_SHEET=${sourceSheetName}`);
  console.log(`HEADER_ROW=${detected.rowIndex + 1}`);
  console.log(`DATA_ROWS=${preparedRows.length}`);
  console.log(`SKIPPED_EMPTY_ROWS=${skippedEmptyRows}`);
  console.log(
    `SKIPPED_NON_CONTRACTUAL_ONLY_ROWS=${skippedNonContractualOnlyRows}`,
  );
  console.log(
    `SKIPPED_ROWS_TOTAL=${skippedEmptyRows + skippedNonContractualOnlyRows}`,
  );
  console.log(
    `DROPPED_SOURCE_COLUMNS=${Math.max(0, detected.rowLength - OUTPUT_HEADERS.length)}`,
  );

  for (const header of OUTPUT_HEADERS) {
    const source = detected.mapping.get(header);
    console.log(`MAP=${source.sourceHeader} -> ${header}`);
  }

  if (values['check-only']) {
    console.log('CHECK_ONLY=OK');
    return;
  }

  const parsedInput = parse(inputPath);

  const outputPath = values.output
    ? resolve(values.output)
    : join(parsedInput.dir, `${parsedInput.name}-preparado.xlsx`);

  if (outputPath === inputPath && !values.force) {
    fail(
      'OUTPUT_EQUALS_INPUT',
      'El destino coincide con el origen. Use --force únicamente si desea sobrescribirlo.',
    );
  }

  if (existsSync(outputPath) && !values.force) {
    fail(
      'OUTPUT_EXISTS',
      `El archivo destino ya existe: ${outputPath}. Use --force para sobrescribirlo.`,
    );
  }

  mkdirSync(dirname(outputPath), { recursive: true });

  const outputWorkbook = XLSX.utils.book_new();
  const outputWorksheet = XLSX.utils.aoa_to_sheet([
    OUTPUT_HEADERS,
    ...preparedRows,
  ]);

  XLSX.utils.book_append_sheet(
    outputWorkbook,
    outputWorksheet,
    'Tarifario',
  );

  XLSX.writeFile(outputWorkbook, outputPath, {
    bookType: 'xlsx',
    compression: true,
  });

  console.log(`OUTPUT=${outputPath}`);
  console.log(`OUTPUT_SHEET=Tarifario`);
  console.log(`OUTPUT_COLUMNS=${OUTPUT_HEADERS.length}`);
  console.log('WRITE=OK');
}

try {
  main();
} catch (error) {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? error.code
      : 'UNEXPECTED_ERROR';

  console.error(`ERROR=${code}`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
