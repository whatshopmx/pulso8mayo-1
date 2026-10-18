import { config } from "dotenv";

// Cargar la base aislada ANTES de que cualquier test importe `@/lib/db`
// (que lee `DATABASE_URL` en tiempo de import).
config({ path: ".env.test" });

const isolated = process.env.TEST_DATABASE_URL;

if (!isolated) {
  throw new Error(
    "TEST_DATABASE_URL no está definido. Las pruebas de integración exigen una base aislada; " +
      "no se ejecutan contra la base operativa. Define .env.test con TEST_DATABASE_URL.",
  );
}

// El código de la app lee DATABASE_URL; aquí se redirige a la base aislada.
process.env.DATABASE_URL = isolated;
