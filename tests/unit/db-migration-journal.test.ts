import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guarda de trazabilidad del journal de migraciones.
 *
 * `drizzle-kit migrate` sólo aplica las entradas de
 * `drizzle/meta/_journal.json`; un SQL versionado sin entrada en el journal
 * existe pero nunca se ejecuta. Ese fue el caso de `0152` tras el commit
 * `fb5ded2`, que lo dejó fuera para no arrastrar `0151`/`0153` del frente de
 * facturas.
 *
 * La comprobación es de checkout limpio: si el journal referencia un tag cuyo
 * `.sql` no está en el repositorio, la migración no es reproducible y esta
 * prueba falla. Los huecos de `idx` se permiten a propósito (una entrada puede
 * pertenecer a otro frente aún sin commitear); lo que no se permite es
 * referenciar archivos ausentes, duplicar `idx` o desordenarlos.
 */
const drizzleDir = fileURLToPath(new URL("../../drizzle/", import.meta.url));

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints?: boolean;
}

const journal = JSON.parse(
  readFileSync(`${drizzleDir}meta/_journal.json`, "utf8"),
) as { entries: JournalEntry[] };

describe("drizzle/meta/_journal.json", () => {
  it("registra la migración de aislamiento de excepciones", () => {
    const entry = journal.entries.find(
      (candidate) => candidate.tag === "0152_exc01_exceptions_rls",
    );
    expect(entry).toBeDefined();
    expect(entry!.idx).toBe(152);
    expect(existsSync(`${drizzleDir}0152_exc01_exceptions_rls.sql`)).toBe(true);
  });

  it("no referencia SQL ausente ni duplica idx", () => {
    const missing = journal.entries
      .filter((entry) => !existsSync(`${drizzleDir}${entry.tag}.sql`))
      .map((entry) => entry.tag);
    expect(missing).toEqual([]);

    const indexes = journal.entries.map((entry) => entry.idx);
    expect(new Set(indexes).size).toBe(indexes.length);
  });

  it("mantiene el orden de aplicación ascendente", () => {
    const indexes = journal.entries.map((entry) => entry.idx);
    expect(indexes).toEqual([...indexes].sort((left, right) => left - right));
  });
});
