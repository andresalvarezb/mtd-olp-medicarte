import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const SCRIPT = resolve('scripts/prepare-tariff-annex.mjs');

const OUTPUT_HEADERS = [
  'CODIGO_MEDICAMENTO',
  'TARIFA_UNIDAD',
  'NUMERO_EXPEDIENTE_INVIMA',
  'CONSECUTIVO_INVIMA_PRESENTACION',
  'DESCRIPCION_GENERICA_MEDICAMENTO',
  'DESCRIPCION_COMERCIAL_MEDICAMENTO',
  'LABORATORIO_MEDICAMENTO',
  'TIPO_INCLUSION_MEDICAMENTO',
];

const SOURCE_HEADERS = [
  'Razon Social MEDMEDYTER',
  'Nit del Proveedor',
  'Código Interno Medicamento Del Proveedor',
  ' Tarifa de la unidad Farmacéutica ',
  'Número de Expediente del INVIMA',
  'Consecutivo INVIMA (Presentación)',
  'Número Trazador (Expediente-consecutivo)',
  'Descripción Genérica del Medicamento (DCI)',
  'Descripción Comercial del Medicamento ',
  'Laboratorio del Medicamento',
  'Tipo de Inclusion del Medicamento (PBS/NOPBS)',
  'OTRA_COLUMNA',
];

function writeSource(path, { omitType = false } = {}) {
  const headers = omitType
    ? SOURCE_HEADERS.filter(
        (header) =>
          header !== 'Tipo de Inclusion del Medicamento (PBS/NOPBS)',
      )
    : SOURCE_HEADERS;

  const row1 = {
    'Razon Social MEDMEDYTER': 'MEDMEDYTER',
    'Nit del Proveedor': '900000001',
    'Código Interno Medicamento Del Proveedor': '12633',
    ' Tarifa de la unidad Farmacéutica ': '$ 176,727',
    'Número de Expediente del INVIMA': '19959808',
    'Consecutivo INVIMA (Presentación)': '1',
    'Número Trazador (Expediente-consecutivo)': '19959808-1',
    'Descripción Genérica del Medicamento (DCI)':
      'ACIDO ZOLEDRONICO VIAL INST CAJA X 1',
    'Descripción Comercial del Medicamento ':
      'ACLASTA LIVI 5MG/100ML SOL INY',
    'Laboratorio del Medicamento':
      'PHARMALAB PHL LABORATORIOS S.A.S.',
    'Tipo de Inclusion del Medicamento (PBS/NOPBS)': 'PBS',
    OTRA_COLUMNA: 'NO DEBE SALIR',
  };

  const row2 = {
    ...row1,
    'Código Interno Medicamento Del Proveedor': '11367',
    ' Tarifa de la unidad Farmacéutica ': '$ 1,927,657',
    'Número de Expediente del INVIMA': '20039088',
    'Consecutivo INVIMA (Presentación)': '11',
  };

  const worksheet = XLSX.utils.aoa_to_sheet([
    headers,
    headers.map((header) => row1[header] ?? null),
    headers.map((header) => row2[header] ?? null),
  ]);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Tarifario');
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([['NO USAR']]),
    'Lista',
  );

  XLSX.writeFile(workbook, path);
}

test('genera una sola hoja con las 8 columnas exactas', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tariff-annex-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const input = join(dir, 'origen.xlsx');
  const output = join(dir, 'preparado.xlsx');

  writeSource(input);

  const result = spawnSync(
    process.execPath,
    [SCRIPT, '--input', input, '--output', output],
    {
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /WRITE=OK/);

  const workbook = XLSX.readFile(output);

  assert.deepEqual(workbook.SheetNames, ['Tarifario']);

  const rows = XLSX.utils.sheet_to_json(
    workbook.Sheets.Tarifario,
    {
      header: 1,
      defval: null,
      raw: true,
    },
  );

  assert.deepEqual(rows[0], OUTPUT_HEADERS);
  assert.equal(rows.length, 3);

  assert.deepEqual(rows[1], [
    '12633',
    '$ 176,727',
    '19959808',
    '1',
    'ACIDO ZOLEDRONICO VIAL INST CAJA X 1',
    'ACLASTA LIVI 5MG/100ML SOL INY',
    'PHARMALAB PHL LABORATORIOS S.A.S.',
    'PBS',
  ]);
});

test('falla claramente cuando falta una columna requerida', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tariff-annex-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const input = join(dir, 'incompleto.xlsx');

  writeSource(input, { omitType: true });

  const result = spawnSync(
    process.execPath,
    [SCRIPT, '--input', input, '--check-only'],
    {
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /ERROR=MISSING_COLUMNS/);
  assert.match(result.stderr, /TIPO_INCLUSION_MEDICAMENTO/);
});

test('omite filas completamente vacías y filas con datos solo en columnas no contractuales', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tariff-annex-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const input = join(dir, 'origen-con-filas-no-contractuales.xlsx');
  const output = join(dir, 'preparado.xlsx');

  const headers = SOURCE_HEADERS;

  const validRow = {
    'Razon Social MEDMEDYTER': 'MEDMEDYTER',
    'Nit del Proveedor': '900000001',
    'Código Interno Medicamento Del Proveedor': '12633',
    ' Tarifa de la unidad Farmacéutica ': 176727,
    'Número de Expediente del INVIMA': '19959808',
    'Consecutivo INVIMA (Presentación)': '1',
    'Número Trazador (Expediente-consecutivo)': '19959808-1',
    'Descripción Genérica del Medicamento (DCI)':
      'ACIDO ZOLEDRONICO VIAL INST CAJA X 1',
    'Descripción Comercial del Medicamento ':
      'ACLASTA LIVI 5MG/100ML SOL INY',
    'Laboratorio del Medicamento':
      'PHARMALAB PHL LABORATORIOS S.A.S.',
    'Tipo de Inclusion del Medicamento (PBS/NOPBS)': 'PBS',
    OTRA_COLUMNA: null,
  };

  const nonContractualOnlyRow = {
    OTRA_COLUMNA: 'x',
  };

  const worksheet = XLSX.utils.aoa_to_sheet([
    headers,
    headers.map((header) => validRow[header] ?? null),
    headers.map(() => null),
    headers.map((header) => nonContractualOnlyRow[header] ?? null),
  ]);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Tarifario');
  XLSX.writeFile(workbook, input);

  const result = spawnSync(
    process.execPath,
    [SCRIPT, '--input', input, '--output', output],
    {
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /DATA_ROWS=1/);
  assert.match(result.stdout, /SKIPPED_EMPTY_ROWS=1/);
  assert.match(result.stdout, /SKIPPED_NON_CONTRACTUAL_ONLY_ROWS=1/);
  assert.match(result.stdout, /SKIPPED_ROWS_TOTAL=2/);

  const preparedWorkbook = XLSX.readFile(output);
  const rows = XLSX.utils.sheet_to_json(
    preparedWorkbook.Sheets.Tarifario,
    {
      header: 1,
      defval: null,
      raw: true,
    },
  );

  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], OUTPUT_HEADERS);
  assert.equal(String(rows[1][0]), '12633');
});
