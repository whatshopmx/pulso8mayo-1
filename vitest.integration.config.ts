import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { config } from "dotenv";

// Base aislada: `.env.test` define TEST_DATABASE_URL; nunca la base operativa.
// Si el archivo no existe, `setup.ts` falla con un mensaje explícito en vez de
// correr contra producción.
config({ path: ".env.test" });

process.env.TZ = "UTC";

/**
 * Capa de integración: ejercita servicios contra una base Postgres real
 * (proyecto Neon aislado). Separada de `vitest.config.ts` a propósito:
 * - no corre en `pnpm test:unit`;
 * - `fileParallelism: false` serializa archivos porque comparten la misma base;
 * - timeouts amplios por la latencia de red de Neon.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    exclude: ["**/node_modules/**", ".worktrees/**"],
    setupFiles: ["tests/integration/setup.ts"],
    env: { TZ: "UTC" },
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
