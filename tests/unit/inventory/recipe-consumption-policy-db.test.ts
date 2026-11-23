import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const a = 'aaaaaaaa-0000-4000-8000-000000000001', b = 'bbbbbbbb-0000-4000-8000-000000000001';
const recipeA = 'aaaaaaaa-0000-4000-8000-000000000002', recipeB = 'bbbbbbbb-0000-4000-8000-000000000002';
const versionA = 'aaaaaaaa-0000-4000-8000-000000000003', versionB = 'bbbbbbbb-0000-4000-8000-000000000003';
const version2A = 'aaaaaaaa-0000-4000-8000-000000000006';
const otherRecipeA = 'aaaaaaaa-0000-4000-8000-000000000007', otherVersionA = 'aaaaaaaa-0000-4000-8000-000000000008';
const branchA1 = 'aaaaaaaa-0000-4000-8000-000000000011', branchA2 = 'aaaaaaaa-0000-4000-8000-000000000012';
const itemA = 'aaaaaaaa-0000-4000-8000-000000000004', itemB = 'bbbbbbbb-0000-4000-8000-000000000004';
const policyA = 'aaaaaaaa-0000-4000-8000-000000000005';
const db = new PGlite();
const context = (company = '') => db.query("SELECT set_config('app.current_company_id', $1, false)", [company]);
async function insert(extra: Record<string, unknown> = {}) {
  const row = { id: policyA, company_id: a, recipe_id: recipeA, recipe_version_id: versionA,
    effective_from: '2026-12-01', mode: 'INGREDIENTS_ON_SALE', inventory_item_id: null, unit: null,
    published_by: 'synthetic-publisher', reason: 'Cambio documentado', ...extra };
  const names = Object.keys(row);
  return db.query(`INSERT INTO recipe_consumption_policies (${names.join(',')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, Object.values(row));
}
beforeAll(async () => {
  await db.exec(`CREATE ROLE pulso_app NOSUPERUSER NOBYPASSRLS;
    CREATE ROLE policy_owner NOSUPERUSER NOBYPASSRLS;
    CREATE TABLE companies (id uuid PRIMARY KEY);
    CREATE TABLE branches (id uuid PRIMARY KEY, company_id uuid NOT NULL REFERENCES companies(id));
    CREATE TABLE recipes (id uuid PRIMARY KEY, company_id uuid NOT NULL);
    CREATE TABLE recipe_versions (id uuid PRIMARY KEY, recipe_id uuid NOT NULL, company_id uuid NOT NULL);
    CREATE TABLE inventory_items (id uuid PRIMARY KEY, company_id uuid NOT NULL, unit text NOT NULL);`);
  await db.query('INSERT INTO companies VALUES ($1),($2)', [a, b]);
  await db.query('INSERT INTO branches VALUES ($1,$2),($3,$2)', [branchA1, a, branchA2]);
  await db.query('INSERT INTO recipes VALUES ($1,$2),($3,$4)', [recipeA, a, recipeB, b]);
  await db.query('INSERT INTO recipes VALUES ($1,$2)', [otherRecipeA, a]);
  await db.query('INSERT INTO recipe_versions VALUES ($1,$2,$3),($4,$5,$6)', [versionA, recipeA, a, versionB, recipeB, b]);
  await db.query('INSERT INTO recipe_versions VALUES ($1,$2,$3)', [version2A, recipeA, a]);
  await db.query('INSERT INTO recipe_versions VALUES ($1,$2,$3)', [otherVersionA, otherRecipeA, a]);
  await db.query("INSERT INTO inventory_items VALUES ($1,$2,'KG'),($3,$4,'KG')", [itemA, a, itemB, b]);
  await db.exec(readFileSync('drizzle/0159_inv02_consumption_policy.sql', 'utf8').replaceAll('--> statement-breakpoint', ''));
  await db.exec('ALTER TABLE recipe_consumption_policies OWNER TO policy_owner');
}, 60_000);
beforeEach(async () => {
  await db.exec('RESET ROLE; TRUNCATE recipe_consumption_policies; SET ROLE pulso_app');
  await context(a);
});
afterAll(() => db.close());

describe('INV-02: persistencia aditiva de políticas (SQL efímero)', () => {
  it('conserva versión, modo y vigencia con RLS forzado y rol sin bypass', async () => {
    await insert();
    const row = (await db.query('SELECT company_id,recipe_version_id,mode,effective_from::text AS effective_from FROM recipe_consumption_policies')).rows[0];
    expect(row).toMatchObject({ company_id: a, recipe_version_id: versionA, mode: 'INGREDIENTS_ON_SALE', effective_from: '2026-12-01' });
    expect((await db.query(`SELECT c.relrowsecurity, c.relforcerowsecurity, r.rolsuper, r.rolbypassrls
      FROM pg_class c JOIN pg_roles r ON r.rolname=current_user WHERE c.relname='recipe_consumption_policies'`)).rows[0])
      .toEqual({ relrowsecurity: true, relforcerowsecurity: true, rolsuper: false, rolbypassrls: false });
  });
  it('comparte catálogo entre sucursales propias, sin permitir empresa ajena o contexto ausente', async () => {
    await insert();
    for (const branch of [branchA1, branchA2]) {
      await db.query("SELECT set_config('app.current_branch_id', $1, false)", [branch]);
      expect((await db.query('SELECT * FROM recipe_consumption_policies')).rows).toHaveLength(1);
    }
    await context(b);
    expect((await db.query('SELECT * FROM recipe_consumption_policies')).rows).toHaveLength(0);
    await expect(insert()).rejects.toMatchObject({ code: '42501' });
    await context();
    expect((await db.query('SELECT * FROM recipe_consumption_policies')).rows).toHaveLength(0);
    await expect(insert()).rejects.toMatchObject({ code: '42501' });
  });
  it('rechaza versión de otra receta propia y referencias de otra empresa', async () => {
    await expect(insert({ recipe_version_id: versionB })).rejects.toMatchObject({ code: '23503' });
    await expect(insert({ recipe_version_id: otherVersionA })).rejects.toMatchObject({ code: '23503' });
    await expect(insert({ mode: 'FINISHED_PRODUCT_ON_SALE', inventory_item_id: itemB, unit: 'KG' })).rejects.toMatchObject({ code: '23503' });
    await expect(insert({ recipe_id: recipeB })).rejects.toMatchObject({ code: '23503' });
  });
  it('conserva elaborado propio y su unidad, con un único modo', async () => {
    await insert({ mode: 'FINISHED_PRODUCT_ON_SALE', inventory_item_id: itemA, unit: 'KG' });
    expect((await db.query('SELECT mode,inventory_item_id,unit FROM recipe_consumption_policies')).rows)
      .toEqual([{ mode: 'FINISHED_PRODUCT_ON_SALE', inventory_item_id: itemA, unit: 'KG' }]);
  });
  it.each([
    { mode: 'FINISHED_PRODUCT_ON_SALE' }, { inventory_item_id: itemA, unit: 'KG' },
    { mode: 'BOTH' }, { reason: ' ' }, { published_by: '' },
    { mode: 'FINISHED_PRODUCT_ON_SALE', inventory_item_id: itemA, unit: ' KG ' },
  ])('rechaza modos incompletos y publicación sin procedencia %j', async invalid => {
    await expect(insert(invalid)).rejects.toMatchObject({ code: '23514' });
  });
  it('una vigencia y una versión no pueden publicarse dos veces', async () => {
    await insert();
    await expect(insert({ id: itemA, recipe_version_id: version2A })).rejects.toMatchObject({ code: '23505' });
    await expect(insert({ id: itemA, effective_from: '2027-01-01' })).rejects.toMatchObject({ code: '23505' });
  });
  it('runtime sólo lee/inserta; no reescribe ni borra políticas', async () => {
    await insert();
    await expect(db.query("UPDATE recipe_consumption_policies SET reason='editado'")).rejects.toMatchObject({ code: '42501' });
    await expect(db.query('DELETE FROM recipe_consumption_policies')).rejects.toMatchObject({ code: '42501' });
  });
  it('también impide reescritura y borrado con conexión dueña ordinaria', async () => {
    await insert(); await db.exec('SET ROLE policy_owner');
    await expect(db.query("UPDATE recipe_consumption_policies SET reason='editado'")).rejects.toMatchObject({ code: '23514' });
    await expect(db.query('DELETE FROM recipe_consumption_policies')).rejects.toMatchObject({ code: '23514' });
  });
  it('rollback de publicación no deja una política visible', async () => {
    await db.exec('BEGIN'); await insert(); await db.exec('ROLLBACK');
    expect((await db.query('SELECT * FROM recipe_consumption_policies')).rows).toHaveLength(0);
  });
});
