import { performance } from 'node:perf_hooks';
import XLSX from 'xlsx';

const headers = Array.from({ length: 12 }, (_, i) => 'COL_' + i);

const records = Array.from({ length: 10000 }, (_, row) =>
  Object.fromEntries(
    headers.map((name, col) => [name, 'V' + row + ':' + col]),
  ),
);

function legacy() {
  return XLSX.utils.aoa_to_sheet([
    headers,
    ...records.map((row) => headers.map((column) => row[column])),
  ]);
}

function optimized() {
  const sheet = XLSX.utils.aoa_to_sheet([headers]);

  for (let i = 0; i < records.length; i += 1000) {
    const batch = records
      .slice(i, i + 1000)
      .map((row) => headers.map((column) => row[column]));

    XLSX.utils.sheet_add_aoa(sheet, batch, {
      origin: { r: i + 1, c: 0 },
    });
  }

  return sheet;
}

function run(name, task) {
  global.gc?.();

  const before = process.memoryUsage().heapUsed;
  const start = performance.now();
  const sheet = task();
  const duration = performance.now() - start;
  const heapDelta = process.memoryUsage().heapUsed - before;

  return { name, sheet, duration, heapDelta };
}

const baseline = run('baseline', legacy);
const improved = run('wave2', optimized);

if (baseline.sheet['!ref'] !== improved.sheet['!ref']) {
  throw new Error('WAVE2_BENCHMARK_RANGE_MISMATCH');
}

for (const position of ['A1', 'A2', 'F1001', 'L1002', 'L10001']) {
  if (baseline.sheet[position]?.v !== improved.sheet[position]?.v) {
    throw new Error('WAVE2_BENCHMARK_CELL_MISMATCH: ' + position);
  }
}

for (const item of [baseline, improved]) {
  console.log(
    'WAVE2_BENCH_' + item.name.toUpperCase() + '_MS=' +
    item.duration.toFixed(2),
  );
  console.log(
    'WAVE2_BENCH_' + item.name.toUpperCase() + '_HEAP_DELTA_MB=' +
    (item.heapDelta / 1024 / 1024).toFixed(2),
  );
}

console.log('WAVE2_BENCHMARK_SYNTHETIC=PASS');
