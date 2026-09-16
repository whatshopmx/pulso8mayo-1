import { defineConfig } from "@playwright/test";

/**
 * Config temporal para correr los bloques de servicio de los specs de equipos
 * SIN servidor (T03/T04). Igual que la principal, pero sin `webServer` ni
 * `projects`: los casos HTTP se excluyen con `--grep-invert "las rutas HTTP"`.
 * Borrar después de usar.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "line",
  timeout: 120_000,
  expect: { timeout: 20_000 },
});
