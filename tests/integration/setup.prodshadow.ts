const databaseUrl =
  process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    'Operational E2E tests require DATABASE_URL',
  );
}

const parsed =
  new URL(databaseUrl);

const databaseName =
  decodeURIComponent(
    parsed.pathname.replace(
      /^\//,
      '',
    ),
  );

if (
  !/^authorization_e2e_\d{14}$/.test(
    databaseName,
  )
) {
  throw new Error(
    `SAFETY_STOP: operational E2E requires authorization_e2e_<RUN_ID>; received ${databaseName}`,
  );
}
