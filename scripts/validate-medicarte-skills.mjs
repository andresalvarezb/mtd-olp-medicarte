import { access, readFile } from 'node:fs/promises';

const skills = [
  'medicarte-flow-integrity',
  'medicarte-access-boundaries',
  'medicarte-schema-safety',
];

const requiredEvidence = [
  '.agent/adr/ADR-032-esp-008-inventory-ledger.md',
  '.agent/adr/ADR-038-esp-015-organization-point-access.md',
  'apps/api/src/fulfillments/authorization-fulfillment.repository.ts',
  'apps/api/src/receipts/receipt.repository.ts',
  'apps/api/src/identity/access.service.ts',
  'apps/api/src/common/point-scope.sql.ts',
  'packages/database/src/schema.ts',
  'packages/database/migrations/meta/_journal.json',
];

const failures = [];
for (const skill of skills) {
  const path = `.agent/skills/${skill}/SKILL.md`;
  try {
    const text = await readFile(path, 'utf8');
    if (
      !text.startsWith('---\n') ||
      !text.includes(`name: ${skill}\n`) ||
      !text.includes('description:')
    ) {
      failures.push(`${path}: frontmatter inválido`);
    }
    await access(`.agent/skills/${skill}/references/evidence.md`);
  } catch (error) {
    failures.push(`${path}: ${error.message}`);
  }
}

for (const path of requiredEvidence) {
  try {
    await access(path);
  } catch {
    failures.push(`${path}: evidencia inexistente`);
  }
}

const agents = await readFile('AGENTS.md', 'utf8').catch(() => '');
for (const skill of skills)
  if (!agents.includes(skill)) failures.push(`AGENTS.md no referencia ${skill}`);
if (!agents.includes('develop')) failures.push('AGENTS.md no declara develop como base');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(
  `OK: ${skills.length} skills Medicarte y ${requiredEvidence.length} rutas de evidencia verificadas`,
);
