const { readFileSync } = require('node:fs');
const assert = require('node:assert/strict');
const { isDeepStrictEqual } = require('node:util');
const load = number => JSON.parse(readFileSync(`drizzle/meta/0${number}_snapshot.json`, 'utf8'));
const before = load(156), catalog = load(157), sources = load(158);
assert.equal(catalog.prevId, before.id);
assert.equal(sources.prevId, catalog.id);
const schemaOnly = ({ id, prevId, ...schema }) => schema;
assert.deepEqual(schemaOnly(catalog), schemaOnly(before));
const changed = Object.keys(catalog.tables).filter(key => !isDeepStrictEqual(catalog.tables[key], sources.tables[key])).sort();
assert.deepEqual(changed, ['public.inventory_waste', 'public.workflow_instances', 'public.workflow_templates']);
for (const table of changed) {
  assert.equal(sources.tables[table].isRLSEnabled, true);
  assert.equal(Object.keys(sources.tables[table].policies).length, 1);
  sources.tables[table].isRLSEnabled = catalog.tables[table].isRLSEnabled;
  sources.tables[table].policies = catalog.tables[table].policies;
}
assert.deepEqual(schemaOnly(sources), schemaOnly(catalog));
console.log(JSON.stringify({ chainValid: true, catalogSchemaUnchanged: true, onlyRlsChanged: changed }));
