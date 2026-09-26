import {
  currentBogotaDate,
} from '@authorization/domain';

export const AUTHORIZATION_QUERY_HORIZON_DAYS =
  30;

function addCalendarDays(
  isoDate: string,
  days: number,
): string {
  const date =
    new Date(
      `${isoDate}T00:00:00.000Z`,
    );

  date.setUTCDate(
    date.getUTCDate()
    +
    days,
  );

  return date
    .toISOString()
    .slice(
      0,
      10,
    );
}

export function authorizationQueryValidityWindow(
  now: Date = new Date(),
) {
  const today =
    currentBogotaDate(
      now,
    );

  return {
    today,

    horizon:
      addCalendarDays(
        today,
        AUTHORIZATION_QUERY_HORIZON_DAYS,
      ),
  } as const;
}
