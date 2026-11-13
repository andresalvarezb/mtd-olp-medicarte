#!/usr/bin/env node
/** Static, read-only validator for Medicarte's repository-local Codex skills. */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const skills = [
  'drizzle-schema-safety',
  'exportables-contract-integrity',
  'financial-integrity',
  'local-test-environments',
  'patient-master-integrity',
  'production-data-safety',
  'purchase-fulfillment-integrity',
  'rbac-point-scope',
  'requirements-documentation',
  'requirements-implementation',
];
const evidenceSkills = new Set([
  'drizzle-schema-safety',
  'exportables-contract-integrity',
  'financial-integrity',
  'purchase-fulfillment-integrity',
  'rbac-point-scope',
]);
const retiredSkills = [
  'medicarte-access-boundaries',
  'medicarte-flow-integrity',
  'medicarte-schema-safety',
];
const failures = [];
const posix = (p) => p.replaceAll('\\', '/');
const skillRoot = path.join(root, '.agents/skills');
const actualSkills = fs.readdirSync(skillRoot, { withFileTypes: true });
for (const entry of actualSkills) {
  if (entry.isSymbolicLink() || !entry.isDirectory() || !skills.includes(entry.name))
    failures.push(`Skill inesperada o insegura en .agents/skills: ${entry.name}`);
}
for (const skill of skills) {
  if (!actualSkills.some((entry) => entry.name === skill && entry.isDirectory()))
    failures.push(`Falta directorio .agents/skills/${skill}`);
}
function checkFile(relative) {
  const p = path.join(root, relative);
  try {
    const stat = fs.lstatSync(p);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('not a regular file');
    return fs.readFileSync(p, 'utf8');
  } catch (error) {
    failures.push(`${relative}: ${error.message}`);
    return '';
  }
}
function checkEvidence(relative) {
  const p = path.join(root, relative);
  try {
    if (fs.lstatSync(p).isSymbolicLink()) throw new Error('symlink');
    if (!fs.statSync(p).isFile() && !fs.statSync(p).isDirectory())
      throw new Error('not a file or directory');
  } catch (error) {
    failures.push(`${relative}: ${error.message}`);
  }
}

for (const skill of skills) {
  const dir = `.agents/skills/${skill}`;
  const source = checkFile(`${dir}/SKILL.md`);
  const evidence = evidenceSkills.has(skill) ? checkFile(`${dir}/references/evidence.md`) : '';
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) failures.push(`${dir}/SKILL.md: falta frontmatter YAML`);
  else {
    const name = match[1].match(/^name:\s*(.*)$/m)?.[1]?.trim();
    const description = match[1].match(/^description:\s*(.*)$/m)?.[1]?.trim();
    if (name !== skill) failures.push(`${dir}: name debe coincidir con el directorio`);
    if (!description || description.length < 20 || description.length > 500 || description.startsWith('"') !== description.endsWith('"'))
      failures.push(`${dir}: description inválida o incompleta`);
    if (match[1].split(/\r?\n/).some((line) => line.trim() && !/^(name|description):\s*.+$/.test(line)))
      failures.push(`${dir}: frontmatter con campo o sintaxis no admitidos`);
  }
  for (const link of source.matchAll(/\]\((references\/[^)]+\.md)\)|`(references\/[^`\r\n]+\.md)`/g)) {
    const relative = link[1] ?? link[2];
    if (relative.includes('..') || path.isAbsolute(relative)) failures.push(`${dir}: referencia insegura ${relative}`);
    else checkFile(`${dir}/${relative}`);
  }
  if (evidenceSkills.has(skill) && !source.includes('references/evidence.md'))
    failures.push(`${dir}: SKILL.md no enlaza evidence.md`);
  for (const m of evidence.matchAll(
    /`((?:\.agent\/adr\/|apps\/|packages\/|docs\/|\.github\/)[^`\r\n]+)`/g,
  )) {
    const candidate = posix(m[1]);
    if (candidate.includes('..')) failures.push(`${dir}: referencia insegura ${candidate}`);
    else checkEvidence(candidate);
  }
}
const rootInstructions = checkFile('AGENTS.md');
const guide = checkFile('docs/ai/medicarte-skills.md');
const evaluationGuide = checkFile('docs/ai/medicarte-skills-evaluation.md');
const workflow = checkFile('.github/workflows/medicarte-skills.yml');
for (const skill of skills) {
  if (!rootInstructions.includes(skill)) failures.push(`AGENTS.md no referencia ${skill}`);
  if (!guide.includes(skill))
    failures.push(`docs/ai/medicarte-skills.md no referencia ${skill}`);
}
if (!evaluationGuide.includes('diez skills') || !guide.includes('diez skills'))
  failures.push('Inventario documental no declara diez skills');
if (!rootInstructions.includes('develop')) failures.push('AGENTS.md no declara develop');
for (const [label, source] of [
  ['AGENTS.md', rootInstructions],
  ['docs/ai/medicarte-skills.md', guide],
  ['.github/workflows/medicarte-skills.yml', workflow],
]) {
  if (source.includes('.agent/skills'))
    failures.push(`${label} sigue usando ruta legacy .agent/skills`);
  if (!source.includes('.agents/skills')) failures.push(`${label} debe referirse a .agents/skills`);
}
const previous = path.join(root, '.agent', 'skills');
if (
  fs.existsSync(previous) &&
  fs.readdirSync(previous).some((entry) => [...skills, ...retiredSkills].includes(entry))
) {
  failures.push('Hay skills duplicadas en .agent/skills y .agents/skills');
}
for (const retired of retiredSkills) {
  const retiredPath = `.agents/skills/${retired}`;
  if (fs.existsSync(path.join(root, retiredPath)))
    failures.push(`Ruta retirada todavía presente: ${retiredPath}`);
  for (const [label, source] of [
    ['AGENTS.md', rootInstructions],
    ['docs/ai/medicarte-skills.md', guide],
    ['evals/medicarte-skills.cases.json', checkFile('evals/medicarte-skills.cases.json')],
  ]) {
    if (source.includes(retired)) failures.push(`${label} sigue referenciando ${retired}`);
  }
}
if (!workflow.includes('branches: [develop]'))
  failures.push('El workflow de skills debe dirigirse a develop');
for (const requiredPath of [
  'evals/medicarte-skills.cases.json',
  'docs/ai/medicarte-skills-evaluation.md',
]) {
  if (!workflow.includes(requiredPath))
    failures.push(`El workflow de skills no observa ${requiredPath}`);
}
const ci = checkFile('.github/workflows/ci.yml');
const pushPart = ci.split(/\n\s*push\s*:/)[1]?.split(/\n\s*jobs\s*:/)[0] ?? '';
if (!pushPart.includes('develop')) failures.push('CI general no incluye pushes a develop');

const evalSource = checkFile('evals/medicarte-skills.cases.json');
let evaluation;
try {
  evaluation = JSON.parse(evalSource);
} catch (error) {
  failures.push(`evals/medicarte-skills.cases.json: JSON invalido: ${error.message}`);
}
if (evaluation) {
  const cases = Array.isArray(evaluation.cases) ? evaluation.cases : [];
  const ids = new Set();
  const categories = new Set();
  const positiveCoverage = new Set();
  const combinedCoverage = new Set();
  let negativeCount = 0;
  for (const item of cases) {
    if (!item?.id || ids.has(item.id))
      failures.push(`Caso de evaluacion sin id unico: ${item?.id ?? '<vacio>'}`);
    ids.add(item?.id);
    categories.add(item?.category);
    if (item?.category === 'negative') negativeCount++;
    if (!Array.isArray(item?.expectedSkills))
      failures.push(`${item?.id}: expectedSkills debe ser una lista`);
    else {
      for (const expected of item.expectedSkills) {
        if (!skills.includes(expected)) failures.push(`${item.id}: skill desconocida ${expected}`);
        if (item.category === 'positive') positiveCoverage.add(expected);
        if (item.category === 'combined') combinedCoverage.add(expected);
      }
      if (item.shouldTrigger !== item.expectedSkills.length > 0)
        failures.push(`${item.id}: shouldTrigger no coincide con expectedSkills`);
    }
    if (!item?.prompt || !Array.isArray(item?.criteria) || !item.criteria.length)
      failures.push(`${item?.id}: prompt o criteria incompletos`);
    if (item?.category === 'ambiguous' && item?.expectedBehavior !== 'ask_clarification')
      failures.push(`${item.id}: el caso ambiguo debe pedir aclaracion`);
  }
  for (const category of ['positive', 'negative', 'ambiguous', 'combined']) {
    if (!categories.has(category)) failures.push(`Falta cobertura de evaluacion ${category}`);
  }
  for (const skill of skills) {
    if (!positiveCoverage.has(skill)) failures.push(`Falta caso positivo para ${skill}`);
  }
  if (negativeCount < 3) failures.push('Faltan controles negativos variados');
  for (const skill of ['exportables-contract-integrity', 'rbac-point-scope', 'financial-integrity', 'production-data-safety']) {
    if (!combinedCoverage.has(skill)) failures.push(`Falta caso combinado para ${skill}`);
  }
}

if (failures.length) {
  console.error(failures.map((line) => `ERROR ${line}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log(
    `OK: ${skills.length} skills Codex, evidencias, matriz de evaluación y CI hacia develop comprobados de forma estática.`,
  );
  console.log('Esto NO certifica activación real de Codex ni tests funcionales.');
}
