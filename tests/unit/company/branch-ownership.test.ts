import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import { BranchService } from "@/lib/services/branch-service";
import { createBranchSchema, updateBranchSchema } from "@/lib/validations/branch";
import { capturarError } from "../../fixtures/db-simulado";

/**
 * C22.1 — captura de la propiedad de la sucursal.
 *
 * `branches.ownership_type` y `branches.franchisee_user_id` existían en el
 * esquema desde antes y nada podía escribirlos: toda sucursal era `OWNED` para
 * siempre y el aislamiento de franquicias no tenía nada que decidir. Esta
 * prueba corre el contrato Zod y el servicio de verdad (con la base simulada)
 * y comprueba los tres invariantes del recorrido:
 *
 *  1. Una franquicia **sin responsable** no existe: la rechaza el contrato y,
 *     otra vez, el servicio, porque `branchVisibilityFilter` sólo la abre para
 *     su `franchiseeUserId`.
 *  2. El responsable tiene que ser de la **misma empresa**: un id ajeno es un
 *     id que el filtrado compararía contra actores que nunca son esa persona.
 *  3. Actualizar y desactivar llevan `company_id` en el `WHERE`: la tenencia
 *     no se comprueba en una lectura previa y después se confía.
 */

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    query: { branches: { findFirst: vi.fn() }, users: { findFirst: vi.fn() } },
  },
}));

const dialect = new PgDialect();
const traducir = (condicion: unknown) => dialect.sqlToQuery(condicion as never);

/** `db.select().from(users).where().limit(1)` — la consulta de pertenencia. */
function programarConsultaDeUsuarios(resultados: unknown[]) {
  const donde = vi.fn();
  vi.mocked(db.select).mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: (condicion: unknown) => {
        donde(condicion);
        return { limit: vi.fn().mockResolvedValue(resultados) };
      },
    }),
  } as never);
  return donde;
}

function programarInsert(fila: unknown) {
  const values = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([fila]) });
  vi.mocked(db.insert).mockReturnValue({ values } as never);
  return values;
}

function programarUpdate() {
  const set = vi.fn();
  vi.mocked(db.update).mockReturnValue({
    set: (cambios: unknown) => {
      set(cambios);
      return { where: vi.fn().mockResolvedValue([]) };
    },
  } as never);
  return set;
}

const franquiciaExistente = {
  id: "suc-1",
  companyId: "comp-a",
  name: "Franquicia Centro",
  ownershipType: "FRANCHISE",
  franchiseeUserId: "u-fran-1",
  managerId: null,
};

const propiaExistente = {
  id: "suc-2",
  companyId: "comp-a",
  name: "Sucursal Norte",
  ownershipType: "OWNED",
  franchiseeUserId: null,
  managerId: null,
};

beforeEach(() => {
  vi.mocked(db.select).mockReset();
  vi.mocked(db.insert).mockReset();
  vi.mocked(db.update).mockReset();
  vi.mocked(db.query.branches.findFirst).mockReset();
  vi.mocked(db.query.users.findFirst).mockReset();
});

describe("contrato de propiedad — Zod", () => {
  it("una franquicia sin responsable no se puede crear", () => {
    const resultado = createBranchSchema.safeParse({ name: "Franquicia Norte", ownershipType: "FRANCHISE" });
    expect(resultado.success).toBe(false);
    expect(resultado.error?.issues[0]?.path).toEqual(["franchiseeUserId"]);
    expect(resultado.error?.issues[0]?.message).toBe(
      "Elige quién responde por la sucursal: sin franquiciatario no se puede ver.",
    );
  });

  it("una franquicia con responsable y una propia sin responsable se aceptan", () => {
    expect(
      createBranchSchema.safeParse({
        name: "Franquicia Norte",
        ownershipType: "FRANCHISE",
        franchiseeUserId: "3f1d3e5a-1111-4222-8333-444455556666",
      }).success,
    ).toBe(true);
    expect(createBranchSchema.safeParse({ name: "Sucursal Norte", ownershipType: "OWNED" }).success).toBe(true);
    expect(createBranchSchema.safeParse({ name: "Sin capturar" }).success).toBe(true);
  });

  it("un ownershipType fuera del enum se rechaza nombrando el campo", () => {
    const resultado = createBranchSchema.safeParse({ name: "Alquilada", ownershipType: "ALQUILER" });
    expect(resultado.success).toBe(false);
    expect(resultado.error?.issues[0]?.message).toBe("Elige si la sucursal es propia o franquicia.");
  });

  it("el parche que reclasifica a franquicia también exige el responsable", () => {
    // Un `PATCH { ownershipType: "FRANCHISE" }` parcial dejaría la sucursal sin
    // responsable en la base: el contrato la rechaza en lugar de guardarla.
    expect(updateBranchSchema.safeParse({ ownershipType: "FRANCHISE" }).success).toBe(false);
    expect(updateBranchSchema.safeParse({ name: "Otro nombre" }).success).toBe(true);
    expect(
      updateBranchSchema.safeParse({
        ownershipType: "FRANCHISE",
        franchiseeUserId: "3f1d3e5a-1111-4222-8333-444455556666",
      }).success,
    ).toBe(true);
  });
});

describe("BranchService.createBranch", () => {
  it("sin companyId se rechaza antes de tocar la base", async () => {
    const error = await capturarError(() => BranchService.createBranch({ name: "X" }));
    expect(error.statusCode).toBe(400);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("una franquicia sin responsable la rechaza el servicio, no sólo el contrato", async () => {
    const error = await capturarError(() =>
      BranchService.createBranch({ name: "Franquicia Norte", companyId: "comp-a", ownershipType: "FRANCHISE" }),
    );
    expect(error.message).toBe("Elige quién responde por la sucursal: sin franquiciatario no se puede ver.");
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("un responsable de otra empresa no sirve: el WHERE lleva company_id", async () => {
    const donde = programarConsultaDeUsuarios([]); // nadie con ese id en comp-a

    const error = await capturarError(() =>
      BranchService.createBranch({
        name: "Franquicia Norte",
        companyId: "comp-a",
        ownershipType: "FRANCHISE",
        franchiseeUserId: "3f1d3e5a-1111-4222-8333-444455556666",
      }),
    );
    expect(error.message).toBe("El franquiciatario responsable no pertenece a esta empresa.");
    expect(db.insert).not.toHaveBeenCalled();
    expect(traducir(donde.mock.calls[0][0]).sql).toContain('"users"."company_id"');
  });

  it("guarda la propiedad y limpia el responsable de una sucursal propia", async () => {
    programarConsultaDeUsuarios([{ id: "3f1d3e5a-1111-4222-8333-444455556666" }]);
    const values = programarInsert({ id: "suc-n" });

    await BranchService.createBranch({
      name: "Franquicia Norte",
      companyId: "comp-a",
      ownershipType: "FRANCHISE",
      franchiseeUserId: "3f1d3e5a-1111-4222-8333-444455556666",
    });
    expect(values.mock.calls[0][0]).toMatchObject({
      ownershipType: "FRANCHISE",
      franchiseeUserId: "3f1d3e5a-1111-4222-8333-444455556666",
    });

    programarConsultaDeUsuarios([{ id: "3f1d3e5a-1111-4222-8333-444455556666" }]);
    const valuesPropia = programarInsert({ id: "suc-p" });
    await BranchService.createBranch({
      name: "Sucursal Propia",
      companyId: "comp-a",
      ownershipType: "OWNED",
      franchiseeUserId: "3f1d3e5a-1111-4222-8333-444455556666",
    });
    expect(valuesPropia.mock.calls[0][0]).toMatchObject({ ownershipType: "OWNED", franchiseeUserId: null });
  });
});

describe("BranchService.updateBranch", () => {
  it("sin companyId no actualiza nada", async () => {
    const error = await capturarError(() => BranchService.updateBranch("suc-1", { name: "X" }));
    expect(error.statusCode).toBe(400);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("una sucursal de otra empresa responde 404 y no se actualiza", async () => {
    vi.mocked(db.query.branches.findFirst).mockResolvedValue(undefined);

    const error = await capturarError(() =>
      BranchService.updateBranch("suc-ajena", { name: "X" }, "comp-a"),
    );
    expect(error.statusCode).toBe(404);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("no se puede dejar una franquicia sin responsable", async () => {
    vi.mocked(db.query.branches.findFirst).mockResolvedValue(franquiciaExistente as never);

    const error = await capturarError(() =>
      BranchService.updateBranch("suc-1", { franchiseeUserId: null }, "comp-a"),
    );
    expect(error.message).toBe("Elige quién responde por la sucursal: sin franquiciatario no se puede ver.");
    expect(db.update).not.toHaveBeenCalled();
  });

  it("reclasificar a propia limpia el responsable", async () => {
    vi.mocked(db.query.branches.findFirst).mockResolvedValue(franquiciaExistente as never);
    const set = programarUpdate();

    await BranchService.updateBranch("suc-1", { ownershipType: "OWNED" }, "comp-a");

    expect(set.mock.calls[0][0]).toMatchObject({ ownershipType: "OWNED", franchiseeUserId: null });
  });

  it("actualizar sólo el nombre de una franquicia conserva su estado", async () => {
    vi.mocked(db.query.branches.findFirst).mockResolvedValue(franquiciaExistente as never);
    const set = programarUpdate();

    await BranchService.updateBranch("suc-1", { name: "Otro nombre" }, "comp-a");

    expect(set.mock.calls[0][0]).toEqual({ name: "Otro nombre" });
  });

  it("el UPDATE lleva company_id en el WHERE, no sólo el id", async () => {
    vi.mocked(db.query.branches.findFirst).mockResolvedValue(propiaExistente as never);
    const donde = vi.fn();
    vi.mocked(db.update).mockReturnValue({
      set: () => ({ where: (condicion: unknown) => { donde(condicion); return Promise.resolve([]); } }),
    } as never);

    await BranchService.updateBranch("suc-2", { name: "Renombrada" }, "comp-a");

    const { sql, params } = traducir(donde.mock.calls[0][0]);
    expect(sql).toContain('"branches"."company_id"');
    expect(params).toContain("comp-a");
  });
});

describe("BranchService.deleteBranch", () => {
  it("sin companyId no desactiva", async () => {
    const error = await capturarError(() => BranchService.deleteBranch("suc-1"));
    expect(error.statusCode).toBe(400);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("la desactivación es por id y company_id a la vez", async () => {
    const donde = vi.fn();
    vi.mocked(db.update).mockReturnValue({
      set: () => ({ where: (condicion: unknown) => { donde(condicion); return Promise.resolve(true); } }),
    } as never);

    await BranchService.deleteBranch("suc-1", "comp-a");

    const { sql, params } = traducir(donde.mock.calls[0][0]);
    expect(sql).toContain('"branches"."company_id"');
    expect(params).toContain("comp-a");
  });
});
