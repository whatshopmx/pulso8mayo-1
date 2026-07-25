import { config } from 'dotenv';
import { neon } from '@neondatabase/serverless';
config({ path: '.env' });

const sql = neon(process.env.DATABASE_URL!);

const migrations = [
  { hash: '0000_mixed_arclight', created_at: 1784815642393 },
  { hash: '0001_solid_blonde_phantom', created_at: 1784815702393 },
  { hash: '0002_melodic_silverclaw', created_at: 1784815762393 },
  { hash: '0003_sudden_mister_fear', created_at: 1784815822393 },
  { hash: '0004_secret_vance_astro', created_at: 1784815882393 },
  { hash: '0005_cuddly_unus', created_at: 1784815942393 },
  { hash: '0006_faithful_sumo', created_at: 1784816002393 },
  { hash: '0007_add_manager_invite_token', created_at: 1784816062393 },
  { hash: '0008_simple_wolf_cub', created_at: 1784816122393 },
];

async function main() {
  await sql`CREATE SCHEMA IF NOT EXISTS drizzle`;
  await sql`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint NOT NULL
    )
  `;

  for (const m of migrations) {
    const existing = await sql`SELECT id FROM drizzle.__drizzle_migrations WHERE hash = ${m.hash}`;
    if (existing.length === 0) {
      await sql`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${m.hash}, ${m.created_at})`;
      console.log(`  Inserted: ${m.hash}`);
    } else {
      console.log(`  Exists:   ${m.hash}`);
    }
  }

  const result = await sql`SELECT * FROM drizzle.__drizzle_migrations ORDER BY id`;
  console.log(`\n${result.length} migrations registered. dry run 'pnpm db:migrate' to verify.`);
}

main().catch(console.error);
