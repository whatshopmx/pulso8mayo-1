import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { previewOperatingCfdi } from "@/lib/services/operating-cfdi-preview";
import { POST } from "@/app/api/finance/expense-invoices/preview/route";
import { MAX_OPERATING_CFDI_BYTES } from "@/lib/services/operating-cfdi-parser";

vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/db", () => ({ db: { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn(), transaction: vi.fn() } }));
const companyId = "00000000-0000-4000-8000-000000000001", branchId = "00000000-0000-4000-8000-000000000002";
const foreignId = "00000000-0000-4000-8000-000000000003", foreignBranch = "00000000-0000-4000-8000-000000000004";
let pg: PGlite;
const xml = `<c:Comprobante xmlns:c="http://www.sat.gob.mx/cfd/4" xmlns:t="http://www.sat.gob.mx/TimbreFiscalDigital"
  Version="4.0" TipoDeComprobante="I" Fecha="2026-11-16T12:00:00" SubTotal="1000.01" Total="1000.01" Moneda="MXN" Sello="synthetic">
  <c:Emisor Rfc="AAA010101AAA" Nombre="Servicios"/><c:Receptor Rfc="BBB010101BBB" Nombre="Empresa"/>
  <c:Conceptos><c:Concepto ClaveProdServ="81101700" Cantidad="1" ClaveUnidad="E48" Descripcion="Mantenimiento" ValorUnitario="1000.01" Importe="1000.01" ObjetoImp="01"/></c:Conceptos>
  <c:Complemento><t:TimbreFiscalDigital Version="1.1" UUID="00000000-0000-4000-8000-000000000001" FechaTimbrado="2026-11-16T12:01:00"
    RfcProvCertif="AAA010101AAA" NoCertificadoSAT="00000000000000000001" SelloCFD="synthetic" SelloSAT="synthetic"/></c:Complemento>
</c:Comprobante>`;
const session = (role = "ADMIN", assignedBranch: string | null = null) => ({ user: {
  id: "actor", role, branchId: assignedBranch, companyId, email: "synthetic@fixture.invalid" } });
function request(options: { text?: string; branch?: string; name?: string; mime?: string; company?: string } = {}) {
  const form = new FormData();
  form.set("file", new File([options.text ?? xml], options.name ?? "cfdi.xml", { type: options.mime ?? "application/xml" }));
  form.set("branchId", options.branch ?? branchId);
  if (options.company) form.set("companyId", options.company);
  return new Request("http://localhost/api/finance/expense-invoices/preview", { method: "POST", body: form });
}
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`create table companies(id uuid primary key, tax_id text);
    create table branches(id uuid primary key, company_id uuid, active boolean);
    insert into companies values ('${companyId}','BBB010101BBB'),('${foreignId}','CCC010101CCC');
    insert into branches values ('${branchId}','${companyId}',true),('${foreignBranch}','${foreignId}',true)`);
  const connection = drizzle(pg);
  vi.mocked(db.select).mockImplementation(connection.select.bind(connection) as typeof db.select);
  for (const write of [db.insert, db.update, db.delete, db.transaction]) vi.mocked(write).mockImplementation(() => {
    throw new Error("La vista previa intentó escribir");
  });
}, 30000);
afterAll(async () => { await pg?.close(); });
beforeEach(async () => {
  vi.mocked(auth.api.getSession).mockResolvedValue(session() as never);
  vi.mocked(db.select).mockClear();
  for (const write of [db.insert, db.update, db.delete, db.transaction]) vi.mocked(write).mockClear();
  await pg.exec(`update companies set tax_id='BBB010101BBB' where id='${companyId}'; update branches set active=true`);
});
afterEach(() => {
  expect(db.insert).not.toHaveBeenCalled(); expect(db.update).not.toHaveBeenCalled();
  expect(db.delete).not.toHaveBeenCalled(); expect(db.transaction).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

describe("T06b: vista previa autorizada de CFDI, sin escrituras", () => {
  it("devuelve datos fiscales y fingerprint sin crear documentos ni buscar inventario", async () => {
    const response = await POST(request()); expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toMatchObject({ success: true, data: { branchId, subtotalCents: 100001,
      taxCents: 0, totalCents: 100001, emitter: { rfc: "AAA010101AAA" } } });
    expect(body.data.xmlSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(body.data).not.toHaveProperty("invoiceId"); expect(body.data).not.toHaveProperty("xmlContent");
  });
  it("ignora companyId del formulario y valida receptor contra la sesión", async () => {
    expect((await POST(request({ company: foreignId }))).status).toBe(200);
    expect((await POST(request({ company: foreignId, text: xml.replace("BBB010101BBB", "CCC010101CCC") }))).status).toBe(400);
  });
  it.each(["OWNER", "ADMIN", "SUPER_ADMIN", "GERENTE", "SUPERVISOR"])("permite rol autorizado %s", async role => {
    vi.mocked(auth.api.getSession).mockResolvedValue(session(role, branchId) as never);
    expect((await POST(request())).status).toBe(200);
  });
  it.each(["EMPLEADO", "READONLY", "ROL_FALSO"])("rechaza rol %s antes de leer XML o DB", async role => {
    vi.mocked(auth.api.getSession).mockResolvedValue(session(role, branchId) as never);
    expect((await POST(request())).status).toBe(403); expect(db.select).not.toHaveBeenCalled();
  });
  it("requiere sesión", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    expect((await POST(request())).status).toBe(401); expect(db.select).not.toHaveBeenCalled();
  });
  it("requiere empresa asignada", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { ...session().user, companyId: null } } as never);
    expect((await POST(request())).status).toBe(403);
  });
  it("el servicio también impide saltarse los permisos de la ruta", async () => {
    await expect(previewOperatingCfdi({ userId: "actor", companyId, role: "EMPLEADO", assignedBranchId: branchId }, { xml, branchId }))
      .rejects.toThrow(/permiso|autorizado/i);
    expect(db.select).not.toHaveBeenCalled();
  });
  it("no acepta sucursal ajena ni inexistente", async () => {
    expect((await POST(request({ branch: foreignBranch }))).status).toBe(404);
    expect((await POST(request({ branch: "00000000-0000-4000-8000-000000000099" }))).status).toBe(404);
  });
  it("no amplía la sucursal de un gerente ni permite una asignación ausente", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(session("GERENTE", branchId) as never);
    expect((await POST(request({ branch: foreignBranch }))).status).toBe(403);
    vi.mocked(auth.api.getSession).mockResolvedValue(session("GERENTE") as never);
    expect((await POST(request())).status).toBe(403);
  });
  it("rechaza sucursal inactiva y RFC de empresa ausente", async () => {
    await pg.exec(`update branches set active=false where id='${branchId}'`);
    expect((await POST(request())).status).toBe(404);
    await pg.exec(`update branches set active=true; update companies set tax_id=null where id='${companyId}'`);
    expect((await POST(request())).status).toBe(400);
  });
  it.each([
    ["extensión", { name: "cfdi.pdf" }], ["MIME", { mime: "image/png" }],
    ["vacío", { text: "" }], ["XML incompleto", { text: "<Comprobante>" }],
    ["sucursal inválida", { branch: "no-uuid" }],
  ])("rechaza archivo/captura inválida: %s", async (_label, options) => { expect((await POST(request(options))).status).toBe(400); });
  it("limita el tamaño real incluso sin Content-Length", async () => {
    expect((await POST(request({ text: " ".repeat(MAX_OPERATING_CFDI_BYTES + 1) }))).status).toBe(413);
  });
  it("limita también el cuerpo multipart completo antes de procesarlo", async () => {
    const req = new Request("http://localhost/api/finance/expense-invoices/preview", { method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=a" }, body: "x".repeat(MAX_OPERATING_CFDI_BYTES + 65536) });
    expect((await POST(req)).status).toBe(413);
  });
  it("devuelve error controlado para multipart inválido o sin archivo", async () => {
    const form = new FormData(); form.set("branchId", branchId);
    expect((await POST(new Request("http://localhost/api/finance/expense-invoices/preview", { method: "POST", body: form }))).status).toBe(400);
    expect((await POST(new Request("http://localhost/api/finance/expense-invoices/preview", { method: "POST", body: "malformed" }))).status).toBe(400);
  });
  it("rechaza un segundo archivo o sucursal duplicada", async () => {
    for (const field of ["file", "branchId"]) {
      const form = new FormData();
      form.set("file", new File([xml], "cfdi.xml", { type: "application/xml" })); form.set("branchId", branchId);
      form.append(field, field === "file" ? new File([xml], "otro.xml") : branchId);
      expect((await POST(new Request("http://localhost/api/finance/expense-invoices/preview", { method: "POST", body: form }))).status).toBe(400);
    }
  });
  it("rechaza bytes que no sean UTF-8 válido", async () => {
    const form = new FormData(); form.set("branchId", branchId);
    form.set("file", new File([new Uint8Array([0xc3, 0x28])], "cfdi.xml", { type: "application/xml" }));
    expect((await POST(new Request("http://localhost/api/finance/expense-invoices/preview", { method: "POST", body: form }))).status).toBe(400);
  });
  it("no confía en un Content-Length menor que los bytes reales", async () => {
    const req = new Request("http://localhost/api/finance/expense-invoices/preview", { method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=a", "content-length": "1" },
      body: "x".repeat(MAX_OPERATING_CFDI_BYTES + 65536) });
    expect((await POST(req)).status).toBe(413);
  });
  it("no filtra el error interno de base de datos", async () => {
    vi.mocked(db.select).mockImplementationOnce(() => { throw new Error("credential-sensitive"); });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await POST(request()); expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("credential-sensitive");
  });
});
