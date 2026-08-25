import { defineConfig } from "vitest/config";

// Fijar la zona del proceso ANTES de que Vitest cree workers: los hijos
// (forks/threads) heredan este env. `env` abajo lo re-fuerza en cada worker.
process.env.TZ = "UTC";

/**
 * Capa unitaria: lógica pura en milisegundos, sin base de datos ni navegador.
 *
 * - TZ=UTC fija la zona del proceso; los tests de zona horaria usan zonas
 *   explícitas (America/Mexico_City, etc.), nunca la local.
 * - Los specs E2E (*.spec.ts de Playwright) viven fuera de este glob a
 *   propósito: otra suite, otro ciclo de vida.
 * - `.worktrees/` tiene su propio node_modules y nunca debe entrar al barrido.
 */
export default defineConfig({
  test: {
    environment: "node",
    env: { TZ: "UTC" },
    include: ["lib/**/*.test.ts", "tests/unit/**/*.test.ts"],
    exclude: ["**/node_modules/**", ".worktrees/**"],
    testTimeout: 10_000,
  },
});
