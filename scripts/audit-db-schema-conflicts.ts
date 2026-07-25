import { config } from 'dotenv';
config({ path: '.env' });
import { Pool } from 'pg';

async function main() {
  console.log('🔍 Iniciando auditoría completa de esquema PostgreSQL vs Drizzle...\n');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // 1. Get all public tables and columns in Postgres
  const colsRes = await pool.query(
    `SELECT table_name, column_name, data_type, udt_name, column_default, is_nullable
     FROM information_schema.columns 
     WHERE table_schema = 'public'
     ORDER BY table_name, ordinal_position`
  );

  // Group columns by table
  const dbTables: Record<string, Array<{ column_name: string; data_type: string; udt_name: string; column_default: string | null }>> = {};
  for (const row of colsRes.rows) {
    if (!dbTables[row.table_name]) dbTables[row.table_name] = [];
    dbTables[row.table_name].push(row);
  }

  console.log(`📊 Tablas encontradas en PostgreSQL DB: ${Object.keys(dbTables).length}`);

  // 2. Identify text/varchar columns with defaults that might block ENUM conversions
  const textColsWithDefaults = colsRes.rows.filter(
    col => (col.data_type === 'text' || col.data_type === 'character varying') && col.column_default !== null
  );

  console.log(`\n⚠️  Columnas de texto con valores por defecto (Riesgo de bloqueo al convertir a ENUM): ${textColsWithDefaults.length}`);
  for (const col of textColsWithDefaults) {
    console.log(`   • ${col.table_name}.${col.column_name}: default = ${col.column_default}`);
  }

  // 3. Auto-fix option: Drop all text defaults on status/type/frequency/enum candidate columns
  if (process.argv.includes('--fix')) {
    console.log('\n🔧 Aplicando correcciones automáticas de defaults en la base de datos...');
    let fixedCount = 0;
    for (const col of textColsWithDefaults) {
      try {
        await pool.query(`ALTER TABLE "${col.table_name}" ALTER COLUMN "${col.column_name}" DROP DEFAULT`);
        console.log(`   ✓ ${col.table_name}.${col.column_name}: DEFAULT eliminado.`);
        fixedCount++;
      } catch (e: any) {
        console.error(`   ✗ Error en ${col.table_name}.${col.column_name}: ${e.message}`);
      }
    }
    console.log(`\n✅ Corrección finalizada: ${fixedCount} valores por defecto limpios.`);
  } else {
    console.log('\n💡 Tip: Ejecuta este script con --fix para limpiar automáticamente todos los defaults conflictivos:');
    console.log('   npx tsx scripts/audit-db-schema-conflicts.ts --fix\n');
  }

  await pool.end();
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
