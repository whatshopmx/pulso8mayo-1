import { config } from 'dotenv';
import { defineConfig } from "drizzle-kit";

config({ path: '.env' });

export default defineConfig({
    schema: "./lib/db/schema.ts",
    out: "./drizzle",
    dialect: "postgresql",
    dbCredentials: {
        // SEC-04: las migraciones corren con el rol dueño (DDL/RLS); el runtime
        // de la app puede usar un rol NOBYPASSRLS en DATABASE_URL. Si no hay
        // rol separado, cae al URL operativo de siempre.
        url: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL!,
    },
});
