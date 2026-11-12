import { createDatabase } from '@authorization/database';
import type { PatientIdentityNormalizationPolicy } from '@authorization/domain';
import {
  assertSyntheticPatientBackfillAllowed,
  createSyntheticPatientBackfillBatch,
  inspectPatientBackfillInventory,
  processSyntheticPatientBackfillBatch,
  revertSyntheticPatientBackfillBatch,
} from './patient-backfill.repository';
import {
  createCompensarPatientBackfillBatch,
  enqueueCompensarPatientBackfillBatch,
  inspectCompensarPatientBackfill,
  processCompensarPatientBackfillBatch,
  revertCompensarPatientBackfillBatch,
} from './patient-backfill-compensar.repository';

const policyVersion = process.env.PATIENT_BACKFILL_POLICY_VERSION ?? '';
const policy: PatientIdentityNormalizationPolicy = {
  version: policyVersion,
  normalizeDocumentType: (value) => value,
  normalizeDocumentValue: (value) => value,
};

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('PATIENT_BACKFILL_DATABASE_REQUIRED');
  if (argument('source') === 'COMPENSAR') {
    const dryRun = process.argv.includes('--dry-run');
    if (!dryRun && argument('confirm-source') !== 'COMPENSAR') {
      throw new Error('PATIENT_BACKFILL_SOURCE_CONFIRMATION_REQUIRED');
    }
    const database = createDatabase(databaseUrl);
    try {
      if (dryRun) {
        const report = await inspectCompensarPatientBackfill(database);
        process.stdout.write(
          `${JSON.stringify({ mode: 'DRY_RUN', source: 'COMPENSAR', report })}\n`,
        );
        return;
      }
      const revertId = argument('revert');
      if (revertId) {
        const result = await revertCompensarPatientBackfillBatch(database, revertId);
        process.stdout.write(
          `${JSON.stringify({ mode: 'REVERT', source: 'COMPENSAR', batchId: revertId, ...result })}\n`,
        );
        return;
      }
      const queueId = argument('queue-batch');
      if (queueId) {
        if (argument('confirm-worker-enabled') !== 'yes')
          throw new Error('PATIENT_BACKFILL_WORKER_CONFIRMATION_REQUIRED');
        const queued = await enqueueCompensarPatientBackfillBatch(database, queueId);
        process.stdout.write(
          `${JSON.stringify({ mode: 'QUEUE', source: 'COMPENSAR', batchId: queueId, queued })}\n`,
        );
        return;
      }
      const resumeId = argument('resume');
      if (!resumeId && !process.argv.includes('--apply'))
        throw new Error('PATIENT_BACKFILL_MODE_REQUIRED');
      let batchId = resumeId;
      if (!batchId) {
        const expected = Number(argument('expected-scanned'));
        if (
          !Number.isInteger(expected) ||
          expected < 0 ||
          argument('expected-scanned') === undefined
        ) {
          throw new Error('PATIENT_BACKFILL_EXPECTED_SCANNED_REQUIRED');
        }
        const report = await inspectCompensarPatientBackfill(database);
        if (report.scanned !== expected) throw new Error('PATIENT_BACKFILL_INVENTORY_CHANGED');
        batchId = await createCompensarPatientBackfillBatch(
          database,
          Number(argument('batch-size') ?? 100),
        );
      }
      const result = await processCompensarPatientBackfillBatch(database, batchId);
      process.stdout.write(
        `${JSON.stringify({ mode: resumeId ? 'RESUME' : 'APPLY', source: 'COMPENSAR', batchId, ...result })}\n`,
      );
      return;
    } finally {
      await database.pool.end();
    }
  }
  const guard = {
    enabled: process.env.PATIENT_BACKFILL_SYNTHETIC_MODE === 'true',
    nodeEnv: process.env.NODE_ENV,
    databaseUrl,
    policyVersion,
  };
  assertSyntheticPatientBackfillAllowed(guard);
  const database = createDatabase(databaseUrl);
  try {
    if (process.argv.includes('--dry-run')) {
      const report = await inspectPatientBackfillInventory(database, policy);
      process.stdout.write(`${JSON.stringify({ mode: 'DRY_RUN', report })}\n`);
      return;
    }
    const revertId = argument('revert');
    if (revertId) {
      const result = await revertSyntheticPatientBackfillBatch(database, guard, revertId);
      process.stdout.write(`${JSON.stringify({ mode: 'REVERT', ...result })}\n`);
      return;
    }
    if (!process.argv.includes('--apply')) throw new Error('PATIENT_BACKFILL_MODE_REQUIRED');
    const batchSize = Number(argument('batch-size') ?? 100);
    const batchId = await createSyntheticPatientBackfillBatch(database, guard, policy, batchSize);
    let result: Awaited<ReturnType<typeof processSyntheticPatientBackfillBatch>>;
    do {
      result = await processSyntheticPatientBackfillBatch(database, guard, batchId, policy);
    } while (result.remaining);
    process.stdout.write(`${JSON.stringify({ mode: 'APPLY', batchId, ...result })}\n`);
  } finally {
    await database.pool.end();
  }
}

main().catch((error) => {
  const code =
    error instanceof Error && /^PATIENT_BACKFILL_[A-Z_]+$/.test(error.message)
      ? error.message
      : 'PATIENT_BACKFILL_FAILED';
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
});
