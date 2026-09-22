
export type DatabaseTimestamp =
  | Date
  | string;

export function toIsoTimestamp(
  value:
    DatabaseTimestamp,
): string {
  if (
    value instanceof Date
  ) {
    return value.toISOString();
  }

  const parsed =
    new Date(value);

  if (
    Number.isNaN(
      parsed.getTime(),
    )
  ) {
    throw new TypeError(
      `Invalid database timestamp: ${value}`,
    );
  }

  return parsed.toISOString();
}

export function toNullableIsoTimestamp(
  value:
    | DatabaseTimestamp
    | null
    | undefined,
): string | null {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  return toIsoTimestamp(
    value,
  );
}
