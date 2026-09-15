#!/usr/bin/env node
/**
 * ESP-016: fail if modern runtime code reads or writes forbidden
 * authorization_items operational columns outside the explicit allowlist.
 *
 * Policy lives in @authorization/domain (classification registry + scan engine).
 * This script only walks the filesystem and prints the gate lines.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.cwd();
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DOMAIN_SCAN_DIST = join(
  SCRIPT_DIR,
  '../packages/domain/dist/legacy-operational-usage-scan.js',
);

if (!existsSync(DOMAIN_SCAN_DIST)) {
  console.error('LEGACY_OPERATIONAL_USAGE_CHECK=FAIL');
  console.error(
    `  scanner engine missing: ${relative(ROOT, DOMAIN_SCAN_DIST)} (build @authorization/domain)`,
  );
  process.exit(1);
}

const require = createRequire(import.meta.url);
const {
  LEGACY_SCAN_COVERAGE_BY_ROOT,
  LEGACY_SCAN_NEGATIVE_FIXTURES,
  LEGACY_SCAN_POLICY_REPORT,
  LEGACY_SCAN_POSITIVE_FIXTURES,
  LEGACY_SCAN_REQUIRED_COVERAGE,
  LEGACY_SCAN_REQUIRED_NEGATIVE_COUNT,
  LEGACY_SCAN_REQUIRED_POSITIVE_COUNT,
  LEGACY_SCAN_COMPUTED_MEMBER_FAIL_IDS,
  LEGACY_SCAN_COMPUTED_MEMBER_PASS_IDS,
  LEGACY_SCAN_SCHEMA_ADMISSION_FAIL_IDS,
  LEGACY_SCAN_SCHEMA_ADMISSION_PASS_IDS,
  LEGACY_SCAN_RUNTIME_ROOTS,
  LEGACY_SCAN_SKIP_DIRECTORY_NAMES,
  collectLegacyOperationalUsageHits,
  isLegacyScanSourceFile,
} = require(DOMAIN_SCAN_DIST);

const skipDirectories = new Set(LEGACY_SCAN_SKIP_DIRECTORY_NAMES);

if (
  LEGACY_SCAN_NEGATIVE_FIXTURES.length !== LEGACY_SCAN_REQUIRED_NEGATIVE_COUNT ||
  LEGACY_SCAN_POSITIVE_FIXTURES.length !== LEGACY_SCAN_REQUIRED_POSITIVE_COUNT
) {
  console.error('LEGACY_OPERATIONAL_USAGE_CHECK=FAIL');
  console.error('SCANNER_NEGATIVE_TESTS=FAIL');
  console.error(
    `  matrix size drift: negatives ${LEGACY_SCAN_NEGATIVE_FIXTURES.length}/${LEGACY_SCAN_REQUIRED_NEGATIVE_COUNT} positives ${LEGACY_SCAN_POSITIVE_FIXTURES.length}/${LEGACY_SCAN_REQUIRED_POSITIVE_COUNT}`,
  );
  process.exit(1);
}

const negativeHits = collectLegacyOperationalUsageHits(LEGACY_SCAN_NEGATIVE_FIXTURES);
const missedNegatives = LEGACY_SCAN_NEGATIVE_FIXTURES.filter(
  (fixture) =>
    !negativeHits.some((hit) => hit.path === fixture.path && hit.token === fixture.token),
);
const positiveHits = collectLegacyOperationalUsageHits(LEGACY_SCAN_POSITIVE_FIXTURES);
if (missedNegatives.length > 0 || positiveHits.length > 0) {
  console.error('LEGACY_OPERATIONAL_USAGE_CHECK=FAIL');
  console.error('SCANNER_NEGATIVE_TESTS=FAIL');
  for (const fixture of missedNegatives) {
    console.error(`  missed forbidden fixture: ${fixture.path} ${fixture.token}`);
  }
  for (const hit of positiveHits) {
    console.error(`  false positive fixture: ${hit.path} ${hit.token} [${hit.policy}]`);
  }
  process.exit(1);
}

function walk(directory, files = []) {
  if (!existsSync(directory)) return files;
  for (const entry of readdirSync(directory)) {
    if (skipDirectories.has(entry)) continue;
    const full = join(directory, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, files);
    else if (isLegacyScanSourceFile(entry)) files.push(full);
  }
  return files;
}

const files = [];
const missingRoots = [];
for (const root of LEGACY_SCAN_RUNTIME_ROOTS) {
  const directory = join(ROOT, root);
  if (!existsSync(directory)) {
    missingRoots.push(root);
    continue;
  }
  walk(directory, files);
}

if (missingRoots.length > 0) {
  console.error('LEGACY_OPERATIONAL_USAGE_CHECK=FAIL');
  console.error('FULL_RUNTIME_LEGACY_SCAN=FAIL');
  for (const root of missingRoots) console.error(`  missing scan root: ${root}`);
  process.exit(1);
}

const hits = collectLegacyOperationalUsageHits(
  files.map((file) => ({
    path: relative(ROOT, file).replaceAll('\\', '/'),
    source: readFileSync(file, 'utf8'),
  })),
);

if (hits.length > 0) {
  console.error('LEGACY_OPERATIONAL_USAGE_CHECK=FAIL');
  console.error('FULL_RUNTIME_LEGACY_SCAN=FAIL');
  for (const hit of hits) {
    console.error(`  ${hit.path}: ${hit.token} [${hit.policy}]`);
  }
  process.exit(1);
}

const coverage = LEGACY_SCAN_REQUIRED_COVERAGE.join(',');
const documented = Object.values(LEGACY_SCAN_COVERAGE_BY_ROOT).join(',');
if (coverage !== documented) {
  console.error('LEGACY_OPERATIONAL_USAGE_CHECK=FAIL');
  console.error('FULL_RUNTIME_LEGACY_SCAN=FAIL');
  console.error(`  coverage mismatch: required ${coverage} vs documented ${documented}`);
  process.exit(1);
}

console.log('LEGACY_OPERATIONAL_USAGE_CHECK=PASS');
console.log('FULL_RUNTIME_LEGACY_SCAN=PASS');
console.log('SCANNER_NEGATIVE_TESTS=PASS');
console.log(`SCAN_COVERAGE=${coverage}`);

const negativeIds = new Set(LEGACY_SCAN_NEGATIVE_FIXTURES.map((fixture) => fixture.id));
const positiveIds = new Set(LEGACY_SCAN_POSITIVE_FIXTURES.map((fixture) => fixture.id));
const missingComputed = [
  ...LEGACY_SCAN_COMPUTED_MEMBER_FAIL_IDS.filter((id) => !negativeIds.has(id)),
  ...LEGACY_SCAN_COMPUTED_MEMBER_PASS_IDS.filter((id) => !positiveIds.has(id)),
];
const missingAdmission = [
  ...LEGACY_SCAN_SCHEMA_ADMISSION_FAIL_IDS.filter((id) => !negativeIds.has(id)),
  ...LEGACY_SCAN_SCHEMA_ADMISSION_PASS_IDS.filter((id) => !positiveIds.has(id)),
];
if (missingComputed.length > 0 || missingAdmission.length > 0) {
  console.error('COMPUTED_MEMBER_LEGACY_SCAN=FAIL');
  console.error('SCHEMA_ADMISSION_BOUNDARY_SCAN=FAIL');
  process.exit(1);
}
console.log('COMPUTED_MEMBER_LEGACY_SCAN=PASS');
console.log('SCHEMA_ADMISSION_BOUNDARY_SCAN=PASS');
console.log('DYNAMIC_COMPUTED_KEYS=OUT_OF_SCOPE');
for (const entry of LEGACY_SCAN_POLICY_REPORT) {
  console.log(
    `ALLOWLIST_ENTRY path=${entry.path} rule=${entry.rule} fields=${entry.fields} justification=${entry.reason}`,
  );
}
