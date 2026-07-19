import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  console.log('Adding manager_id column to branches table...');
  try {
    await sql`
      ALTER TABLE "branches" 
      ADD COLUMN IF NOT EXISTS "manager_id" text;
    `;
    console.log('Column manager_id added successfully.');

    console.log('Adding branches_manager_id_fkey constraint...');
    try {
      await sql`
        ALTER TABLE "branches" 
        ADD CONSTRAINT "branches_manager_id_fkey" 
        FOREIGN KEY ("manager_id") REFERENCES "users"("id") 
        ON DELETE NO ACTION ON UPDATE NO ACTION;
      `;
      console.log('Constraint branches_manager_id_fkey added successfully.');
    } catch (err: any) {
      if (err.message.includes('already exists')) {
        console.log('Constraint branches_manager_id_fkey already exists.');
      } else {
        throw err;
      }
    }
  } catch (err) {
    console.error('Error adding manager_id:', err);
  }
}

main().catch(console.error);
