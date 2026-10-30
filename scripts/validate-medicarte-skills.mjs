#!/usr/bin/env node
/** Static, read-only validator for Medicarte's repository-local Codex skills. */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const skills = [
  'medicarte-access-boundaries',
  'medicarte-flow-integrity',
  'medicarte-schema-safety',
];
const failures = [];
const posix = p => p.replaceAll('\\', '/');
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
    if (!fs.statSync(p).isFile() && !fs.statSync(p).isDirectory()) throw new Error('not a file or directory');
  } catch (error) {
    failures.push(`${relative}: ${error.message}`);
  }
}

for (const skill of skills) {
  const dir = `.agents/skills/${skill}`;
  const source = checkFile(`${dir}/SKILL.md`);
  const evidence = checkFile(`${dir}/references/evidence.md`);
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) failures.push(`${dir}/SKILL.md: falta frontmatter YAML`);
  else {
    const name = match[1].match(/^name:\s*(.*)$/m)?.[1]?.trim();
    const description = match[1].match(/^description:\s*(.*)$/m)?.[1]?.trim();
    if (name !== skill) failures.push(`${dir}: name debe coincidir con el directorio`);
    if (!description || description.length < 20) failures.push(`${dir}: description incompleta`);
  }
  if (!source.includes('references/evidence.md')) failures.push(`${dir}: SKILL.md no enlaza evidence.md`);
  for (const m of evidence.matchAll(/`((?:\.agent\/adr\/|apps\/|packages\/|docs\/|\.github\/)[^`\r\n]+)`/g)) {
    const candidate = posix(m[1]);
    if (candidate.includes('..')) failures.push(`${dir}: referencia insegura ${candidate}`);
    else checkEvidence(candidate);
  }
}
const rootInstructions = checkFile('AGENTS.md');
const guide = checkFile('docs/ai/medicarte-skills.md');
const workflow = checkFile('.github/workflows/medicarte-skills.yml');
for (const skill of skills) {
  if (!rootInstructions.includes(skill)) failures.push(`AGENTS.md no referencia ${skill}`);
  if (!guide.includes(skill)) failures.push(`docs/ai/medicarte-skills.md no referencia ${skill}`);
}
if (!rootInstructions.includes('develop')) failures.push('AGENTS.md no declara develop');
for (const [label, source] of [['AGENTS.md', rootInstructions], ['docs/ai/medicarte-skills.md', guide], ['.github/workflows/medicarte-skills.yml', workflow]]) {
  if (source.includes('.agent/skills')) failures.push(`${label} sigue usando ruta legacy .agent/skills`);
  if (!source.includes('.agents/skills')) failures.push(`${label} debe referirse a .agents/skills`);
}
const previous = path.join(root, '.agent', 'skills');
if (fs.existsSync(previous) && fs.readdirSync(previous).some(entry => skills.includes(entry))) {
  failures.push('Hay skills duplicadas en .agent/skills y .agents/skills');
}
if (!workflow.includes('branches: [develop]')) failures.push('El workflow de skills debe dirigirse a develop');
const ci = checkFile('.github/workflows/ci.yml');
const pushPart = ci.split(/\n\s*push\s*:/)[1]?.split(/\n\s*jobs\s*:/)[0] ?? '';
if (!pushPart.includes('develop')) failures.push('CI general no incluye pushes a develop');

if (failures.length) {
  console.error(failures.map(line => `ERROR ${line}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log(`OK: ${skills.length} skills Codex, evidencias y CI hacia develop comprobados de forma estática.`);
  console.log('Esto NO certifica activación real de Codex ni tests funcionales.');
}
