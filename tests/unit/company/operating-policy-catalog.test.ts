import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  CATALOGO_OPERATIVO,
  ETIQUETA_CLASIFICACION,
  EXPLICACION_CLASIFICACION,
  PARAMETROS_CONSUMIDOS,
  clasificacionDe,
  politicaPorCampo,
  politicaPorInput,
  politicasConDecisionPendiente,
  resumenDePoliticas,
} from "@/lib/company/operating-policy-catalog";

/**
 * C15 — el catálogo se comprueba contra el árbol de código.
 *
 * Un catálogo escrito a mano caduca: nadie avisa cuando un servicio deja de
 * leer un parámetro, y vuelve a ser la prosa que H04 criticó. Estas pruebas lo
 * atan al código:
 *
 *  1. Cada política `aplicada` nombra un consumidor que **existe** y que
 *     contiene el símbolo declarado. Si alguien renombra la función, la prueba
 *     falla en vez de dejar la pantalla prometiendo una regla que ya no está.
 *  2. Cada política `descriptiva` no aparece **en ninguna parte** del código
 *     fuera de la lista blanca de esquema, API, mapeo del formulario, catálogo
 *     y semillas. Es la prueba que volvió a descubrir H04, esta vez sola.
 *  3. Los valores que la pantalla ofrece son los que el `PUT` acepta, y cada
 *     uno tiene caso dado/cuando/entonces o queda marcado como descriptivo.
 *
 * La lectura del árbol es de sólo lectura y sobre archivos del repo: no toca
 * base de datos, Next ni autenticación.
 */

const RAIZ = process.cwd();

/** Carpetas donde un valor puede aparecer sin que eso lo convierta en consumidor. */
const RUTAS_ESQUEMA_Y_API = ["lib/db", "app/api/company/operating-config", "lib/company", "scripts"];
/** Componentes: la UI captura y muestra, no decide. */
const RUTAS_UI = ["components", "app/dashboard", "app/(dashboard)"];
/** Archivos que participan en el contrato y no son consumidor. */
const EXENTOS_POR_NOMBRE = new Set([
  "operating-policy-catalog.ts",
  "operating-config-values.ts",
  "config-change-log.ts",
  // Declara los defaults del módulo y el tipo de la fila: guardar el valor por
  // omisión no es leerlo para decidir.
  "tenant-config-service.ts",
]);

function listarArchivos(dir: string, acc: string[] = []): string[] {
  let entradas: string[];
  try {
    entradas = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const entrada of entradas) {
    if (entrada === "node_modules" || entrada === ".git" || entrada === ".next" || entrada === "dist") {
      continue;
    }
    const completa = join(dir, entrada);
    if (statSync(completa).isDirectory()) listarArchivos(completa, acc);
    else if (/\.(ts|tsx)$/.test(entrada) && !entrada.endsWith(".test.ts") && !entrada.endsWith(".test.tsx")) {
      acc.push(completa);
    }
  }
  return acc;
}

/** Archivos que pueden *leer* el valor: todo menos esquema, API de config y UI. */
function archivosDeCodigo(): string[] {
  const todos = [...listarArchivos(join(RAIZ, "lib")), ...listarArchivos(join(RAIZ, "app"))];
  return todos.filter((ruta) => {
    const relativa = ruta.slice(RAIZ.length + 1).replace(/\\/g, "/");
    if (EXENTOS_POR_NOMBRE.has(relativa.split("/").pop() ?? "")) return false;
    if (RUTAS_ESQUEMA_Y_API.some((prefijo) => relativa.startsWith(prefijo))) return false;
    if (RUTAS_UI.some((prefijo) => relativa.startsWith(prefijo))) return false;
    return true;
  });
}

// Leer cada archivo una sola vez: seis dimensiones no deben repetir todo el I/O.
const FUENTES_CODIGO = archivosDeCodigo().map((ruta) => ({
  relativa: ruta.slice(RAIZ.length + 1).replace(/\\/g, "/"),
  fuente: readFileSync(ruta, "utf8"),
}));

function leer(rutaRelativa: string): string {
  return readFileSync(join(RAIZ, rutaRelativa), "utf8");
}

/**
 * Buscar el token como identificador y no como prefijo de otro nombre
 * (`supplierPayment` dentro de `supplierPaymentModelEnum`). Se usan lookarounds
 * en vez de `\b` porque varios tokens terminan en carácter no alfanumérico
 * —`managerAuthLimitCents: "managerAuthLimit"`— y ahí `\b` nunca cierra.
 */
function menciona(texto: string, token: string): boolean {
  return new RegExp(`(?<![$\\w])${token}(?![$\\w])`).test(texto);
}

describe("catálogo de políticas operativas — forma", () => {
  it("cubre las siete dimensiones y los cinco umbrales de la pantalla", () => {
    const dimensiones = CATALOGO_OPERATIVO.filter((p) => p.seccion === "dimension").map((p) => p.campo);
    expect(dimensiones).toEqual([
      "purchasingStructure",
      "foodProduction",
      "treasuryModel",
      "supplierPayment",
      "payrollDispersion",
      "managerAutonomy",
      "tenantType",
    ]);

    const umbrales = CATALOGO_OPERATIVO.filter((p) => p.seccion === "umbral").map((p) => p.campo);
    expect(umbrales).toContain("pettyCashLimitCents");
    expect(umbrales).toHaveLength(5);
  });

  it("registra los controles de compras de C16.2 como política aplicada", () => {
    // C16.2 cambió una línea del recorrido: hay una política que el código
    // aplica. Dejarla fuera del catálogo sería el mismo defecto que H04
    // mencionado al revés —código que aplica una regla que el contrato no
    // menciona—, así que su presencia y su consumidor se comprueban aquí.
    const controles = CATALOGO_OPERATIVO.filter((p) => p.seccion === "control");
    expect(controles.map((p) => p.campo)).toEqual(["purchase_delegation_rules"]);
    expect(controles[0].clasificacion).toBe("aplicada");
  });

  it("no repite campo ni input, y los dos se localizan", () => {
    const campos = CATALOGO_OPERATIVO.map((p) => p.campo);
    const inputs = CATALOGO_OPERATIVO.map((p) => p.input);
    expect(new Set(campos).size).toBe(campos.length);
    expect(new Set(inputs).size).toBe(inputs.length);

    for (const politica of CATALOGO_OPERATIVO) {
      expect(politicaPorCampo(politica.campo)).toBe(politica);
      expect(politicaPorInput(politica.input)).toBe(politica);
    }
  });

  it("cada política tiene clasificación, unidad, alcance, permiso y estado vacío", () => {
    for (const politica of CATALOGO_OPERATIVO) {
      expect(Object.keys(ETIQUETA_CLASIFICACION)).toContain(politica.clasificacion);
      expect(politica.unidad.length).toBeGreaterThan(0);
      expect(politica.alcance.length).toBeGreaterThan(0);
      expect(politica.permiso).toBe("settings/update");
      expect(politica.aplicacion.length).toBeGreaterThan(20);
      expect(politica.excepciones.length).toBeGreaterThan(0);
      expect(politica.vacio.length).toBeGreaterThan(0);
      expect(politica.valores.length).toBeGreaterThan(0);
    }
  });

  it("cada valor tiene caso dado/cuando/entonces o queda marcado como descriptivo", () => {
    for (const politica of CATALOGO_OPERATIVO) {
      for (const valor of politica.valores) {
        if (valor.caso) {
          expect(valor.caso.dado.length).toBeGreaterThan(0);
          expect(valor.caso.cuando.length).toBeGreaterThan(0);
          expect(valor.caso.entonces.length).toBeGreaterThan(0);
          // Una política aplicada sin ningún caso sería una regla sin comprobar.
          if (politica.clasificacion === "aplicada") {
            expect(
              politica.valores.every((v) => v.caso !== null),
              `${politica.campo} se declara aplicada pero algún valor no tiene caso`,
            ).toBe(true);
          }
        } else {
          // Sin caso, el valor no produce ninguna decisión hoy. Eso es legítimo
          // en `descriptiva` y en `pendiente` —en la segunda, porque lo que
          // falta es precisamente la decisión— y nunca en `aplicada`.
          expect(["descriptiva", "pendiente"]).toContain(politica.clasificacion);
          expect(valor.titulo.length).toBeGreaterThan(0);
          if (politica.clasificacion === "pendiente") {
            expect(politica.decisionPendiente, `${politica.campo} sin decisión escrita`).toBeTruthy();
          }
        }
      }
    }
  });
});

describe("catálogo de políticas operativas — aplicada contra el consumidor real", () => {
  const aplicadas = CATALOGO_OPERATIVO.filter((p) => p.clasificacion === "aplicada");

  it("cubre los umbrales que el código sí lee y los controles de C16.2", () => {
    expect(aplicadas.map((p) => p.campo).sort()).toEqual([
      "courtesyWasteMonthlyCapCents",
      "doubleApprovalThresholdCents",
      "emergencyPurchaseCapCents",
      "managerAuthLimitCents",
      "purchase_delegation_rules",
    ]);
  });

  it("cada política aplicada nombra un consumidor con archivo y símbolo", () => {
    for (const politica of aplicadas) {
      expect(politica.consumidor, `${politica.campo} sin consumidor`).not.toBeNull();
      expect(politica.consumidor!.archivo).toMatch(/^(lib|app|components)\//);
      expect(politica.consumidor!.simbolo.length).toBeGreaterThan(0);
      expect(politica.consumidor!.decide.length).toBeGreaterThan(10);
      expect(politica.consumidores?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("el consumidor declarado existe y contiene el símbolo que el catálogo dice", () => {
    for (const politica of aplicadas) {
      for (const consumidor of [politica.consumidor!, ...(politica.consumidores ?? [])]) {
        let fuente: string;
        try {
          fuente = leer(consumidor.archivo);
        } catch {
          throw new Error(
            `${politica.campo}: el consumidor declarado ${consumidor.archivo} no existe en el repositorio`,
          );
        }
        expect(
          menciona(fuente, consumidor.simbolo),
          `${politica.campo} declara ${consumidor.simbolo} en ${consumidor.archivo}, pero ese símbolo no aparece ahí`,
        ).toBe(true);
      }
    }
  });

  it("el símbolo principal existe de verdad, no sólo como texto en un comentario", () => {
    // Un comentario que nombra una función es exactamente el defecto de H04:
    // el encabezado de `tenant-config-service` anunciaba consumidores que
    // nadie tenía. El consumidor principal tiene que declarar su símbolo; los
    // secundarios son puntos de uso y sólo basta con que lo mencionen.
    for (const politica of aplicadas) {
      const consumidor = politica.consumidor!;
      const fuente = leer(consumidor.archivo);
      const declarado = new RegExp(
        `(export\\s+(async\\s+)?(function|const|class)\\s+${consumidor.simbolo}\\b)` +
          `|(export\\s*\\{[^}]*\\b${consumidor.simbolo}\\b[^}]*\\})` +
          `|(const|let|var)\\s+${consumidor.simbolo}\\b`,
      );
      expect(
        declarado.test(fuente),
        `${consumidor.archivo} menciona ${consumidor.simbolo} pero no lo declara`,
      ).toBe(true);
    }
  });
});

describe("catálogo de políticas operativas — descriptiva contra la ausencia de consumidor", () => {
  const descriptivas = CATALOGO_OPERATIVO.filter((p) => p.clasificacion === "descriptiva");

  it("son las cinco dimensiones sin consumidor y el límite de caja chica", () => {
    // `managerAutonomy` y `tenantType` no entran aquí: son pendientes, porque
    // sí hay un consumidor o un atributo que los podría leer.
    expect(descriptivas.map((p) => p.campo).sort()).toEqual([
      "foodProduction",
      "payrollDispersion",
      "pettyCashLimitCents",
      "purchasingStructure",
      "supplierPayment",
      "treasuryModel",
    ].sort());
  });

  it("nadie fuera de esquema, API, formulario y semillas lee su valor", () => {
    // La prueba que re-descubre H04. Si alguien conecta una de estas políticas,
    // esta prueba falla y obliga a cambiar la clasificación a "aplicada"
    // declarando el consumidor.
    for (const politica of descriptivas) {
      const infractores = FUENTES_CODIGO.filter(({ fuente }) =>
        menciona(fuente, politica.campo),
      );
      const relativos = infractores.map(({ relativa }) => relativa);
      expect(
        relativos,
        `${politica.campo} está clasificada como descriptiva pero se lee en: ${relativos.join(", ")}`,
      ).toEqual([]);
    }
  });

  it("declara explícitamente que no hay consumidor", () => {
    for (const politica of descriptivas) {
      expect(politica.consumidor).toBeNull();
      expect(politica.consumidores).toBeUndefined();
      expect(politica.aplicacion).toMatch(/ningún|ninguno|no lee|se lee al abrir/i);
    }
  });

  it("el detector no es vacuo: encuentra los valores que sí se leen", () => {
    // Sin este control, «nadie lee purchasingStructure» pasaría igual con un
    // escáner roto. Los dos parámetros de abajo sí tienen consumidor fuera de
    // las rutas exentas, así que tienen que aparecer.
    for (const campo of ["vatRatePercent", "managerAuthLimitCents", "doubleApprovalThresholdCents"]) {
      const encontrados = FUENTES_CODIGO.filter(({ fuente }) =>
        menciona(fuente, campo),
      );
      expect(
        encontrados.length,
        `${campo} debería tener consumidores y el escáner no encontró ninguno: la prueba de ausencia no probaría nada`,
      ).toBeGreaterThan(0);
    }
  });
});

describe("catálogo de políticas operativas — pendientes", () => {
  const pendientes = CATALOGO_OPERATIVO.filter((p) => p.clasificacion === "pendiente");

  it("cada pendiente dice qué decisión falta", () => {
    for (const politica of pendientes) {
      expect(politica.decisionPendiente, `${politica.campo} sin decisión escrita`).toBeTruthy();
      expect(politica.decisionPendiente!.length).toBeGreaterThan(60);
      expect(politica.consumidor).toBeNull();
    }
  });

  it("registra una decisión para cada dimensión y caja chica", () => {
    expect(politicasConDecisionPendiente().map((p) => p.campo).sort()).toEqual([
      "purchasingStructure", "foodProduction", "treasuryModel", "supplierPayment",
      "managerAutonomy", "payrollDispersion", "tenantType", "pettyCashLimitCents",
    ].sort());
  });
  it("ninguna pendiente bloquea una política que sí se aplica hoy", () => {
    // El criterio de C15: las decisiones abiertas se registran por dimensión y
    // no impiden que las políticas definidas sigan valiendo.
    const aplicadas = CATALOGO_OPERATIVO.filter((p) => p.clasificacion === "aplicada");
    const pendientes = politicasConDecisionPendiente().map((p) => p.campo);
    for (const aplicada of aplicadas) {
      expect(pendientes).not.toContain(aplicada.campo);
      expect(aplicada.decisionPendiente).toBeUndefined();
    }
  });
});

describe("catálogo de políticas operativas — los valores que la pantalla ofrece", () => {
  const ruta = "app/api/company/operating-config/route.ts";

  it("el PUT acepta exactamente los valores que el catálogo documenta", () => {
    const fuente = leer(ruta);
    for (const politica of CATALOGO_OPERATIVO.filter((p) => p.seccion === "dimension")) {
      const enumDelPut = fuente.match(new RegExp(`${politica.campo}:\\s*z\\.enum\\(\\[([^\\]]+)\\]`));
      expect(enumDelPut, `el PUT no declara ${politica.campo}`).not.toBeNull();
      const aceptados = enumDelPut![1]
        .split(",")
        .map((v) => v.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
      expect(aceptados.sort()).toEqual(politica.valores.map((v) => v.valor).sort());
    }
  });

  it("el esquema de la base declara los mismos valores", () => {
    const fuente = leer("lib/db/schema.ts");
    for (const politica of CATALOGO_OPERATIVO.filter((p) => p.seccion === "dimension")) {
      const columna = fuente.match(
        new RegExp(`${politica.campo}:\\s*\\w+Enum\\("[^"]+"\\)\\.notNull\\(\\)`),
      );
      expect(columna, `lib/db/schema.ts no declara la columna ${politica.campo}`).not.toBeNull();
    }
    const enumDeCompras = fuente.match(
      /purchasingStructureEnum\s*=\s*pgEnum\("purchasing_structure",\s*\[([^\]]+)\]/,
    );
    expect(enumDeCompras).not.toBeNull();
    const valoresDelEnum = enumDeCompras![1]
      .split(",")
      .map((v) => v.trim().replace(/^['"]|['"]$/g, ""))
      .filter(Boolean);
    expect(valoresDelEnum.sort()).toEqual(
      politicaPorCampo("purchasingStructure")!.valores.map((v) => v.valor).sort(),
    );
  });

  it("el formulario guarda cada input contra el campo que el catálogo declara", () => {
    const fuente = leer("lib/company/operating-config-values.ts");
    for (const politica of CATALOGO_OPERATIVO.filter((p) => p.seccion !== "control")) {
      // El mapeo de ida y vuelta usa el nombre del input para los umbrales y
      // el de la columna para las dimensiones; los dos tienen que aparecer.
      expect(
        menciona(fuente, politica.input) || menciona(fuente, politica.campo),
        `${politica.campo} no aparece en el mapeo del formulario`,
      ).toBe(true);
    }
  });

  it("los umbrales del catálogo son los que el formulario envía", () => {
    const fuente = leer("components/company/operating-config-form.tsx");
    for (const politica of CATALOGO_OPERATIVO.filter((p) => p.seccion === "umbral")) {
      expect(
        menciona(fuente, `${politica.campo}: "${politica.input}"`),
        `el formulario no mapea ${politica.campo} → ${politica.input}`,
      ).toBe(true);
    }
  });
});

describe("catálogo de políticas operativas — parámetros de C14 y resumen", () => {
  it("los cuatro parámetros de C14 nombran un consumidor real", () => {
    for (const parametro of PARAMETROS_CONSUMIDOS) {
      const match = parametro.consumidor.match(/^(\w+)\s+\(([^)]+)\)$/);
      expect(match, `consumidor de ${parametro.campo} con formato inesperado`).not.toBeNull();
      const [, simbolo, archivo] = match!;
      expect(
        menciona(leer(archivo), simbolo),
        `${parametro.campo}: ${archivo} no menciona ${simbolo}`,
      ).toBe(true);
    }
  });

  it("el resumen cuenta lo que la pantalla declara", () => {
    const resumen = resumenDePoliticas();
    const total = Object.values(resumen).reduce((a, b) => a + b, 0);
    expect(total).toBe(CATALOGO_OPERATIVO.length);
    expect(resumen.aplicada).toBe(5);
    expect(resumen.descriptiva).toBe(6);
    expect(resumen.pendiente).toBe(2);
  });

  it("cada clasificación tiene etiqueta y explicación para la pantalla", () => {
    for (const clasificacion of ["aplicada", "descriptiva", "pendiente"] as const) {
      expect(ETIQUETA_CLASIFICACION[clasificacion].length).toBeGreaterThan(0);
      expect(EXPLICACION_CLASIFICACION[clasificacion].length).toBeGreaterThan(20);
    }
  });

  it("clasificacionDe responde por input y no falla con uno desconocido", () => {
    expect(clasificacionDe("managerAuthLimit")).toBe("aplicada");
    expect(clasificacionDe("pettyCashLimit")).toBe("descriptiva");
    expect(clasificacionDe("campoQueNoExiste")).toBe("descriptiva");
  });
});
