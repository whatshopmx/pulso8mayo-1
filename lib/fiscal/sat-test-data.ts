// Catálogo oficial de personas de prueba del SAT para facturación en el
// ambiente de pruebas de FiscalAPI (docs.fiscalapi.com/testing-data).
//
// El SAT obliga a usar estas personas —sus datos fiscales y sus CSD— al
// timbrar en pruebas. Cada RFC tiene su propio par de certificados: firmar
// con el CSD de otro RFC hace que el SAT rechace el comprobante, por eso la
// resolución del emisor siempre va emparejada a su CSD.
//
// Los archivos viven en tests/fixtures/fiscalapi-certs/<RFC>/csds.{cer,key}
// (extraídos del zip oficial "Certificados_Pruebas"). Contraseña pública:
// 12345678a.

import fs from "fs";
import path from "path";

export interface SatTestPerson {
  tin: string;
  legalName: string;
  zipCode: string;
  taxRegimeCode: string;
}

const MORAL_REGIME = "601"; // General de Ley Personas Morales
const FISICA_REGIME = "612"; // Actividades económicas (persona física con negocio)

/** Personas morales de prueba (proveedores corporativos). */
export const SAT_TEST_MORALES: SatTestPerson[] = [
  { tin: "EKU9003173C9", legalName: "ESCUELA KEMPER URGATE", zipCode: "42501", taxRegimeCode: MORAL_REGIME },
  { tin: "IIA040805DZ4", legalName: "INDISTRIA ILUMINADORA DE ALMACENES", zipCode: "62661", taxRegimeCode: MORAL_REGIME },
  { tin: "H&E951128469", legalName: "HERRERIA & ELECTRICOS", zipCode: "06002", taxRegimeCode: MORAL_REGIME },
  { tin: "IVD920810GU2", legalName: "INNOVACION VALOR Y DESARROLLO", zipCode: "63901", taxRegimeCode: MORAL_REGIME },
  { tin: "IXS7607092R5", legalName: "INTERNACIONAL XIMBO Y SABORES", zipCode: "23004", taxRegimeCode: MORAL_REGIME },
  { tin: "JES900109Q90", legalName: "JIMENEZ ESTRADA SALAS", zipCode: "37161", taxRegimeCode: MORAL_REGIME },
  { tin: "KIJ0906199R1", legalName: "KERNEL INDUSTIA JUGUETERA", zipCode: "28971", taxRegimeCode: MORAL_REGIME },
  { tin: "L&O950913MSA", legalName: "LUCES & OBRAS", zipCode: "60922", taxRegimeCode: MORAL_REGIME },
  { tin: "OÑO120726RX3", legalName: "ORGANICOS ÑAVEZ OSORIO", zipCode: "40501", taxRegimeCode: MORAL_REGIME },
  { tin: "S&S051221SE2", legalName: "S & SOFTWARE", zipCode: "76022", taxRegimeCode: MORAL_REGIME },
  { tin: "URE180429TM6", legalName: "UNIVERSIDAD ROBOTICA ESPAÑOLA", zipCode: "86991", taxRegimeCode: MORAL_REGIME },
  { tin: "XIA190128J61", legalName: "XENON INDUSTRIAL ARTICLES", zipCode: "76343", taxRegimeCode: MORAL_REGIME },
  { tin: "ZUÑ920208KL4", legalName: "ZAPATERIA URTADO ÑERI", zipCode: "34541", taxRegimeCode: MORAL_REGIME },
];

/** Personas físicas de prueba (proveedores pequeños: hielo, taxis, plomeros). */
export const SAT_TEST_FISICAS: SatTestPerson[] = [
  { tin: "CACX7605101P8", legalName: "XOCHILT CASAS CHAVEZ", zipCode: "36257", taxRegimeCode: FISICA_REGIME },
  { tin: "FUNK671228PH6", legalName: "KARLA FUENTE NOLASCO", zipCode: "01160", taxRegimeCode: FISICA_REGIME },
  { tin: "IAÑL750210963", legalName: "LUIS IAN ÑUZCO", zipCode: "85256", taxRegimeCode: FISICA_REGIME },
  { tin: "JUFA7608212V6", legalName: "ADRIANA JUAREZ FERNANDEZ", zipCode: "01160", taxRegimeCode: FISICA_REGIME },
  { tin: "KAHO641101B39", legalName: "OSCAR KALA HAAK", zipCode: "76074", taxRegimeCode: FISICA_REGIME },
  { tin: "KICR630120NX3", legalName: "RODRIGO KITIA CASTRO", zipCode: "36246", taxRegimeCode: FISICA_REGIME },
  { tin: "MISC491214B86", legalName: "CECILIA MIRANDA SANCHEZ", zipCode: "01010", taxRegimeCode: FISICA_REGIME },
  { tin: "RAQÑ7701212M3", legalName: "ÑEVES RAMIREZ QUEZADA", zipCode: "78905", taxRegimeCode: FISICA_REGIME },
  { tin: "WATM640917J45", legalName: "MARIA WATEMBER TORRES", zipCode: "43543", taxRegimeCode: FISICA_REGIME },
  { tin: "WERX631016S30", legalName: "XAIME WEIR ROJO", zipCode: "01279", taxRegimeCode: FISICA_REGIME },
  { tin: "XAMA620210DQ5", legalName: "ALBA XKARAJAM MENDEZ", zipCode: "01219", taxRegimeCode: FISICA_REGIME },
  { tin: "XIQB891116QE4", legalName: "BERENICE XIMO QUEZADA", zipCode: "40968", taxRegimeCode: FISICA_REGIME },
  { tin: "XOJI740919U48", legalName: "INGRID XODAR JIMENEZ", zipCode: "76028", taxRegimeCode: FISICA_REGIME },
];

export const SAT_TEST_PEOPLE: ReadonlyMap<string, SatTestPerson> = new Map(
  [...SAT_TEST_MORALES, ...SAT_TEST_FISICAS].map((p) => [p.tin.toUpperCase(), p])
);

/**
 * Resuelve una persona de prueba por RFC (insensible a mayúsculas y espacios,
 * que es como suelen vivir los taxId capturados a mano).
 */
export function resolveTestPerson(tin: string | null | undefined): SatTestPerson | null {
  if (!tin) return null;
  return SAT_TEST_PEOPLE.get(tin.trim().toUpperCase()) ?? null;
}

const CERTS_ROOT = path.join(process.cwd(), "tests", "fixtures", "fiscalapi-certs");
export const TEST_CSD_PASSWORD = "12345678a";

export interface TaxCredentialPayload {
  base64File: string;
  fileType: number; // 0 = certificado .cer, 1 = llave privada .key
  password: string;
}

const csdCache = new Map<string, TaxCredentialPayload[]>();

/**
 * Par CSD (.cer/.key en base64) **del RFC solicitado**, tal como lo espera
 * `issuer.taxCredentials` en el modo por valores. Con caché en memoria: el
 * mismo proveedor no relee disco en cada timbrado. Lanza si faltan archivos.
 */
export function loadCsdForTin(tin: string): TaxCredentialPayload[] {
  const key = tin.trim().toUpperCase();
  const cached = csdCache.get(key);
  if (cached) return cached;

  const dir = path.join(CERTS_ROOT, key);
  const cerPath = path.join(dir, "csds.cer");
  const keyPath = path.join(dir, "csds.key");

  for (const p of [cerPath, keyPath]) {
    if (!fs.existsSync(p)) {
      throw new Error(
        `Falta el CSD de prueba ${p}. Extrae el zip Certificados_Pruebas de ` +
          "https://docs.fiscalapi.com/testing-data hacia tests/fixtures/fiscalapi-certs/."
      );
    }
  }

  const creds: TaxCredentialPayload[] = [
    { base64File: fs.readFileSync(cerPath).toString("base64"), fileType: 0, password: TEST_CSD_PASSWORD },
    { base64File: fs.readFileSync(keyPath).toString("base64"), fileType: 1, password: TEST_CSD_PASSWORD },
  ];
  csdCache.set(key, creds);
  return creds;
}
