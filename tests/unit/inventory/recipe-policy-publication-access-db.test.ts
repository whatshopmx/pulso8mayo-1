import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';

const db = new PGlite();
const companyA = 'aaaaaaaa-0000-4000-8000-000000000001', companyB = 'bbbbbbbb-0000-4000-8000-000000000001';
const recipeA = 'aaaaaaaa-0000-4000-8000-000000000002', recipeB = 'bbbbbbbb-0000-4000-8000-000000000002';
const versionA = 'aaaaaaaa-0000-4000-8000-000000000003', versionB = 'bbbbbbbb-0000-4000-8000-000000000003';
const field = `recipe_consumption_policy:${recipeA}`;
const context = (company = companyA) => db.query("SELECT set_config('app.current_company_id', $1, false)", [company]);
const audit = (company = companyA, fieldName = field, value = { auditReason: 'Publicación autorizada' }) => db.query(
  'INSERT INTO config_change_logs(company_id,user_id,field_name,new_value) VALUES ($1,$2,$3,$4) RETURNING id',
  [company, 'synthetic-admin', fieldName, JSON.stringify(value)]);

beforeAll(async () => {
  await db.exec(`CREATE ROLE pulso_app NOSUPERUSER NOBYPASSRLS;
    CREATE ROLE legacy_owner NOSUPERUSER NOBYPASSRLS;
    CREATE TABLE companies(id uuid PRIMARY KEY);
    CREATE TABLE recipe_versions(id uuid PRIMARY KEY, recipe_id uuid NOT NULL, company_id uuid NOT NULL,
      version_number integer NOT NULL, base_yield numeric(10,2) NOT NULL, unit text NOT NULL, items_snapshot jsonb NOT NULL,
      price_selling integer, changed_by text);
    CREATE TABLE config_change_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL,
      user_id text NOT NULL, field_name text NOT NULL, old_value jsonb, new_value jsonb, performed_at timestamp DEFAULT now());`);
  await db.query('INSERT INTO companies VALUES ($1),($2)', [companyA, companyB]);
  await db.query(`INSERT INTO recipe_versions(id,recipe_id,company_id,version_number,base_yield,unit,items_snapshot)
    VALUES ($1,$2,$3,1,1,'KG','[]'),($4,$5,$6,1,1,'KG','[]')`, [versionA, recipeA, companyA, versionB, recipeB, companyB]);
  await db.exec(readFileSync('drizzle/0160_inv02_policy_publication_access.sql', 'utf8').replaceAll('--> statement-breakpoint', ''));
  await db.exec('ALTER TABLE recipe_versions OWNER TO legacy_owner; ALTER TABLE config_change_logs OWNER TO legacy_owner');
}, 60_000);
beforeEach(async () => {
  await db.exec('RESET ROLE; TRUNCATE config_change_logs');
  await context(); await audit(companyA, 'other_config'); await audit(companyB, `recipe_consumption_policy:${recipeB}`);
  await db.exec('SET ROLE pulso_app');
});
afterAll(() => db.close());

describe('INV-02.publish.rls: lectura de versiones y auditoría mínima', () => {
  it('runtime sólo lee las columnas de definición de versiones propias', async () => {
    expect((await db.query('SELECT id,recipe_id,company_id,version_number,base_yield,unit,items_snapshot FROM recipe_versions')).rows)
      .toMatchObject([{ id: versionA, company_id: companyA }]);
    expect((await db.query('SELECT id FROM recipe_versions WHERE id=$1', [versionB])).rows).toHaveLength(0);
    await expect(db.query('SELECT price_selling,changed_by FROM recipe_versions')).rejects.toMatchObject({ code: '42501' });
    await expect(db.query('DELETE FROM recipe_versions')).rejects.toMatchObject({ code: '42501' });
    await expect(db.query("UPDATE recipe_versions SET unit='L'")).rejects.toMatchObject({ code: '42501' });
    await context(''); expect((await db.query('SELECT id FROM recipe_versions')).rows).toHaveLength(0);
  });
  it('las versiones también son inmutables frente al propietario ordinario', async () => {
    await db.exec('SET ROLE legacy_owner');
    await expect(db.query("UPDATE recipe_versions SET unit='L' WHERE id=$1", [versionA])).rejects.toMatchObject({ code: '23514' });
    expect((await db.query('SELECT id FROM recipe_versions')).rows).toHaveLength(2);
  });
  it('inserta sólo auditoría de política propia y devuelve sólo su id', async () => {
    const result = await audit(); expect(result.rows).toHaveLength(1);
    expect((await db.query('SELECT id FROM config_change_logs')).rows).toEqual(result.rows);
    await expect(db.query('SELECT new_value FROM config_change_logs')).rejects.toMatchObject({ code: '42501' });
    await expect(audit(companyB)).rejects.toMatchObject({ code: '42501' });
    await expect(audit(companyA, 'other_config')).rejects.toMatchObject({ code: '42501' });
    await expect(audit(companyA, field, { auditReason: ' ' })).rejects.toMatchObject({ code: '42501' });
    await context(''); await expect(audit()).rejects.toMatchObject({ code: '42501' });
  });
  it('deniega UPDATE, DELETE y TRUNCATE de auditoría a runtime', async () => {
    await audit();
    for (const statement of ['DELETE FROM config_change_logs', 'TRUNCATE config_change_logs', "UPDATE config_change_logs SET field_name='x'"]) {
      await expect(db.exec(statement)).rejects.toMatchObject({ code: '42501' });
    }
  });
  it('el dueño conserva escritores legacy pero no reescribe hechos de política', async () => {
    await audit(); await db.exec('SET ROLE legacy_owner'); await context('');
    await audit(companyB, 'legacy_config');
    await db.query("UPDATE config_change_logs SET new_value='{}' WHERE field_name='other_config'");
    await expect(db.query("UPDATE config_change_logs SET new_value='{}' WHERE field_name=$1", [field])).rejects.toMatchObject({ code: '23514' });
    await expect(db.query('DELETE FROM config_change_logs WHERE field_name=$1', [field])).rejects.toMatchObject({ code: '23514' });
  });
  it('revierte la auditoría junto a la transacción del llamador', async () => {
    await db.exec('BEGIN'); await audit(); await db.exec('ROLLBACK');
    expect((await db.query('SELECT id FROM config_change_logs')).rows).toHaveLength(0);
  });
});
