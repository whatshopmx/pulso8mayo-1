/**
 * One-off repair: mark migrations 0012-0020 as applied in
 * drizzle.__drizzle_migrations. Their schema objects already exist in the
 * DB (verified by scripts/check-migration-drift.ts) because they were
 * applied via `db:push` instead of `db:migrate`.
 *
 * Hash = sha256 of the whole .sql file (same as drizzle's migrator).
 * created_at = journal entry `when` (folderMillis).
 */
import { config } from "dotenv";
import crypto from "node:crypto";
import fs from "node:fs";
import pg from "pg";

config({ path: ".env" });

const TAGS_TO_MARK = [
  "0012_sudden_madripoor",
  "0013_pale_robin_chapel",
  "0014_elite_mandrill",
  "0015_fine_thena",
  "0016_classy_post",
  "0017_mean_sharon_carter",
  "0018_sad_bloodstorm",
  "0019_next_ricochet",
  "0020_volatile_dormammu",
];

async function main() {
  const journal = JSON.parse(
    fs.readFileSync("drizzle/meta/_journal.json", "utf8"),
  );

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const existing = await client.query(
    `SELECT hash FROM drizzle.__drizzle_migrations`,
  );
  const existingHashes = new Set(existing.rows.map((r) => r.hash));

  for (const tag of TAGS_TO_MARK) {
    const entry = journal.entries.find((e: any) => e.tag === tag);
    if (!entry) throw new Error(`Journal entry not found for ${tag}`);

    const sql = fs.readFileSync(`drizzle/${tag}.sql`, "utf8");
    const hash = crypto.createHash("sha256").update(sql).digest("hex");

    if (existingHashes.has(hash)) {
      console.log(`${tag}: already recorded, skipping`);
      continue;
    }

    await client.query(
      `INSERT INTO drizzle.__drizzle_migrations ("hash", "created_at") VALUES ($1, $2)`,
      [hash, entry.when],
    );
    console.log(`${tag}: marked applied (when=${entry.when})`);
  }

  const last = await client.query(
    `SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1`,
  );
  console.log(`New last applied created_at: ${last.rows[0].created_at}`);

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
