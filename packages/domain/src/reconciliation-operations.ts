export const RECONCILIATION_CADENCES = ['DAILY', 'WEEKLY', 'MANUAL'] as const;
export type ReconciliationCadence = (typeof RECONCILIATION_CADENCES)[number];

export const RECONCILIATION_TRIGGER_TYPES = ['MANUAL', 'SCHEDULED', 'RETRY'] as const;
export type ReconciliationTriggerType = (typeof RECONCILIATION_TRIGGER_TYPES)[number];

export const RECONCILIATION_EXECUTION_STATUSES = [
  'PENDING',
  'CLAIMED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'SKIPPED',
] as const;
export type ReconciliationExecutionStatus = (typeof RECONCILIATION_EXECUTION_STATUSES)[number];

export const RECONCILIATION_NOTIFICATION_TYPES = [
  'RECONCILIATION_CRITICAL',
  'RECONCILIATION_ERROR',
  'RECONCILIATION_WARNING',
  'RECONCILIATION_TECHNICAL_FAILURE',
  'RECONCILIATION_RECOVERY',
  'RISK_REVIEW_OVERDUE',
] as const;
export type ReconciliationNotificationType = (typeof RECONCILIATION_NOTIFICATION_TYPES)[number];

export const RECONCILIATION_NOTIFICATION_STATUSES = [
  'PENDING',
  'SENT',
  'FAILED',
  'SUPPRESSED',
] as const;
export type ReconciliationNotificationStatus =
  (typeof RECONCILIATION_NOTIFICATION_STATUSES)[number];

export const RECONCILIATION_SEVERITY_ALERT_THRESHOLDS = [
  'CRITICAL',
  'ERROR',
  'WARNING',
  'NONE',
] as const;
export type ReconciliationSeverityAlertThreshold =
  (typeof RECONCILIATION_SEVERITY_ALERT_THRESHOLDS)[number];

export const RECONCILIATION_NOTIFICATION_CHANNELS = ['IN_APP'] as const;
export type ReconciliationNotificationChannel =
  (typeof RECONCILIATION_NOTIFICATION_CHANNELS)[number];

export const RECONCILIATION_DEFAULT_TIMEZONE = 'America/Bogota';

export type PolicyScheduleConfig = Readonly<{
  cadence: ReconciliationCadence;
  timezone?: string | null | undefined;
  localTime?: string | null | undefined;
  weekday?: number | null | undefined; // 1 = Monday ... 7 = Sunday (ISO 8601)
}>;

export function parseLocalTime(time: string): { hour: number; minute: number } {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time.trim());
  if (!match) {
    throw new Error(`INVALID_LOCAL_TIME: "${time}" must be in HH:mm 24h format`);
  }
  return {
    hour: parseInt(match[1]!, 10),
    minute: parseInt(match[2]!, 10),
  };
}

export function getZonedParts(
  date: Date,
  timezone: string = RECONCILIATION_DEFAULT_TIMEZONE,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 1 = Monday ... 7 = Sunday
} {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
    weekday: 'short',
  });
  const parts = formatter.formatToParts(date);
  const findVal = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '0';

  const weekdayStr = findVal('weekday');
  const weekdayMap: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };

  let hour = parseInt(findVal('hour'), 10);
  if (hour === 24) hour = 0; // Some engines return 24 for midnight in 24h mode

  return {
    year: parseInt(findVal('year'), 10),
    month: parseInt(findVal('month'), 10),
    day: parseInt(findVal('day'), 10),
    hour,
    minute: parseInt(findVal('minute'), 10),
    second: parseInt(findVal('second'), 10),
    weekday: weekdayMap[weekdayStr] ?? 1,
  };
}

export function getZonedDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string = RECONCILIATION_DEFAULT_TIMEZONE,
): Date {
  const testUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'shortOffset',
  });
  const parts = fmt.formatToParts(testUtc);
  const tzPart = parts.find((p) => p.type === 'timeZoneName')?.value;
  const match = tzPart?.match(/GMT([+-]\d+)(?::(\d+))?/);
  let offsetMinutes = 0;
  if (match) {
    const hours = parseInt(match[1]!, 10);
    const mins = match[2] ? parseInt(match[2], 10) : 0;
    offsetMinutes = hours * 60 + (hours < 0 ? -mins : mins);
  }
  return new Date(Date.UTC(year, month - 1, day, hour, minute, 0) - offsetMinutes * 60 * 1000);
}

export function calculateNextSlot(
  policy: PolicyScheduleConfig,
  referenceDate: Date = new Date(),
): Date | null {
  if (policy.cadence === 'MANUAL' || !policy.localTime) {
    return null;
  }
  const tz = policy.timezone || RECONCILIATION_DEFAULT_TIMEZONE;
  const { hour, minute } = parseLocalTime(policy.localTime);
  const refParts = getZonedParts(referenceDate, tz);

  if (policy.cadence === 'DAILY') {
    const todaySlot = getZonedDate(refParts.year, refParts.month, refParts.day, hour, minute, tz);
    if (todaySlot.getTime() > referenceDate.getTime()) {
      return todaySlot;
    }
    // Tomorrow
    const tomorrowRef = new Date(todaySlot.getTime() + 24 * 3600 * 1000);
    const tomParts = getZonedParts(tomorrowRef, tz);
    return getZonedDate(tomParts.year, tomParts.month, tomParts.day, hour, minute, tz);
  }

  if (policy.cadence === 'WEEKLY') {
    const targetWeekday = policy.weekday;
    if (!targetWeekday || targetWeekday < 1 || targetWeekday > 7) {
      throw new Error(`WEEKLY_POLICY_REQUIRES_WEEKDAY: weekday must be 1 (Mon) to 7 (Sun)`);
    }

    for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
      const candidateDate = new Date(referenceDate.getTime() + dayOffset * 24 * 3600 * 1000);
      const candParts = getZonedParts(candidateDate, tz);
      if (candParts.weekday === targetWeekday) {
        const slot = getZonedDate(candParts.year, candParts.month, candParts.day, hour, minute, tz);
        if (slot.getTime() > referenceDate.getTime()) {
          return slot;
        }
      }
    }
    // Fallback if slot on same day was already passed
    const nextWeekDate = new Date(referenceDate.getTime() + 7 * 24 * 3600 * 1000);
    const nwParts = getZonedParts(nextWeekDate, tz);
    return getZonedDate(nwParts.year, nwParts.month, nwParts.day, hour, minute, tz);
  }

  return null;
}

export function countMissedSlots(
  policy: PolicyScheduleConfig,
  lastScheduledSlot: Date,
  now: Date,
): number {
  if (now.getTime() <= lastScheduledSlot.getTime()) {
    return 0;
  }
  let cursor = lastScheduledSlot;
  let count = 0;
  // Safety cap to avoid runaway loop in tests or extreme downtime
  const maxScan = 100;
  while (count < maxScan) {
    const next = calculateNextSlot(policy, cursor);
    if (!next || next.getTime() > now.getTime()) {
      break;
    }
    count++;
    cursor = next;
  }
  return count;
}

export function deriveRunHealth(
  criticalFindings: number,
  errorFindings: number,
): 'HEALTHY' | 'UNHEALTHY' {
  return criticalFindings === 0 && errorFindings === 0 ? 'HEALTHY' : 'UNHEALTHY';
}

export function evaluateHealthAlert(input: {
  threshold: ReconciliationSeverityAlertThreshold;
  criticalFindings: number;
  errorFindings: number;
  warningFindings: number;
}): {
  shouldAlert: boolean;
  notificationType: ReconciliationNotificationType | null;
  severity: 'CRITICAL' | 'ERROR' | 'WARNING' | null;
} {
  if (input.threshold === 'NONE') {
    return { shouldAlert: false, notificationType: null, severity: null };
  }

  if (input.criticalFindings > 0) {
    return {
      shouldAlert: true,
      notificationType: 'RECONCILIATION_CRITICAL',
      severity: 'CRITICAL',
    };
  }

  if (input.errorFindings > 0 && (input.threshold === 'ERROR' || input.threshold === 'WARNING')) {
    return {
      shouldAlert: true,
      notificationType: 'RECONCILIATION_ERROR',
      severity: 'ERROR',
    };
  }

  if (input.warningFindings > 0 && input.threshold === 'WARNING') {
    return {
      shouldAlert: true,
      notificationType: 'RECONCILIATION_WARNING',
      severity: 'WARNING',
    };
  }

  return { shouldAlert: false, notificationType: null, severity: null };
}

export function isComparableScope(
  scopeA: Record<string, unknown> | null | undefined,
  scopeB: Record<string, unknown> | null | undefined,
): boolean {
  if (!scopeA || !scopeB) return scopeA === scopeB;
  const kindA = scopeA.kind ?? 'GLOBAL';
  const kindB = scopeB.kind ?? 'GLOBAL';
  if (kindA !== kindB) return false;

  const ppA = scopeA.planningPeriodId ?? null;
  const ppB = scopeB.planningPeriodId ?? null;
  if (ppA !== ppB) return false;

  const dpA = scopeA.dispensingPointId ?? null;
  const dpB = scopeB.dispensingPointId ?? null;
  if (dpA !== dpB) return false;

  const ccA = scopeA.commercialCode ?? null;
  const ccB = scopeB.commercialCode ?? null;
  if (ccA !== ccB) return false;

  const domsA = Array.isArray(scopeA.domains)
    ? (scopeA.domains as unknown[]).slice().sort().join(',')
    : '';
  const domsB = Array.isArray(scopeB.domains)
    ? (scopeB.domains as unknown[]).slice().sort().join(',')
    : '';
  if (domsA !== domsB) return false;

  return true;
}

export function shouldEmitRecovery(
  policy: { notifyOnRecovery: boolean },
  previousRun: {
    criticalFindings: number;
    errorFindings: number;
    scope: Record<string, unknown> | null | undefined;
  } | null,
  currentRun: {
    criticalFindings: number;
    errorFindings: number;
    scope: Record<string, unknown> | null | undefined;
  },
): boolean {
  if (!policy.notifyOnRecovery) return false;
  if (!previousRun) return false;
  if (!isComparableScope(previousRun.scope, currentRun.scope)) return false;

  const previousHealthy = previousRun.criticalFindings === 0 && previousRun.errorFindings === 0;
  const currentHealthy = currentRun.criticalFindings === 0 && currentRun.errorFindings === 0;

  return !previousHealthy && currentHealthy;
}
