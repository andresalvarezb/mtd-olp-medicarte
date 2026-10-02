import {
  evaluateAuthorizationOperationalWindow,
  evaluateScheduleAuthorizationEligibility,
  parseAuthorizationExpiration,
  type MipresManualDecision,
} from '@authorization/domain';

export type PatientApplicationAuthorizationInput = Readonly<{
  enablementStatus: string;

  coverageType: string;

  directionStatus: string;

  mipresManualDecision?: MipresManualDecision | null;

  assignmentDate: string | null | undefined;

  expirationDate: string | null | undefined;

  todayBogota: string;

  applicationDate?: string | undefined;
}>;

export type PatientApplicationAuthorizationEligibility =
  | Readonly<{
      eligible: true;

      code: null;
    }>
  | Readonly<{
      eligible: false;

      code: string;
    }>;

export function evaluatePatientApplicationAuthorization(
  input: PatientApplicationAuthorizationInput,
): PatientApplicationAuthorizationEligibility {
  const expiration = parseAuthorizationExpiration(input.expirationDate);

  const clinicalEligibility = evaluateScheduleAuthorizationEligibility({
    enablementStatus: input.enablementStatus,

    coverageType: input.coverageType,

    directionStatus: input.directionStatus,

    ...(input.mipresManualDecision !== undefined
      ? {
          mipresManualDecision: input.mipresManualDecision,
        }
      : {}),

    expirationDate: expiration,

    todayBogota: input.todayBogota,
  });

  if (!clinicalEligibility.eligible) {
    return {
      eligible: false,

      code: clinicalEligibility.code ?? 'PATIENT_APPLICATION_AUTHORIZATION_NOT_ELIGIBLE',
    };
  }

  const operationalWindow = evaluateAuthorizationOperationalWindow({
    assignmentDate: input.assignmentDate,

    expirationDate: input.expirationDate,

    todayBogota: input.todayBogota,
  });

  if (!operationalWindow.eligible) {
    return {
      eligible: false,

      code: 'PATIENT_APPLICATION_AUTHORIZATION_NOT_ELIGIBLE',
    };
  }

  return {
    eligible: true,

    code: null,
  };
}
