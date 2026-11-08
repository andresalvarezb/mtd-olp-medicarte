import { createHash } from 'node:crypto';

export const PATIENT_CHANGES_FEED_KEY = 'patients.changes.basic';
export const PATIENT_CHANGES_MAX_PAGES = 500;
export const PATIENT_CHANGES_MAX_RECORDS_PER_PAGE = 1000;
export const PATIENT_CHANGES_MAX_CURSOR_LENGTH = 4096;

export type PatientChangesRecord = Readonly<{
  documentType: string;
  documentValue: string;
}>;

export type PatientChangesPage = Readonly<{
  syncAsOf: string;
  records: readonly PatientChangesRecord[];
  hasMore: boolean;
  nextCursor?: string;
}>;

export type PatientChangesRequest =
  | Readonly<{ since: string; profile: 'basic'; limit: number }>
  | Readonly<{ cursor: string }>;

export interface PatientChangesSource {
  fetchPage(request: PatientChangesRequest): Promise<PatientChangesPage>;
}

export type PatientChangesCheckpoint = Readonly<{
  runId: string;
  leaseToken: string;
  baseAsOf: string;
  pendingAsOf: string | null;
  nextCursor: string | null;
  cursorFingerprints: readonly string[];
}>;

export type PatientChangesPageOutcome = Readonly<{
  recordsSeen: number;
  localPatientsMatched: number;
  unrelatedRecordsSkipped: number;
  ambiguousLocalRecordsSkipped: number;
  boundaryDuplicatesSkipped: number;
  staleRecordsSkipped: number;
}>;

export interface PatientChangesSyncRepository {
  claim(input: { now: Date; leaseMs: number }): Promise<PatientChangesCheckpoint | null>;
  persistPage(input: {
    checkpoint: PatientChangesCheckpoint;
    page: PatientChangesPage;
    cursorFingerprints: readonly string[];
    nextCursor: string | null;
    leaseMs: number;
    retries: number;
  }): Promise<PatientChangesPageOutcome>;
  markFailed(input: {
    checkpoint: PatientChangesCheckpoint;
    code: PatientChangesSyncErrorCode;
    retries: number;
  }): Promise<void>;
}

export type PatientChangesSyncErrorCode =
  | 'INITIAL_CHECKPOINT_MISSING'
  | 'SOURCE_FAILURE'
  | 'INVALID_PAGE'
  | 'INVALID_CURSOR'
  | 'CURSOR_LOOP'
  | 'AS_OF_MISMATCH'
  | 'PAGE_LIMIT_EXCEEDED'
  | 'FENCED_RUN';

export class PatientChangesSyncError extends Error {
  constructor(readonly code: PatientChangesSyncErrorCode) {
    super(code);
    this.name = 'PatientChangesSyncError';
  }
}

export type PatientChangesSyncResult = Readonly<{
  status: 'COMPLETED' | 'BUSY' | 'FAILED';
  code?: PatientChangesSyncErrorCode;
  pagesProcessed: number;
  recordsSeen: number;
  localPatientsMatched: number;
  unrelatedRecordsSkipped: number;
  ambiguousLocalRecordsSkipped: number;
  boundaryDuplicatesSkipped: number;
  staleRecordsSkipped: number;
  retries: number;
}>;

export type PatientChangesSyncOptions = Readonly<{
  pageLimit: number;
  leaseMs: number;
  maxRetries: number;
  maxPages: number;
  retryDelayMs?: (attempt: number) => number;
  sleep?: (ms: number) => Promise<void>;
}>;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class PatientChangesSyncService {
  private running = false;

  constructor(
    private readonly repository: PatientChangesSyncRepository,
    private readonly source: PatientChangesSource,
    private readonly options: PatientChangesSyncOptions,
  ) {
    if (!Number.isInteger(options.pageLimit) || options.pageLimit < 1 || options.pageLimit > 1000) {
      throw new Error('invalid patient changes page limit');
    }
    if (!Number.isInteger(options.maxRetries) || options.maxRetries < 0 || options.maxRetries > 5) {
      throw new Error('invalid patient changes retry limit');
    }
    if (
      !Number.isInteger(options.maxPages) ||
      options.maxPages < 1 ||
      options.maxPages > PATIENT_CHANGES_MAX_PAGES
    ) {
      throw new Error('invalid patient changes max pages');
    }
  }

  async run(): Promise<PatientChangesSyncResult> {
    if (this.running) return emptyResult('BUSY');
    this.running = true;
    let checkpoint: PatientChangesCheckpoint | null = null;
    const totals = emptyTotals();
    try {
      checkpoint = await this.repository.claim({ now: new Date(), leaseMs: this.options.leaseMs });
      if (!checkpoint) return emptyResult('BUSY');
      for (let index = 0; index < this.options.maxPages; index += 1) {
        const request: PatientChangesRequest = checkpoint.nextCursor
          ? { cursor: checkpoint.nextCursor }
          : {
              since: checkpoint.pendingAsOf ?? checkpoint.baseAsOf,
              profile: 'basic',
              limit: this.options.pageLimit,
            };
        const page = await this.readWithRetry(request, totals);
        validatePage(page);
        if (
          checkpoint.pendingAsOf &&
          Date.parse(page.syncAsOf) !== Date.parse(checkpoint.pendingAsOf)
        ) {
          throw new PatientChangesSyncError('AS_OF_MISMATCH');
        }
        if (Date.parse(page.syncAsOf) < Date.parse(checkpoint.baseAsOf)) {
          throw new PatientChangesSyncError('AS_OF_MISMATCH');
        }
        if (
          page.hasMore &&
          (!page.nextCursor || page.nextCursor.length > PATIENT_CHANGES_MAX_CURSOR_LENGTH)
        ) {
          throw new PatientChangesSyncError('INVALID_CURSOR');
        }
        const nextCursor = page.hasMore ? page.nextCursor! : null;
        const fingerprints: string[] = [...checkpoint.cursorFingerprints];
        if (nextCursor) {
          const fingerprint = createHash('sha256').update(nextCursor).digest('hex');
          if (fingerprints.includes(fingerprint)) throw new PatientChangesSyncError('CURSOR_LOOP');
          fingerprints.push(fingerprint);
        }
        const outcome = await this.repository.persistPage({
          checkpoint,
          page,
          cursorFingerprints: fingerprints,
          nextCursor,
          leaseMs: this.options.leaseMs,
          retries: totals.retries,
        });
        addTotals(totals, outcome);
        totals.pagesProcessed += 1;
        if (!page.hasMore) return { status: 'COMPLETED', ...totals };
        checkpoint = {
          ...checkpoint,
          pendingAsOf: page.syncAsOf,
          nextCursor,
          cursorFingerprints: fingerprints,
        };
      }
      throw new PatientChangesSyncError('PAGE_LIMIT_EXCEEDED');
    } catch (error) {
      const code = error instanceof PatientChangesSyncError ? error.code : 'SOURCE_FAILURE';
      if (checkpoint) {
        try {
          await this.repository.markFailed({ checkpoint, code, retries: totals.retries });
        } catch {
          // Safe bounded error code is returned; raw DB/source errors may contain sensitive details.
        }
      }
      return { status: 'FAILED', code, ...totals };
    } finally {
      this.running = false;
    }
  }

  private async readWithRetry(
    request: PatientChangesRequest,
    totals: MutableTotals,
  ): Promise<PatientChangesPage> {
    for (let attempt = 0; attempt <= this.options.maxRetries; attempt += 1) {
      try {
        return await this.source.fetchPage(request);
      } catch {
        if (attempt >= this.options.maxRetries) throw new PatientChangesSyncError('SOURCE_FAILURE');
        totals.retries += 1;
        const baseDelay = Math.min(30_000, 250 * 2 ** attempt);
        const delay =
          this.options.retryDelayMs?.(attempt + 1) ??
          Math.floor(baseDelay + Math.random() * Math.max(1, baseDelay * 0.2));
        await (this.options.sleep ?? sleep)(delay);
      }
    }
    throw new PatientChangesSyncError('SOURCE_FAILURE');
  }
}

export class PatientChangesSyncScheduler {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly sync: Pick<PatientChangesSyncService, 'run'>,
    private readonly report: (result: PatientChangesSyncResult) => void,
  ) {}

  start(intervalMs: number): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.trigger(), intervalMs);
  }

  async trigger(): Promise<PatientChangesSyncResult | null> {
    if (this.running) return null;
    this.running = true;
    try {
      const result = await this.sync.run();
      this.report(result);
      return result;
    } finally {
      this.running = false;
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}

type MutableTotals = {
  pagesProcessed: number;
  recordsSeen: number;
  localPatientsMatched: number;
  unrelatedRecordsSkipped: number;
  ambiguousLocalRecordsSkipped: number;
  boundaryDuplicatesSkipped: number;
  staleRecordsSkipped: number;
  retries: number;
};

function emptyTotals(): MutableTotals {
  return {
    pagesProcessed: 0,
    recordsSeen: 0,
    localPatientsMatched: 0,
    unrelatedRecordsSkipped: 0,
    ambiguousLocalRecordsSkipped: 0,
    boundaryDuplicatesSkipped: 0,
    staleRecordsSkipped: 0,
    retries: 0,
  };
}

function emptyResult(status: 'BUSY'): PatientChangesSyncResult {
  return { status, ...emptyTotals() };
}

function addTotals(target: MutableTotals, outcome: PatientChangesPageOutcome): void {
  target.recordsSeen += outcome.recordsSeen;
  target.localPatientsMatched += outcome.localPatientsMatched;
  target.unrelatedRecordsSkipped += outcome.unrelatedRecordsSkipped;
  target.ambiguousLocalRecordsSkipped += outcome.ambiguousLocalRecordsSkipped;
  target.boundaryDuplicatesSkipped += outcome.boundaryDuplicatesSkipped;
  target.staleRecordsSkipped += outcome.staleRecordsSkipped;
}

function validatePage(page: PatientChangesPage): void {
  if (
    !page ||
    typeof page !== 'object' ||
    typeof page.syncAsOf !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(page.syncAsOf) ||
    !Number.isFinite(Date.parse(page.syncAsOf)) ||
    !Array.isArray(page.records) ||
    page.records.length > PATIENT_CHANGES_MAX_RECORDS_PER_PAGE ||
    typeof page.hasMore !== 'boolean'
  ) {
    throw new PatientChangesSyncError('INVALID_PAGE');
  }
  if (page.hasMore !== (typeof page.nextCursor === 'string' && page.nextCursor.length > 0)) {
    throw new PatientChangesSyncError('INVALID_CURSOR');
  }
  const records = page.records as readonly PatientChangesRecord[];
  for (const record of records) {
    if (
      !record ||
      typeof record.documentType !== 'string' ||
      typeof record.documentValue !== 'string' ||
      !record.documentType.trim() ||
      !record.documentValue.trim() ||
      record.documentType.length > 80 ||
      record.documentValue.length > 255
    ) {
      throw new PatientChangesSyncError('INVALID_PAGE');
    }
  }
}
