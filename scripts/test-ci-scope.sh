#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

assert_scope() {
  local expected="$1" result
  shift
  result="$(printf '%s\0' "$@" | bash scripts/ci-scope.sh)"
  if [[ "$result" != "full=$expected" ]]; then
    printf 'Expected full=%s, got %s for: %s\n' "$expected" "$result" "$*" >&2
    exit 1
  fi
}

# Empty diffs are never classified as lightweight.
[[ "$(bash scripts/ci-scope.sh < /dev/null)" == 'full=true' ]]
assert_scope false AGENTS.md
assert_scope false README.md docs/ai/medicarte-skills.md
assert_scope false .agents/skills/rbac-point-scope/SKILL.md .agents/skills/rbac-point-scope/references/evidence.md
assert_scope false evals/medicarte-skills.cases.json scripts/validate-medicarte-skills.mjs
assert_scope true apps/api/src/main.ts
assert_scope true packages/database/src/schema.ts
assert_scope true pnpm-lock.yaml
assert_scope true .github/workflows/ci.yml
assert_scope true scripts/ci-scope.sh
assert_scope true .agents/skills/rbac-point-scope/scripts/unsafe.sh
assert_scope true docs/analysis.json
assert_scope true README.md apps/web/src/app.tsx
assert_scope true 'docs/space in filename.csv'
assert_scope true 'docs/weird'$'\n''name.ts'
printf 'CI scope classifier: all cases passed\n'
