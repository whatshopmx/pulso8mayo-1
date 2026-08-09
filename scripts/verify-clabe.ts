/**
 * Verificación del validador de CLABE (`lib/banking/clabe.ts`).
 *
 *   npx tsx scripts/verify-clabe.ts
 *
 * No es un spec de Playwright: `tests/` es un arnés de e2e con navegador y base
 * de datos, y `validateClabe` es una función pura que no necesita ninguno de los
 * dos. Levantar un dev server para probar aritmética sería la razón por la que
 * después nadie la corre.
 *
 * Sale con código 1 si algún vector falla, así que sirve tal cual en un hook de
 * pre-commit o en CI.
 */
import { validateClabe, computeClabeCheckDigit } from "@/lib/banking/clabe";

interface Vector {
  clabe: string;
  /** `true` = debe pasar; si no, el código de error esperado. */
  expect: true | string;
  why: string;
}

const VECTORS: Vector[] = [
  {
    clabe: "002010077777777771",
    expect: true,
    why: "Vector documentado de Banxico (BANAMEX). Si éste falla, el algoritmo del dígito de control está mal.",
  },
  {
    clabe: "0020 1007 7777 7777 71",
    expect: true,
    why: "Misma CLABE en grupos de 4: se copia de correos y PDFs, y el ruido de transporte no es un error de captura.",
  },
  {
    clabe: "0020-1007-7777-7777-71",
    expect: true,
    why: "Misma CLABE con guiones.",
  },
  {
    clabe: "002010077777777772",
    expect: "BAD_CHECK_DIGIT",
    why: "Último dígito alterado. Es el caso que justifica todo el módulo.",
  },
  {
    clabe: "002010077777777717",
    expect: "BAD_CHECK_DIGIT",
    why: "Dos dígitos transpuestos — el error humano más común, y el que un simple chequeo de longitud no detecta.",
  },
  {
    clabe: "012180015738654321",
    expect: "BAD_CHECK_DIGIT",
    why: "CLABE de scripts/seed-02-hr-profiles.ts: los datos de demo son inventados y NO pasan validación. Recordatorio de no reusarlos como fixtures.",
  },
  {
    clabe: "00201007777777777",
    expect: "BAD_LENGTH",
    why: "17 dígitos: copy/paste truncado.",
  },
  {
    clabe: "00201007777777777X",
    expect: "NON_NUMERIC",
    why: "Una CLABE no tiene letras.",
  },
  {
    clabe: "999010077777777774",
    expect: "UNKNOWN_BANK",
    why: "Dígito de control válido pero banco 999 inexistente. La validación aritmética sola no lo atrapa.",
  },
  {
    clabe: "002000077777777778",
    expect: true,
    why: "Plaza 000. Se acepta a propósito: el validador no juzga la plaza (ver lib/banking/clabe.ts). Rechazarla bloquearía un pago legítimo sin salida si algún participante la usa.",
  },
  {
    clabe: "",
    expect: "EMPTY",
    why: "Campo vacío.",
  },
];

let failures = 0;

for (const v of VECTORS) {
  const result = validateClabe(v.clabe);
  const actual = result.ok === true ? true : result.code;
  const pass = actual === v.expect;
  if (!pass) failures++;
  console.log(
    `${pass ? "✓" : "✗"} ${JSON.stringify(v.clabe).padEnd(24)} ` +
      `esperado=${String(v.expect).padEnd(16)} obtenido=${String(actual)}`,
  );
  if (!pass) console.log(`    ${v.why}`);
}

// El dígito de control es una función total: para cualquier prefijo de 17
// dígitos existe exactamente un dígito que cierra la CLABE. Se comprueba que
// completar un prefijo arbitrario siempre produzca una CLABE que pase, lo que
// descarta que la validación acepte por casualidad.
const PREFIXES = [
  "01218001573865432",
  "07200001234567890",
  "64600011122233344",
  "00200000000000000",
];
for (const prefix of PREFIXES) {
  const completed = prefix + String(computeClabeCheckDigit(prefix));
  const result = validateClabe(completed);
  const pass = result.ok === true;
  if (!pass) failures++;
  console.log(
    `${pass ? "✓" : "✗"} completar ${prefix} → ${completed} ` +
      `${pass ? "" : `(${!result.ok ? result.code : ""})`}`,
  );
}

console.log(
  failures === 0
    ? `\n${VECTORS.length + PREFIXES.length} vectores OK.`
    : `\n${failures} vector(es) fallaron.`,
);
process.exit(failures === 0 ? 0 : 1);
