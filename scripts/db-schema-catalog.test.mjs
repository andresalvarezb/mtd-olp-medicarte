import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDrizzleSchema, normalizeLineEndings, schemaSourceHash } from './db-schema-catalog.mjs';

const fixture = `
  import { pgTable, uuid, varchar, foreignKey, primaryKey, index, check, integer } from 'drizzle-orm/pg-core';
  export const orgs = pgTable('organizations', {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 100 }).notNull(),
  });
  export const people = pgTable('users', {
    id: uuid('id').primaryKey(),
    org: uuid('organization_id').notNull().references(() => orgs.id),
    name: varchar('name', { length: 160 }),
  });
  export const grants = pgTable('user_organization_roles', {
    userId: uuid('user_id').notNull().references(() => people.id),
    orgId: uuid('organization_id').notNull().references(() => orgs.id),
    version: integer('version').notNull().default(1),
  }, table => [
    primaryKey({name:'grant_pk', columns:[table.userId, table.orgId]}),
    index('grant_version_idx').on(table.version),
    check('grant_version_ck', sql\`\${table.version} > 0\`),
  ]);
  export const extra = pgTable('extra', {
    userId: uuid('user_id').notNull(),
    orgId: uuid('org_id').notNull(),
  }, table => [
    foreignKey({columns:[table.userId,table.orgId],foreignColumns:[grants.userId,grants.orgId]}),
  ]);
`;

test('detecta tablas y nombres SQL, no nombres TypeScript', () => {
  const tables = parseDrizzleSchema(fixture);
  assert.equal(tables.length, 4);
  assert.equal(tables.find(t => t.name === 'users').columns.find(c => c.name === 'organization_id').nullable, false);
  assert.equal(tables.find(t => t.name === 'users').columns.find(c => c.name === 'name').nullable, true);
});

test('obtiene PK compuesta, FK directa, índice y check', () => {
  const table = parseDrizzleSchema(fixture).find(t => t.name === 'user_organization_roles');
  assert.deepEqual(table.primaryKeys, ['user_id', 'organization_id']);
  assert.equal(table.fks.length, 2);
  assert.ok(table.fks.some(f => f.to === 'users' && f.columns[0] === 'user_id'));
  assert.ok(table.indexes.some(i => i.name === 'grant_version_idx'));
  assert.ok(table.checks.includes('grant_version_ck'));
});

test('obtiene FK compuesta desde foreignKey()', () => {
  const table = parseDrizzleSchema(fixture).find(t => t.name === 'extra');
  assert.equal(table.fks.length, 1);
  assert.deepEqual(table.fks[0].columns, ['user_id', 'org_id']);
  assert.deepEqual(table.fks[0].toColumns, ['user_id', 'organization_id']);
});

test('no retorna contenido de filas ni datos personales', () => {
  const r = parseDrizzleSchema(fixture);
  assert.equal(JSON.stringify(r).includes('SELECT '), false);
});

test('catálogo determinista en Git Bash (CRLF) y GitHub Actions (LF)', () => {
  const lf = normalizeLineEndings(fixture);
  const crlf = lf.replace(/\n/g, '\r\n');
  assert.equal(schemaSourceHash(lf), schemaSourceHash(crlf));
  assert.deepEqual(parseDrizzleSchema(lf), parseDrizzleSchema(crlf));
});
