export const importTerminalErrorClassifications = {
  processing: 'PROCESSING_ERROR',
  processorVersionMismatch: 'PROCESSOR_VERSION_MISMATCH',
} as const;

export type ImportTerminalErrorClassification =
  (typeof importTerminalErrorClassifications)[keyof typeof importTerminalErrorClassifications];

export class NonRetryableImportError extends Error {
  constructor(readonly classification: ImportTerminalErrorClassification) {
    super(classification);
    this.name = 'NonRetryableImportError';
  }
}

export function classifyTerminalImportError(
  failedReason: string,
): ImportTerminalErrorClassification {
  return failedReason === importTerminalErrorClassifications.processorVersionMismatch
    ? importTerminalErrorClassifications.processorVersionMismatch
    : importTerminalErrorClassifications.processing;
}
