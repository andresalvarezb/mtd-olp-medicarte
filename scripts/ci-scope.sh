#!/usr/bin/env bash
# Classify a NUL-delimited git diff. Unknown paths require full CI.
set -euo pipefail

files=0
while IFS= read -r -d '' path; do
  files=$((files + 1))
  case "$path" in
    AGENTS.md|README.md|docs/*.md|.agents/skills/*/SKILL.md|.agents/skills/*/references/*.md|evals/medicarte-skills.cases.json|scripts/validate-medicarte-skills.mjs)
      ;;
    *)
      printf 'full=true\n'
      exit 0
      ;;
  esac
done

if (( files == 0 )); then
  printf 'full=true\n'
else
  printf 'full=false\n'
fi
