import { currentBogotaDate } from '@authorization/domain';

export const todayBogota = currentBogotaDate();

export function offsetBogotaDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year!, month! - 1, day! + days));
  return shifted.toISOString().slice(0, 10);
}
