#!/bin/sh

test_status=0
cleanup_status=0

cleanup() {
  trap - EXIT INT TERM
  pnpm run db:cleanup:test-data || cleanup_status=$?
  if [ "$test_status" -ne 0 ]; then
    exit "$test_status"
  fi
  exit "$cleanup_status"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

export TEST_RUN_STARTED_AT="$(date -u '+%Y-%m-%dT%H:%M:%S.%3NZ')"
pnpm run test:integration:run || test_status=$?
exit "$test_status"
