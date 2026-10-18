#!/usr/bin/env node
/**
 * Catálogo estructural de PostgreSQL a partir del modelo Drizzle.
 * Fuente: packages/database/src/schema.ts. No ejecuta SQL ni consulta pacientes.
 *
 * Uso:
 *   node scripts/db-schema-catalog.mjs --generate
 *   node scripts/db-schema-catalog.mjs --check
 *   node scripts/db-schema-catalog.mjs --table purchase_orders
 *   node scripts/db-schema-catalog.mjs --search purchase
 *   node scripts/db-schema-catalog.mjs --module compras
 *   node scripts/db-schema-catalog.mjs --compare-live # DATABASE_URL explícita
 */

import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const sourcePath = path.join(repo, 'packages/database/src/schema.ts');
const docsRoot = path.join(repo, 'docs/base-de-datos');

// Canoniza texto antes de calcular huellas y comparar artefactos.
// Git Bash/Windows suele leer CRLF; GitHub Actions/Linux lee LF.
export const normalizeLineEndings = text => text.replace(/\r\n?/g, '\n');
export const schemaSourceHash = text => createHash('sha256')
  .update(normalizeLineEndings(text), 'utf8').digest('hex');

const GROUPS = Object.freeze([
  ['identidad', 'Identidad, permisos y organizaciones'],
  ['autorizaciones', 'Autorizaciones y MIPRES'],
  ['planeacion', 'Planeación, programación y demanda'],
  ['compras', 'Órdenes de compra y entregas OLP'],
  ['recepciones', 'Recepciones MEDICARTE'],
  ['inventario', 'Inventario, ubicaciones, reservas y traslados'],
  ['atencion', 'Atención, dispensación y resultados'],
  ['tarifas', 'Anexo tarifario y productos'],
  ['auditoria', 'Auditoría y novedades'],
  ['conciliacion', 'Conciliación operacional'],
  ['cargas', 'Cargas masivas, jobs y eventos técnicos'],
  ['otros', 'Otros objetos'],
]);

const TABLE_GROUPS = Object.freeze({
  identidad: ['organizations', 'users', 'roles', 'role_organization_scopes',
    'permissions', 'role_permissions', 'user_organization_roles', 'user_point_scopes'],
  autorizaciones: ['authorization_items', 'authorization_mipres_decision_history',
    'coverage_evaluations', 'mipres_checks', 'mipres_directions',
    'mipres_manual_decision_concepts', 'authorization_item_organizations'],
  planeacion: ['planning_periods', 'patient_schedules', 'patient_schedule_history',
    'projected_demand_lines', 'demand_sources', 'patient_schedule_imports',
    'patient_schedule_import_source_files', 'patient_schedule_import_rows'],
  compras: ['purchase_orders', 'purchase_order_lines', 'purchase_order_demand_allocations',
    'purchase_order_authorization_sources', 'deliveries', 'delivery_lines'],
  recepciones: ['receipts', 'receipt_lines', 'purchase_order_receipts', 'purchase_order_receipt_lines'],
  inventario: ['dispensing_points', 'inventory_locations', 'inventory_lots',
    'inventory_movements', 'stock_transfers', 'stock_transfer_lines',
    'inventory_allocation_batches', 'inventory_allocation_import_rows',
    'inventory_authorization_allocations', 'product_delivery_point_mappings',
    'patient_default_dispensing_points'],
  atencion: ['patient_applications', 'patient_application_lines',
    'patient_schedule_outcomes', 'patient_schedule_outcome_lines',
    'authorization_dispensations', 'authorization_fulfillments',
    'authorization_fulfillment_lines'],
  tarifas: ['tariff_annex_products', 'tariff_annex_imports',
    'tariff_annex_import_source_files', 'tariff_annex_import_rows',
    'tariff_product_revisions', 'authorization_tariff_snapshots'],
  auditoria: ['audit_events', 'audit_reviews', 'audit_findings',
    'authorization_billing_audits', 'authorization_billing_audit_evidence',
    'patient_application_audits', 'operational_field_changes', 'novelty_codes',
    'novelties'],
  conciliacion: ['reconciliation_runs', 'reconciliation_findings',
    'reconciliation_issues', 'reconciliation_issue_events',
    'reconciliation_issue_comments', 'reconciliation_operation_policies',
    'reconciliation_operation_executions', 'reconciliation_notifications'],
  cargas: ['import_batches', 'import_source_files', 'import_rows',
    'validation_errors', 'bulk_update_batches', 'bulk_update_source_files',
    'bulk_update_rows', 'bulk_import_jobs', 'bulk_import_rows',
    'bulk_import_row_attempts', 'outbox_events', 'idempotency_records',
    'job_results'],
});
const GROUP_OF = new Map(Object.entries(TABLE_GROUPS).flatMap(([g, arr]) => arr.map(t => [t, g])));

function syntax() {
  try { return require('typescript'); }
  catch {
    throw new Error('No se encontró TypeScript. Ejecuta pnpm install --frozen-lockfile desde la raíz.');
  }
}

function unwrapped(node, ts) {
  let n = node;
  while (n && (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isSatisfiesExpression(n))) n = n.expression;
  return n;
}
function propName(node, ts) {
  if (!node) return null;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  return null;
}
function callName(call, ts) {
  const callee = unwrapped(call.expression, ts);
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return null;
}
function methodCalls(node, ts) {
  const calls = [];
  let n = unwrapped(node, ts);
  while (ts.isCallExpression(n)) {
    calls.push(n);
    const callee = unwrapped(n.expression, ts);
    if (ts.isPropertyAccessExpression(callee)) n = unwrapped(callee.expression, ts);
    else break;
  }
  return calls;
}
function objectField(object, name, ts) {
  if (!object || !ts.isObjectLiteralExpression(object)) return null;
  for (const field of object.properties) {
    if (ts.isPropertyAssignment(field) && propName(field.name, ts) === name) return field.initializer;
  }
  return null;
}
function plainField(init, source, ts) {
  const calls = methodCalls(init, ts);
  const base = calls[calls.length - 1];
  if (!base) return null;
  const columnName = base.arguments?.[0];
  if (!columnName || !ts.isStringLiteralLike(columnName)) return null;
  const dataType = callName(base, ts) || 'custom';
  let printedType = dataType;
  if (['varchar', 'numeric'].includes(dataType)) {
    const spec = base.arguments[1];
    const len = objectField(spec, 'length', ts);
    const precision = objectField(spec, 'precision', ts);
    const scale = objectField(spec, 'scale', ts);
    if (len?.text) printedType += `(${len.text})`;
    else if (precision?.text) printedType += `(${precision.text}${scale?.text ? `,${scale.text}` : ''})`;
  }
  const notNull = calls.some(x => callName(x, ts) === 'notNull');
  const primaryKey = calls.some(x => callName(x, ts) === 'primaryKey');
  const defaultCall = calls.find(x => ['default', 'defaultNow', 'defaultRandom'].includes(callName(x, ts)));
  let defaultValue = null;
  if (defaultCall) {
    if (defaultCall.arguments.length) defaultValue = defaultCall.arguments.map(x => x.getText(source)).join(', ').slice(0, 130);
    else defaultValue = callName(defaultCall, ts) + '()';
  }
  const refCalls = calls.filter(x => callName(x, ts) === 'references');
  const refTargets = [];
  for (const r of refCalls) {
    let callback = unwrapped(r.arguments[0], ts);
    if (!callback || !ts.isArrowFunction(callback)) continue;
    let target = unwrapped(callback.body, ts);
    if (ts.isBlock(target)) {
      const stmt = target.statements.find(x => ts.isReturnStatement(x));
      target = stmt?.expression;
    }
    if (target && ts.isPropertyAccessExpression(target) && ts.isIdentifier(target.expression)) {
      refTargets.push({ targetVar: target.expression.text, targetProp: target.name.text });
    }
  }
  return { name: columnName.text, type: printedType, nullable: !notNull && !primaryKey,
    pk: primaryKey, default: defaultValue, refs: refTargets };
}

export function parseDrizzleSchema(contents) {
  const ts = syntax();
  const src = ts.createSourceFile('schema.ts', contents, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const diagnostics = src.parseDiagnostics;
  if (diagnostics?.length) throw new Error(`TypeScript inválido: ${diagnostics[0].messageText}`);
  const entries = [];
  const byVar = new Map();
  for (const statement of src.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const init = unwrapped(declaration.initializer, ts);
      if (!init || !ts.isCallExpression(init) || callName(init, ts) !== 'pgTable') continue;
      const varName = propName(declaration.name, ts);
      const rawTableName = init.arguments[0];
      const name = rawTableName && ts.isStringLiteralLike(rawTableName) ? rawTableName.text : null;
      if (!varName || !name) continue;
      const columns = [];
      const props = unwrapped(init.arguments[1], ts);
      if (!props || !ts.isObjectLiteralExpression(props)) continue;
      for (const p of props.properties) {
        if (!ts.isPropertyAssignment(p)) continue;
        const property = propName(p.name, ts);
        const value = plainField(p.initializer, src, ts);
        if (property && value) columns.push({ property, ...value });
      }
      const table = { name, variable: varName, group: GROUP_OF.get(name) ?? 'otros',
        columns, fks: [], indexes: [], checks: [], primaryKeys: [] };
      entries.push({ table, extra: init.arguments[2] });
      byVar.set(varName, table);
    }
  }
  const result = entries.map(e => e.table);
  const mapped = new Map(result.map(t => [t.variable, t]));
  for (const { table, extra } of entries) {
    // Inline references: columnas que contienen .references(() => anotherTable.field).
    for (const column of table.columns) {
      if (column.pk) table.primaryKeys.push(column.name);
      for (const target of column.refs) {
        const targetTable = mapped.get(target.targetVar);
        const targetColumn = targetTable?.columns.find(x => x.property === target.targetProp);
        if (targetTable && targetColumn) table.fks.push({ columns: [column.name], to: targetTable.name,
          toColumns: [targetColumn.name], source: 'references' });
      }
      delete column.refs;
    }
    if (!extra) continue;
    // Componentes declarados en el tercer argumento de pgTable.
    const calls = [];
    const visit = n => {
      if (ts.isCallExpression(n)) calls.push(n);
      ts.forEachChild(n, visit);
    };
    visit(extra);
    for (const c of calls) {
      const method = callName(c, ts);
      if (method === 'check') {
        const title = c.arguments[0];
        if (title && ts.isStringLiteralLike(title)) table.checks.push(title.text);
      }
      if (method === 'index' || method === 'uniqueIndex' || method === 'unique') {
        const title = c.arguments[0];
        if (title && ts.isStringLiteralLike(title)) table.indexes.push({ name: title.text, kind: method });
      }
      if (method === 'primaryKey') {
        const list = objectField(c.arguments[0], 'columns', ts);
        if (list && ts.isArrayLiteralExpression(list)) {
          for (const a of list.elements) {
            if (ts.isPropertyAccessExpression(a) && ts.isIdentifier(a.expression) && a.expression.text === 'table') {
              const prop = a.name.text;
              const col = table.columns.find(x => x.property === prop);
              if (col && !table.primaryKeys.includes(col.name)) table.primaryKeys.push(col.name);
            }
          }
        }
      }
      if (method === 'foreignKey') {
        const cols = objectField(c.arguments[0], 'columns', ts);
        const foreignCols = objectField(c.arguments[0], 'foreignColumns', ts);
        if (!cols || !foreignCols || !ts.isArrayLiteralExpression(cols) || !ts.isArrayLiteralExpression(foreignCols)) continue;
        const own = cols.elements.map(x => {
          if (!ts.isPropertyAccessExpression(x)) return null;
          return table.columns.find(c => c.property === x.name.text)?.name ?? null;
        });
        const refs = foreignCols.elements.map(x => {
          if (!ts.isPropertyAccessExpression(x) || !ts.isIdentifier(x.expression)) return null;
          const t = mapped.get(x.expression.text);
          const c = t?.columns.find(c => c.property === x.name.text);
          return t && c ? { table: t.name, col: c.name } : null;
        });
        if (own.length && own.every(Boolean) && refs.every(Boolean) && new Set(refs.map(x=>x.table)).size===1) {
          table.fks.push({ columns: own, to: refs[0].table, toColumns: refs.map(x=>x.col), source: 'foreignKey' });
        }
      }
    }
  }
  result.sort((a,b)=>a.name.localeCompare(b.name));
  return result;
}

const safeCell = x => String(x ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').replace(/`/g, "'");
const groupLabel = id => GROUPS.find(([k])=>k===id)?.[1] ?? id;
const md = arr => arr.join('\n').replace(/\n+$/, '')+'\n';
const fmtCols = x => x.join(', ');
const fkText = fk => `${fmtCols(fk.columns)} → ${fk.to}(${fmtCols(fk.toColumns)})`;

function renderCatalog(tables, sourceHash) {
  const lines = [
    '# Catálogo estructural de la base de datos — generado', '',
    '> **Origen:** `packages/database/src/schema.ts` (Drizzle). **No demuestra que las migraciones estén aplicadas a un PostgreSQL concreto.**',
    `> **Identificador de fuente SHA-256:** \`${sourceHash}\`. Generador: \`scripts/db-schema-catalog.mjs\`.`, '',
    `**Tablas Drizzle:** ${tables.length}. **Columnas:** ${tables.reduce((a,t)=>a+t.columns.length,0)}. **Referencias FK declaradas:** ${tables.reduce((a,t)=>a+t.fks.length,0)}.`, '',
    '## Índice por proceso', '',
    '| Proceso | Tablas |', '| --- | ---: |',
  ];
  for (const [g,label] of GROUPS) {
    const count=tables.filter(t=>t.group===g).length;
    if (count) lines.push(`| ${label} | ${count} |`);
  }
  lines.push('', '## Diccionario de tablas', '');
  const incoming = new Map(tables.map(t=>[t.name,[]]));
  for (const table of tables) for (const fk of table.fks) incoming.get(fk.to)?.push(`${table.name}(${fmtCols(fk.columns)})`);
  for (const [g,label] of GROUPS) {
    const list=tables.filter(t=>t.group===g);
    if (!list.length) continue;
    lines.push(`### ${label}`, '');
    for (const table of list) {
      lines.push(`#### \`${table.name}\``, '',
        `**Columnas:** ${table.columns.length} · **Clave primaria:** ${table.primaryKeys.length?fmtCols(table.primaryKeys):'sin PK declarada en Drizzle'} · **FK:** ${table.fks.length}.`, '',
        '| Columna SQL | Tipo Drizzle | ¿Permite NULL? | Restricción / default |',
        '| --- | --- | --- | --- |');
      for (const col of table.columns) {
        const flags=[];
        if (table.primaryKeys.includes(col.name)) flags.push('PK');
        const foreigns=table.fks.filter(fk=>fk.columns.includes(col.name));
        if (foreigns.length) flags.push(...foreigns.map(fk=>`FK ${fk.to}`));
        if (col.default !== null) flags.push(`default: ${col.default}`);
        lines.push(`| \`${safeCell(col.name)}\` | ${safeCell(col.type)} | ${col.nullable?'Sí':'No'} | ${safeCell(flags.join('; '))} |`);
      }
      lines.push('');
      if (table.fks.length) lines.push('**Claves foráneas:** '+table.fks.map(fk=>`\`${fkText(fk)}\``).join('; ')+'.', '');
      const inbound=incoming.get(table.name)||[];
      if (inbound.length) lines.push('**Referenciada por:** '+[...new Set(inbound)].map(x=>`\`${x}\``).join('; ')+'.', '');
      if (table.indexes.length) lines.push('**Índices / unicidad declarados:** '+table.indexes.map(i=>`\`${i.name}\` (${i.kind})`).join('; ')+'.', '');
      if (table.checks.length) lines.push('**Checks declarados:** '+table.checks.map(x=>`\`${x}\``).join('; ')+'.', '');
    }
  }
  lines.push('---','','**Interpretación:** una FK refleja únicamente relaciones declaradas en Drizzle; no prueba reglas de negocio, relaciones lógicas sin FK, cardinalidades reales, permisos ni consistencia de un entorno desplegado. Consulta siempre los servicios/repositorios y las migraciones pertinentes.','');
  return md(lines);
}
function entityName(s) { return s.replace(/[^A-Za-z0-9_]/g,'_'); }
function renderMermaid(tables, group) {
  const selected=tables.filter(t=>t.group===group);
  const names=new Set(selected.map(t=>t.name));
  const lines=['erDiagram'];
  if (!selected.length) return 'erDiagram\n';
  // Por legibilidad: cada diagrama solo muestra tablas del mismo dominio.
  for (const t of selected) {
    lines.push(`  ${entityName(t.name)} {`);
    for (const c of t.columns.filter(c=>t.primaryKeys.includes(c.name)||t.fks.some(fk=>fk.columns.includes(c.name)))) {
      const typ=c.type.replace(/[^A-Za-z0-9_]/g,'_');
      const markers=[t.primaryKeys.includes(c.name)?'PK':'',t.fks.some(fk=>fk.columns.includes(c.name))?'FK':''].filter(Boolean).join(',');
      lines.push(`    ${typ} ${entityName(c.name)}${markers?' '+markers:''}`);
    }
    // Mermaid permite entidades con 1 campo mínimo; tabla sin FK/PK visible -> marker.
    if (!t.columns.some(c=>t.primaryKeys.includes(c.name)||t.fks.some(fk=>fk.columns.includes(c.name)))) {
      lines.push('    string _sin_claves_declaradas');
    }
    lines.push('  }');
  }
  for (const t of selected) {
    for (const fk of t.fks.filter(f=>names.has(f.to))) {
      const label=fk.columns.join('_').replace(/[^A-Za-z0-9_]/g,'_').slice(0,65);
      lines.push(`  ${entityName(fk.to)} ||--o{ ${entityName(t.name)} : "${label}"`);
    }
  }
  lines.push('  %% Relaciones entre dominios: consultar schema-index.json / catálogo generado.');
  return md(lines);
}
function renderIndex(tables, sourceHash) {
  return JSON.stringify({
    schemaVersion:1, source:'packages/database/src/schema.ts',sourceSha256:sourceHash,
    kind:'drizzle-static', notLiveDatabase:true,
    groupLabels:Object.fromEntries(GROUPS),
    tables:tables.map(t=>({ name:t.name, variable:t.variable, group:t.group,
      pk:t.primaryKeys, columns:t.columns.map(c=>({name:c.name,type:c.type,nullable:c.nullable,pk:t.primaryKeys.includes(c.name),default:c.default})),
      fks:t.fks, indexes:t.indexes, checks:t.checks })),
  }, null, 2)+'\n';
}
function contentFiles(tables, hash) {
  const map=new Map([
    ['catalogo-generado.md',renderCatalog(tables,hash)],
    ['schema-index.json',renderIndex(tables,hash)],
  ]);
  for(const [group] of GROUPS) {
    if(tables.some(t=>t.group===group)) map.set(`diagramas/${group}.mmd`,renderMermaid(tables,group));
  }
  return map;
}
function writeFiles(files, check) {
  let mismatches=0;
  for(const [rel,content] of files){
    const full=path.join(docsRoot,rel);
    if(check){
      if (!fs.existsSync(full) ||
          normalizeLineEndings(fs.readFileSync(full, 'utf8')) !== normalizeLineEndings(content)) {
        console.error(`DESACTUALIZADO: ${path.relative(repo,full)}`); mismatches++;
      }
    } else {
      fs.mkdirSync(path.dirname(full),{recursive:true});
      if(!fs.existsSync(full)||fs.readFileSync(full,'utf8')!==content) fs.writeFileSync(full,content,'utf8');
      console.log(`GENERADO: ${path.relative(repo,full)}`);
    }
  }
  if(check&&mismatches) throw new Error(`El catálogo presenta ${mismatches} archivos faltantes/desactualizados; ejecuta --generate.`);
  if(check)console.log(`SCHEMA_CATALOG_CHECK=OK; archivos=${files.size}`);
}
function printTable(tables,name){
  const t=tables.find(x=>x.name===name||x.variable===name);
  if(!t){ console.error(`No existe tabla Drizzle: ${name}`);process.exitCode=2;return; }
  console.log(`TABLA: ${t.name} · ${groupLabel(t.group)}`);
  console.log(`PK: ${fmtCols(t.primaryKeys)||'no declarada'} · ${t.columns.length} columnas`);
  for(const c of t.columns){
    const fk=t.fks.filter(x=>x.columns.includes(c.name)).map(fk=>fkText(fk));
    console.log(`  ${c.name.padEnd(37)} ${c.type.padEnd(16)} ${c.nullable?'NULL':'NOT NULL'}${t.primaryKeys.includes(c.name)?' PK':''}${fk.length?' → '+fk.join('; '):''}`);
  }
  console.log('FK salientes:'); for(const fk of t.fks)console.log('  '+fkText(fk));
  console.log('FK entrantes:'); for(const source of tables)for(const fk of source.fks.filter(f=>f.to===t.name))console.log(`  ${source.name}(${fmtCols(fk.columns)}) → ${t.name}(${fmtCols(fk.toColumns)})`);
  console.log('Checks: '+(t.checks.join(', ')||'ninguno en Drizzle'));
}
async function compareLive(tables){
  if(!process.env.DATABASE_URL){ console.error('ERROR: DATABASE_URL no configurada; no se lee .env automáticamente.');process.exitCode=2;return; }
  let pg;
  try{pg=await import('pg');}catch{throw new Error('No existe el paquete pg; ejecuta pnpm install --frozen-lockfile.');}
  const client=new pg.default.Client({connectionString:process.env.DATABASE_URL,
    application_name:'mtd_db_schema_readonly_inspector', statement_timeout:15000});
  let began=false;
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');began=true;
    const res=await client.query(`
      SELECT table_name,column_name,data_type,is_nullable
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name IN (
          SELECT table_name FROM information_schema.tables
          WHERE table_schema=current_schema() AND table_type='BASE TABLE'
        )
      ORDER BY table_name,ordinal_position`);
    const live=new Map();
    for(const r of res.rows){const cols=live.get(r.table_name)||new Set();cols.add(r.column_name);live.set(r.table_name,cols);}
    const missingTables=[],missingColumns=[],extraTables=[];
    for(const t of tables){
      if(!live.has(t.name)){missingTables.push(t.name);continue;}
      for(const c of t.columns)if(!live.get(t.name).has(c.name))missingColumns.push(`${t.name}.${c.name}`);
    }
    const known=new Set(tables.map(t=>t.name));
    for(const table of live.keys())if(!known.has(table))extraTables.push(table);
    console.log(`CONSULTA_SÓLO_LECTURA=OK; tablas_Drizzle=${tables.length}; tablas_en_BD=${live.size}`);
    console.log(`TABLAS_ESPERADAS_AUSENTES (${missingTables.length}): ${missingTables.join(', ')||'-'}`);
    console.log(`COLUMNAS_ESPERADAS_AUSENTES (${missingColumns.length}): ${missingColumns.join(', ')||'-'}`);
    console.log(`TABLAS_ADICIONALES_EN_BD (${extraTables.length}): ${extraTables.join(', ')||'-'}`);
    console.log('Esta comprobación no acredita equivalencia de tipos, checks, FKs, índices, políticas RLS ni migraciones.');
    if(missingTables.length||missingColumns.length)process.exitCode=2;
  }finally{
    if(began){try{await client.query('ROLLBACK');}catch{/* no mutation */}}
    await client.end().catch(()=>{});
  }
}

export async function main(argv=process.argv.slice(2)) {
  const source=normalizeLineEndings(fs.readFileSync(sourcePath,'utf8'));
  const hash=schemaSourceHash(source);
  const tables=parseDrizzleSchema(source);
  if(!tables.length)throw new Error('No se encontraron llamadas pgTable en packages/database/src/schema.ts');
  if(argv.includes('--generate'))return writeFiles(contentFiles(tables,hash),false);
  if(argv.includes('--check'))return writeFiles(contentFiles(tables,hash),true);
  const tableIdx=argv.indexOf('--table');
  if(tableIdx>=0)return printTable(tables,argv[tableIdx+1]);
  const searchIdx=argv.indexOf('--search');
  if(searchIdx>=0){
    const q=argv[searchIdx+1]?.toLowerCase();if(!q)throw new Error('Falta término --search');
    for(const t of tables){const cols=t.columns.filter(c=>c.name.toLowerCase().includes(q));
      if(t.name.toLowerCase().includes(q)||cols.length)console.log(`${t.name.padEnd(48)} ${t.group.padEnd(18)} ${cols.map(c=>c.name).slice(0,8).join(', ')}`);
    }return;
  }
  const moduleIdx=argv.indexOf('--module');
  if(moduleIdx>=0){
    const group=argv[moduleIdx+1];if(!GROUPS.some(([g])=>g===group))throw new Error('Grupo desconocido. Opciones: '+GROUPS.map(([g])=>g).join(', '));
    for(const t of tables.filter(t=>t.group===group))console.log(`${t.name.padEnd(50)} ${t.columns.length} columnas; ${t.fks.length} FK`);
    return;
  }
  if(argv.includes('--compare-live'))return compareLive(tables);
  console.log('Total tablas Drizzle:',tables.length,'; referencias FK:',tables.reduce((a,t)=>a+t.fks.length,0));
  console.log('Uso: --generate | --check | --table NOMBRE | --search TEXTO | --module GRUPO | --compare-live');
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(err=>{console.error(`SCHEMA_CATALOG_ERROR: ${err.message}`);process.exitCode=1;});
}
