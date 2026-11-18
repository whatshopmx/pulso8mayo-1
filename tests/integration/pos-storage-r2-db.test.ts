import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { config, parse } from "dotenv";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

/**
 * INV-01.b4.storage — V2/V3 con R2 real, Postgres real y sesión Better Auth real.
 *
 * La V1 (`lib/storage/__tests__/pos-upload.test.ts` y
 * `tests/unit/sales/pos-file-read.test.ts`) mockeaba R2 y la base. Esta capa
 * demuestra lo que los mocks no pueden:
 *
 *  V2 (almacenamiento durable y aislado)
 *   1. Los bytes subidos existen en el bucket: se leen de vuelta con una llamada
 *      GetObject independiente y coinciden byte a byte.
 *   2. Lo persistido en `daily_sales_cuts.raw_file_url` es una KEY privada, no
 *      una URL pública navegable.
 *   3. La base es la aislada (`.env.test`), nunca la operativa de `.env`.
 *   4. Rollback: ni usuarios, ni empresas, ni cortes sobreviven a la prueba. Los
 *      objetos de R2 que crea el test se borran explícitamente.
 *
 *  V3 (recorrido HTTP con sesión Better Auth real)
 *   5. POST multipart real → 200 con `durable: true` y la key.
 *   6. GET `/api/sales/cuts/[id]/pos-file` con la cookie de sesión devuelve una
 *      URL firmada y esa URL entrega los bytes correctos.
 *   7. Empresa ajena y sucursal ajena no ven el archivo (404); el rol operativo
 *      queda fuera (403); sin sesión es 401.
 *   8. Una escritura fuera de alcance no crea objeto ni toca el corte.
 *
 * El transporte es HTTP loopback con el servidor de auth y los handlers de
 * producción; Next aporta sólo `headers()`/`cookies()`, como en
 * `cogs-session-db.test.ts`. No se levanta `next dev`.
 */

// Las credenciales R2 viven en `.env`. La base la fija `.env.test` en
// `tests/integration/setup.ts` y `dotenv` no sobrescribe lo ya definido, así que
// esta carga sólo completa R2_* / BETTER_AUTH_SECRET sin tocar DATABASE_URL.
config({ path: ".env" });

const fixture = vi.hoisted(() => ({ tx: null as unknown, headers: new Headers() }));

vi.mock("@/lib/db", async original => {
  const actual = await original<typeof import("@/lib/db")>();
  return {
    db: new Proxy(actual.db, {
      get(target, key) {
        const source = fixture.tx ?? target;
        const value = Reflect.get(source as object, key);
        return typeof value === "function" ? value.bind(source) : value;
      },
    }),
  };
});

vi.mock("next/headers", () => ({
  headers: async () => fixture.headers,
  cookies: async () => ({
    get: (name: string) => {
      const value = fixture.headers
        .get("cookie")
        ?.split("; ")
        .find(c => c.startsWith(`${name}=`))
        ?.slice(name.length + 1);
      return value ? { value } : undefined;
    },
    set: () => {},
  }),
}));

// Import dinámico a propósito: `lib/storage/r2-client` evalúa R2_* en tiempo de
// import, así que `.env` tiene que estar cargado antes de que se evalúe.
const { NextRequest } = await import("next/server");
const { and, eq } = await import("drizzle-orm");
const { db } = await import("@/lib/db");
const { account, users, sessions, branches, companies, dailySalesCuts } =
  await import("@/lib/db/schema");
const { auth } = await import("@/lib/auth");
const { hashPassword } = await import("better-auth/crypto");
const { POST } = await import("@/app/api/workflows/smart-links/upload-pos/route");
const { POST: postCutUpload } = await import("@/app/api/sales/cuts/upload/route");
const { GET } = await import("@/app/api/sales/cuts/[id]/pos-file/route");
const { isR2Configured, getFromR2, deleteFromR2 } = await import(
  "@/lib/storage/r2-client"
);

const DAY = "2026-11-20";
const PDF_MIME = "application/pdf";

async function collect(req: import("node:http").IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

// Transporte loopback real: auth de producción + los dos handlers bajo prueba.
const server = createServer(async (req, res) => {
  try {
    const headers = new Headers();
    for (const [name, values] of Object.entries(req.headers)) {
      for (const value of Array.isArray(values) ? values : values ? [values] : []) {
        headers.append(name, value);
      }
    }
    // Sólo la sesión viaja al fixture: copiar todas las cabeceras arrastraba el
    // `content-length` de la petición anterior a la siguiente y rompía el fetch.
    const sessionHeaders = new Headers();
    for (const name of ["cookie", "x-pulso-tenant-id"]) {
      const value = headers.get(name);
      if (value) sessionHeaders.set(name, value);
    }
    fixture.headers = sessionHeaders;
    const url = new URL(req.url ?? "/", "http://localhost:3000");
    let response: Response;

    if (url.pathname.startsWith("/api/auth/")) {
      const body =
        req.method === "GET" || req.method === "HEAD" ? undefined : await collect(req);
      response = await auth.handler(new Request(url, { method: req.method, headers, body }));
    } else if (
      url.pathname === "/api/workflows/smart-links/upload-pos" &&
      req.method === "POST"
    ) {
      response = await POST(
        new NextRequest(url, { method: "POST", headers, body: await collect(req) })
      );
    } else if (url.pathname === "/api/sales/cuts/upload" && req.method === "POST") {
      response = await postCutUpload(
        new NextRequest(url, { method: "POST", headers, body: await collect(req) })
      );
    } else {
      const match = url.pathname.match(/^\/api\/sales\/cuts\/([^/]+)\/pos-file$/);
      if (!match || req.method !== "GET") {
        res.statusCode = 404;
        res.end("not found");
        return;
      }
      response = await GET(new NextRequest(url, { headers }), {
        params: Promise.resolve({ id: decodeURIComponent(match[1]) }),
      });
    }

    res.statusCode = response.status;
    response.headers.forEach((value, name) => {
      if (name !== "set-cookie") res.setHeader(name, value);
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) res.setHeader("set-cookie", cookies);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error("[pos-storage V2] loopback failure:", error);
    res.statusCode = 500;
    res.end("Test server failed");
  }
});

let baseURL: string;
const uploadedKeys: string[] = [];

beforeAll(async () => {
  const operational = parse(readFileSync(".env")).DATABASE_URL!;
  const isolated = process.env.TEST_DATABASE_URL!;
  const host = (value: string) => new URL(value).hostname.replace(/-pooler(?=\.)/, "");
  expect(host(isolated)).not.toBe(host(operational));

  expect(
    isR2Configured(),
    "R2 sin configurar: esta prueba exige credenciales reales en .env"
  ).toBe(true);

  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Missing loopback test address");
  }
  baseURL = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  for (const key of uploadedKeys) {
    try {
      await deleteFromR2(key);
    } catch (error) {
      console.error("[pos-storage V2] no se pudo borrar el objeto de prueba:", key, error);
    }
  }
  // Sin residuos: el test no deja objetos en el bucket compartido.
  for (const key of uploadedKeys) {
    expect(await getFromR2(key)).toBeNull();
  }
  if (server.listening) {
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve()))
    );
  }
});

type Context = {
  companyA: string;
  companyB: string;
  branchA1: string;
  branchA2: string;
  branchB1: string;
  cutA1: string;
  cutA2: string;
  cutB1: string;
  actors: { adminA: string; gerenteA1: string; gerenteA2: string; empleadoA: string; adminB: string };
  login: (actor: keyof Context["actors"]) => Promise<void>;
  logout: () => void;
};

async function probe(check: (ctx: Context) => Promise<void>) {
  const companyA = randomUUID();
  const companyB = randomUUID();
  const branchA1 = randomUUID();
  const branchA2 = randomUUID();
  const branchB1 = randomUUID();
  const cutA1 = randomUUID();
  const cutA2 = randomUUID();
  const cutB1 = randomUUID();
  const actors = {
    adminA: randomUUID(),
    gerenteA1: randomUUID(),
    gerenteA2: randomUUID(),
    empleadoA: randomUUID(),
    adminB: randomUUID(),
  };
  const password = `Synthetic-${randomUUID()}`;
  const hash = await hashPassword(password);
  const now = new Date();
  const rollback = new Error("POS storage fixture rollback");

  try {
    await db.transaction(async tx => {
      fixture.tx = tx;

      await tx.insert(companies).values([
        { id: companyA, name: `Synthetic POS tenant A ${companyA.slice(0, 8)}` },
        { id: companyB, name: `Synthetic POS tenant B ${companyB.slice(0, 8)}` },
      ]);
      await tx.insert(branches).values([
        { id: branchA1, companyId: companyA, name: "POS branch A1" },
        { id: branchA2, companyId: companyA, name: "POS branch A2" },
        { id: branchB1, companyId: companyB, name: "POS branch B1" },
      ]);
      await tx.insert(users).values([
        { id: actors.adminA, email: `${actors.adminA}@example.invalid`, name: "POS admin A", emailVerified: true, companyId: companyA, branchId: null, role: "ADMIN" as const, createdAt: now, updatedAt: now },
        { id: actors.gerenteA1, email: `${actors.gerenteA1}@example.invalid`, name: "POS manager A1", emailVerified: true, companyId: companyA, branchId: branchA1, role: "GERENTE" as const, createdAt: now, updatedAt: now },
        { id: actors.gerenteA2, email: `${actors.gerenteA2}@example.invalid`, name: "POS manager A2", emailVerified: true, companyId: companyA, branchId: branchA2, role: "GERENTE" as const, createdAt: now, updatedAt: now },
        { id: actors.empleadoA, email: `${actors.empleadoA}@example.invalid`, name: "POS employee A", emailVerified: true, companyId: companyA, branchId: branchA1, role: "EMPLEADO" as const, createdAt: now, updatedAt: now },
        { id: actors.adminB, email: `${actors.adminB}@example.invalid`, name: "POS admin B", emailVerified: true, companyId: companyB, branchId: null, role: "ADMIN" as const, createdAt: now, updatedAt: now },
      ]);
      await tx.insert(account).values(
        Object.values(actors).map(id => ({
          id: randomUUID(),
          userId: id,
          accountId: id,
          providerId: "credential",
          password: hash,
          createdAt: now,
          updatedAt: now,
        }))
      );
      await tx.insert(dailySalesCuts).values([
        { id: cutA1, companyId: companyA, branchId: branchA1, businessDate: DAY, shift: "COMPLETO" as const, channel: "TOTAL" as const, totalSales: 100_00, source: "MANUAL_FORM" as const, status: "VALIDATED" as const },
        { id: cutA2, companyId: companyA, branchId: branchA2, businessDate: DAY, shift: "COMPLETO" as const, channel: "TOTAL" as const, totalSales: 200_00, source: "MANUAL_FORM" as const, status: "VALIDATED" as const },
        { id: cutB1, companyId: companyB, branchId: branchB1, businessDate: DAY, shift: "COMPLETO" as const, channel: "TOTAL" as const, totalSales: 300_00, source: "MANUAL_FORM" as const, status: "VALIDATED" as const },
      ]);

      async function login(actor: keyof Context["actors"]) {
        fixture.headers = new Headers();
        const response = await fetch(`${baseURL}/api/auth/sign-in/email`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: "http://localhost:3000" },
          body: JSON.stringify({ email: `${actors[actor]}@example.invalid`, password }),
        });
        expect(response.status).toBe(200);
        const cookies = response.headers
          .getSetCookie()
          .map(value => value.split(";")[0])
          .join("; ");
        expect(cookies.length).toBeGreaterThan(0);
        fixture.headers = new Headers({ cookie: cookies });
        expect((await auth.api.getSession({ headers: fixture.headers }))?.user.id).toBe(
          actors[actor]
        );
      }

      await check({
        companyA,
        companyB,
        branchA1,
        branchA2,
        branchB1,
        cutA1,
        cutA2,
        cutB1,
        actors,
        login,
        logout: () => {
          fixture.headers = new Headers();
        },
      });

      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    fixture.tx = null;
    fixture.headers = new Headers();
  }

  for (const id of Object.values(actors)) {
    expect(await db.select({ id: users.id }).from(users).where(eq(users.id, id))).toEqual([]);
    expect(await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, id))).toEqual([]);
  }
  for (const id of [companyA, companyB]) {
    expect(await db.select({ id: companies.id }).from(companies).where(eq(companies.id, id))).toEqual([]);
  }
}

type MultipartFile = { name: string; type: string; body: string };

/** Serializa el multipart con la sucursal pedida y devuelve bytes + content-type. */
async function buildUpload(
  branchId: string,
  file: MultipartFile
): Promise<{ body: Buffer; contentType: string }> {
  const form = new FormData();
  form.set("branchId", branchId);
  form.set("businessDate", DAY);
  form.set("file", new File([file.body], file.name, { type: file.type }));
  const encoded = new Response(form);
  return {
    body: Buffer.from(await encoded.arrayBuffer()),
    contentType: encoded.headers.get("content-type")!,
  };
}

async function upload(
  branchId: string,
  file: MultipartFile,
  extraHeaders: Record<string, string> = {}
): Promise<Response> {
  const { body, contentType } = await buildUpload(branchId, file);
  // Por petición: cookie de sesión + lo que el caso pida explícitamente. Así un
  // encabezado de tenant de un caso no se filtra a los siguientes.
  const headers = new Headers();
  const cookie = fixture.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  headers.set("content-type", contentType);
  for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value);
  return fetch(`${baseURL}/api/workflows/smart-links/upload-pos`, {
    method: "POST",
    headers,
    body,
  });
}

async function readPosFile(cutId: string): Promise<Response> {
  const headers = new Headers();
  const cookie = fixture.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  return fetch(`${baseURL}/api/sales/cuts/${cutId}/pos-file`, { headers });
}

async function storedFileUrl(cutId: string): Promise<string | null> {
  const [row] = await db
    .select({ rawFileUrl: dailySalesCuts.rawFileUrl })
    .from(dailySalesCuts)
    .where(eq(dailySalesCuts.id, cutId))
    .limit(1);
  return row?.rawFileUrl ?? null;
}

const CLOSURE_FILE: MultipartFile = {
  name: "cierre POS!.csv",
  type: "text/csv",
  body: "reporte sintético del punto de venta\n",
};

/**
 * CSV de resumen de formas de pago reconocido por `buildSalesCut` (mismo
 * formato que `scripts/verify-sales-ingestion.ts`). No incluye fecha: la aporta
 * el formulario, que es el respaldo documentado del contrato.
 */
const DIRECT_CUT_FILE: MultipartFile = {
  name: "reporte caja.csv",
  type: "text/csv",
  body: [
    "Forma de Pago,Importe,Tickets",
    'Efectivo,"$6,000.00",45',
    'Tarjeta,"$2,500.00",25',
    'Rappi,"$1,500.00",10',
    'Total,"$10,000.00",80',
  ].join("\r\n"),
};

/** Día pasado en hora de México: el servicio rechaza fechas futuras. */
const DIRECT_CUT_DAY = new Date(Date.now() - 86_400_000).toLocaleDateString("en-CA", {
  timeZone: "America/Mexico_City",
});

async function uploadCut(
  branchId: string,
  file: MultipartFile,
  businessDate: string,
  shift: "MATUTINO" | "VESPERTINO" | "COMPLETO" = "MATUTINO"
): Promise<Response> {
  const form = new FormData();
  form.set("branchId", branchId);
  form.set("businessDate", businessDate);
  form.set("shift", shift);
  form.set("file", new File([file.body], file.name, { type: file.type }));
  const encoded = new Response(form);
  const headers = new Headers();
  const cookie = fixture.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  headers.set("content-type", encoded.headers.get("content-type")!);
  return fetch(`${baseURL}/api/sales/cuts/upload`, {
    method: "POST",
    headers,
    body: Buffer.from(await encoded.arrayBuffer()),
  });
}

async function directCutRows(companyId: string, branchId: string, businessDate: string) {
  return db
    .select({
      id: dailySalesCuts.id,
      rawFileUrl: dailySalesCuts.rawFileUrl,
      source: dailySalesCuts.source,
      totalSales: dailySalesCuts.totalSales,
      shift: dailySalesCuts.shift,
    })
    .from(dailySalesCuts)
    .where(
      and(
        eq(dailySalesCuts.companyId, companyId),
        eq(dailySalesCuts.branchId, branchId),
        eq(dailySalesCuts.businessDate, businessDate)
      )
    );
}

it("V2/V3 R2 real: la subida persiste bytes privados y la lectura firmada los devuelve", async () => {
  await probe(async ctx => {
    expect((await upload(ctx.branchA1, CLOSURE_FILE)).status).toBe(401);

    await ctx.login("adminA");
    const response = await upload(ctx.branchA1, CLOSURE_FILE);
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      success: boolean;
      data: {
        fileUrl: string;
        durable: boolean;
        fileName: string;
        matchedCount: number;
      };
    };
    expect(payload.success).toBe(true);
    expect(payload.data.durable).toBe(true);
    expect(payload.data.matchedCount).toBe(1);

    // KEY privada con jerarquía de tenancy; nunca una URL navegable.
    const key = payload.data.fileUrl;
    uploadedKeys.push(key);
    expect(key).toMatch(
      new RegExp(
        `^companies/${ctx.companyA}/branches/${ctx.branchA1}/pos/${DAY}/\\d+_cierre_POS_\\.csv$`
      )
    );
    expect(key.startsWith("http")).toBe(false);
    expect(await storedFileUrl(ctx.cutA1)).toBe(key);

    // El objeto existe en el bucket y conserva los bytes exactos.
    const stored = await getFromR2(key);
    expect(stored).not.toBeNull();
    expect(stored!.equals(Buffer.from(CLOSURE_FILE.body))).toBe(true);

    // Lectura autorizada del corte propio.
    const read = await readPosFile(ctx.cutA1);
    expect(read.status).toBe(200);
    const readPayload = (await read.json()) as {
      success: boolean;
      data: { url: string; fileKey: string; expiresInSeconds: number };
    };
    expect(readPayload.data.fileKey).toBe(key);
    expect(readPayload.data.expiresInSeconds).toBe(600);
    expect(readPayload.data.url).toMatch(/^https:\/\//);

    // La URL firmada entrega los mismos bytes.
    const download = await fetch(readPayload.data.url);
    expect(download.status).toBe(200);
    expect(Buffer.from(await download.arrayBuffer()).equals(Buffer.from(CLOSURE_FILE.body))).toBe(
      true
    );

    // Sin sesión no hay lectura.
    ctx.logout();
    expect((await readPosFile(ctx.cutA1)).status).toBe(401);
  });
});

it("V3 lectura: empresa ajena y sucursal ajena reciben 404; el rol operativo recibe 403", async () => {
  await probe(async ctx => {
    await ctx.login("adminA");
    const uploaded = await upload(ctx.branchA1, CLOSURE_FILE);
    expect(uploaded.status).toBe(200);
    uploadedKeys.push(((await uploaded.json()) as { data: { fileUrl: string } }).data.fileUrl);

    // Gerente de la misma empresa: su sucursal sí, la otra no.
    await ctx.login("gerenteA1");
    expect((await readPosFile(ctx.cutA1)).status).toBe(200);
    expect((await readPosFile(ctx.cutA2)).status).toBe(404);

    await ctx.login("gerenteA2");
    expect((await readPosFile(ctx.cutA1)).status).toBe(404);

    // Otra empresa: el corte no existe para ella.
    await ctx.login("adminB");
    expect((await readPosFile(ctx.cutA1)).status).toBe(404);

    // Rol sin acceso a la evidencia financiera.
    await ctx.login("empleadoA");
    expect((await readPosFile(ctx.cutA1)).status).toBe(403);
  });
});

it("V3 escritura: sucursal/empresa se validan antes de tocar R2 y el archivo inválido no se vincula", async () => {
  await probe(async ctx => {
    // Gerente de A2 intentando escribir en A1: rechazo de alcance.
    await ctx.login("gerenteA2");
    expect((await upload(ctx.branchA1, CLOSURE_FILE)).status).toBe(403);
    expect(await storedFileUrl(ctx.cutA1)).toBeNull();

    // ADMIN de B apuntando a una sucursal de A: la sucursal no es de su empresa.
    await ctx.login("adminB");
    expect((await upload(ctx.branchA1, CLOSURE_FILE)).status).toBe(400);
    expect(await storedFileUrl(ctx.cutA1)).toBeNull();

    // Encabezado de tenant ajeno: no se puede suplantar la empresa de la sesión.
    await ctx.login("adminA");
    expect(
      (await upload(ctx.branchA1, CLOSURE_FILE, { "x-pulso-tenant-id": ctx.companyB })).status
    ).toBe(403);
    expect(await storedFileUrl(ctx.cutA1)).toBeNull();

    // Archivo vacío y MIME no permitido: 400 sin escribir ni vincular.
    expect((await upload(ctx.branchA1, { ...CLOSURE_FILE, body: "" })).status).toBe(400);
    expect(
      (await upload(ctx.branchA1, { ...CLOSURE_FILE, type: PDF_MIME })).status
    ).toBe(400);
    expect(await storedFileUrl(ctx.cutA1)).toBeNull();
  });
});

it("V2/V3 productor directo: el corte cargado usa la key POS canónica y se lee con la ruta autorizada", async () => {
  await probe(async ctx => {
    // El rol operativo no captura cortes ni produce evidencia financiera.
    await ctx.login("empleadoA");
    expect((await uploadCut(ctx.branchA1, DIRECT_CUT_FILE, DIRECT_CUT_DAY)).status).toBe(403);
    expect(await directCutRows(ctx.companyA, ctx.branchA1, DIRECT_CUT_DAY)).toHaveLength(0);

    // Gerente de otra sucursal: rechazo de alcance antes de escribir bytes.
    await ctx.login("gerenteA2");
    expect((await uploadCut(ctx.branchA1, DIRECT_CUT_FILE, DIRECT_CUT_DAY)).status).toBe(403);
    expect(await directCutRows(ctx.companyA, ctx.branchA1, DIRECT_CUT_DAY)).toHaveLength(0);

    await ctx.login("gerenteA1");
    const response = await uploadCut(ctx.branchA1, DIRECT_CUT_FILE, DIRECT_CUT_DAY);
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { success: boolean; data: { rows: unknown[] } };
    expect(payload.success).toBe(true);
    // El archivo declara total y 1,500 de Rappi: el servicio separa SALON y
    // DELIVERY en la misma inserción, como cualquier otro consumo del writer.
    expect(payload.data.rows).toHaveLength(2);

    const rows = await directCutRows(ctx.companyA, ctx.branchA1, DIRECT_CUT_DAY);
    expect(rows).toHaveLength(2);
    expect(rows.map(row => row.source)).toEqual(["UPLOAD", "UPLOAD"]);
    expect(rows.map(row => row.shift)).toEqual(["MATUTINO", "MATUTINO"]);
    expect(rows.reduce((sum, row) => sum + row.totalSales, 0)).toBe(1_000_000);

    const key = rows[0].rawFileUrl;
    expect(key).toBeTruthy();
    expect(rows[1].rawFileUrl).toBe(key);
    uploadedKeys.push(key!);
    expect(key).toMatch(
      new RegExp(
        `^companies/${ctx.companyA}/branches/${ctx.branchA1}/pos/${DIRECT_CUT_DAY}/\\d+_reporte_caja\\.csv$`
      )
    );
    expect(key!.startsWith("http")).toBe(false);

    // Los bytes del corte están en el bucket, no sólo la referencia.
    const stored = await getFromR2(key!);
    expect(stored).not.toBeNull();
    expect(stored!.equals(Buffer.from(DIRECT_CUT_FILE.body))).toBe(true);

    // La ruta de lectura existente abre el corte recién creado sin adaptación.
    const read = await readPosFile(rows[0].id);
    expect(read.status).toBe(200);
    const readPayload = (await read.json()) as { data: { url: string; fileKey: string } };
    expect(readPayload.data.fileKey).toBe(key);
    const download = await fetch(readPayload.data.url);
    expect(download.status).toBe(200);
    expect(Buffer.from(await download.arrayBuffer()).equals(Buffer.from(DIRECT_CUT_FILE.body))).toBe(
      true
    );
  });
});
