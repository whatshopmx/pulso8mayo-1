/**
 * Validación matemática de CLABE — paso 2 de
 * `docs/plan-cuentas-por-pagar-reconciliado.md`.
 *
 * Esto NO verifica titularidad: no dice que la cuenta sea del proveedor. En
 * México no existe un lookup público de nombre por CLABE; el único mecanismo
 * real es la prueba de centavo con el CEP de Banxico (paso 3 del plan). Lo que
 * esta capa hace es descartar el error honesto —un dígito mal tecleado, un
 * copy/paste truncado, un banco que no existe— antes de gastar una
 * transferencia de prueba y antes de que la CLABE entre a un lote de pago.
 *
 * Es local y gratis, así que corre SIEMPRE y primero.
 *
 * Estructura de una CLABE (18 dígitos):
 *
 *   012        180        01573865432        1
 *   ↑ banco    ↑ plaza    ↑ cuenta          ↑ dígito de control
 *   (3)        (3)        (11)               (1)
 */

/**
 * Catálogo de participantes de Banxico (código de 3 dígitos → nombre corto).
 *
 * Es una **fotografía**, no una fuente viva: Banxico da de alta y de baja
 * participantes (fusiones, nuevas instituciones de fondos de pago). Un código
 * legítimo pero ausente de aquí se rechaza con `UNKNOWN_BANK`, y el mensaje lo
 * dice explícitamente para que la falla se lea como "hay que actualizar el
 * catálogo" y no como "la CLABE está mal".
 *
 * Fuente para refrescarlo: catálogo de participantes del SPEI publicado por
 * Banxico (https://www.banxico.org.mx/cep/ → instituciones participantes).
 */
export const BANXICO_BANK_CODES: Readonly<Record<string, string>> = {
  // Banca múltiple
  "002": "BANAMEX",
  "006": "BANCOMEXT",
  "009": "BANOBRAS",
  "012": "BBVA MEXICO",
  "014": "SANTANDER",
  "019": "BANJERCITO",
  "021": "HSBC",
  "030": "BAJIO",
  "036": "INBURSA",
  "042": "MIFEL",
  "044": "SCOTIABANK",
  "058": "BANREGIO",
  "059": "INVEX",
  "060": "BANSI",
  "062": "AFIRME",
  "072": "BANORTE",
  "102": "THE ROYAL BANK",
  "103": "AMERICAN EXPRESS",
  "106": "BANK OF AMERICA",
  "108": "MUFG",
  "110": "JP MORGAN",
  "112": "BMONEX",
  "113": "VE POR MAS",
  "127": "AZTECA",
  "128": "AUTOFIN",
  "129": "BARCLAYS",
  "130": "COMPARTAMOS",
  "132": "MULTIVA BANCO",
  "133": "ACTINVER",
  "135": "NAFIN",
  "136": "INTERCAM BANCO",
  "137": "BANCOPPEL",
  "138": "ABC CAPITAL",
  "140": "CONSUBANCO",
  "141": "VOLKSWAGEN",
  "143": "CIBANCO",
  "145": "BBASE",
  "147": "BANKAOOL",
  "148": "PAGATODO",
  "150": "INMOBILIARIO",
  "151": "DONDE",
  "152": "BANCREA",
  "154": "FINTERRA",
  "155": "ICBC",
  "156": "SABADELL",
  "157": "SHINHAN",
  "158": "MIZUHO BANK",
  "159": "BANK OF CHINA",
  "160": "BANCO S3",
  "166": "BANCO DEL BIENESTAR",
  "168": "HIPOTECARIA FEDERAL",
  // Casas de bolsa, SOFIPOS e instituciones de fondos de pago que reciben SPEI
  "600": "MONEXCB",
  "601": "GBM",
  "602": "MASARI",
  "605": "VALUE",
  "608": "VECTOR",
  "610": "B&B",
  "614": "ACCIVAL",
  "615": "MERRILL LYNCH",
  "616": "FINAMEX",
  "617": "VALMEX",
  "618": "UNICA",
  "619": "MAPFRE",
  "620": "PROFUTURO",
  "621": "CB ACTINVER",
  "622": "OACTIN",
  "623": "SKANDIA",
  "626": "CBDEUTSCHE",
  "627": "ZURICH",
  "628": "ZURICHVI",
  "629": "SU CASITA",
  "630": "CB INTERCAM",
  "631": "CI BOLSA",
  "632": "BULLTICK CB",
  "633": "STERLING",
  "634": "FINCOMUN",
  "636": "HDI SEGUROS",
  "637": "ORDER",
  "638": "AKALA",
  "640": "CB JPMORGAN",
  "642": "REFORMA",
  "646": "STP",
  "647": "TELECOMM",
  "648": "EVERCORE",
  "649": "SKANDIA",
  "651": "SEGMTY",
  "652": "ASEA",
  "653": "KUSPIT",
  "655": "SOFIEXPRESS",
  "656": "UNAGRA",
  "659": "OPCIONES EMPRESARIALES DEL NOROESTE",
  "670": "LIBERTAD",
  "677": "CAJA POPULAR MEXICANA",
  "706": "ARCUS",
  "710": "NVIO",
  "722": "MERCADO PAGO W",
  "723": "CUENCA",
  "728": "SPIN BY OXXO",
  "901": "CLS",
  "902": "INDEVAL",
};

/** Por qué se rechazó una CLABE. Cada código es una causa distinta de arreglo. */
export type ClabeErrorCode =
  | "EMPTY"
  | "NON_NUMERIC"
  | "BAD_LENGTH"
  | "BAD_CHECK_DIGIT"
  | "UNKNOWN_BANK";

export interface ClabeValid {
  ok: true;
  /** 18 dígitos, ya normalizados (sin espacios ni guiones). */
  clabe: string;
  bankCode: string;
  bankName: string;
  plazaCode: string;
  accountNumber: string;
  checkDigit: number;
  /** Últimos 4 dígitos — lo único que se muestra en pantalla. */
  last4: string;
}

export interface ClabeInvalid {
  ok: false;
  code: ClabeErrorCode;
  /** Mensaje en español, listo para mostrar a quien capturó. */
  message: string;
}

export type ClabeValidation = ClabeValid | ClabeInvalid;

/**
 * Pesos del dígito de control, aplicados a los 17 dígitos iniciales.
 * El patrón 3-7-1 se repite; es la especificación de Banxico, no una elección.
 */
const CHECK_DIGIT_WEIGHTS = [3, 7, 1] as const;

/**
 * Quita todo lo que no sea dígito. Una CLABE se copia de un correo, de un PDF o
 * de WhatsApp, y llega con espacios, guiones o saltos de línea; eso es ruido de
 * transporte, no un error de captura, y rechazarlo solo entrena a la gente a
 * pelearse con el formulario.
 */
export function normalizeClabe(raw: string): string {
  return raw.replace(/[\s-]/g, "");
}

/**
 * Dígito de control de Banxico para los 17 primeros dígitos.
 *
 * Se suma `(dígito × peso) mod 10` —el módulo va **por término**, no al final—
 * y el control es el complemento a 10 de la suma.
 */
export function computeClabeCheckDigit(first17: string): number {
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const digit = first17.charCodeAt(i) - 48; // '0' = 48
    sum += (digit * CHECK_DIGIT_WEIGHTS[i % 3]) % 10;
  }
  return (10 - (sum % 10)) % 10;
}

/** ¿El código de 3 dígitos corresponde a un participante conocido? */
export function bankNameForCode(bankCode: string): string | null {
  return BANXICO_BANK_CODES[bankCode] ?? null;
}

/**
 * Valida una CLABE: longitud, dígito de control de Banxico y banco registrado.
 *
 * Lo que NO valida, a propósito:
 *
 * - **La plaza.** Son cientos de claves que Banxico da de alta y de baja, sin
 *   una fuente estable para embeberlas, y no tengo forma de afirmar que ningún
 *   participante legítimo use una clave que yo consideraría inválida. El costo
 *   de los dos errores no es simétrico: una plaza rechazada por error **bloquea
 *   el pago de un proveedor real sin salida**, mientras que una plaza mala que
 *   pase la rebota el banco al liquidar, con aviso y sin dinero perdido. Ante la
 *   duda, no se rechaza. `plazaCode` se devuelve para quien lo necesite (el
 *   layout bancario del paso 7), pero no condiciona el resultado.
 * - **La titularidad.** Es el paso 3 (CEP de Banxico). Que esta función diga
 *   `ok` no autoriza pagarle a nadie.
 *
 * Con eso, la validación es exactamente la que pide el plan §5 —dígito
 * verificador + banco registrado— y ni una regla más de la que pueda sostener.
 */
export function validateClabe(raw: string | null | undefined): ClabeValidation {
  if (!raw || !raw.trim()) {
    return { ok: false, code: "EMPTY", message: "La CLABE es obligatoria." };
  }

  const clabe = normalizeClabe(raw.trim());

  if (!/^\d+$/.test(clabe)) {
    return {
      ok: false,
      code: "NON_NUMERIC",
      message: "La CLABE solo puede contener dígitos.",
    };
  }

  if (clabe.length !== 18) {
    return {
      ok: false,
      code: "BAD_LENGTH",
      message: `La CLABE debe tener 18 dígitos; se capturaron ${clabe.length}.`,
    };
  }

  const bankCode = clabe.slice(0, 3);
  const plazaCode = clabe.slice(3, 6);
  const accountNumber = clabe.slice(6, 17);
  const checkDigit = Number(clabe[17]);

  // El dígito de control va primero: es la prueba más fuerte y la que detecta
  // el error real (un dígito transpuesto). Un banco desconocido puede ser
  // catálogo viejo; un control malo no puede ser nada más que una CLABE mala.
  const expected = computeClabeCheckDigit(clabe.slice(0, 17));
  if (checkDigit !== expected) {
    return {
      ok: false,
      code: "BAD_CHECK_DIGIT",
      message:
        "La CLABE no pasa el dígito verificador de Banxico. " +
        "Hay al menos un dígito mal capturado — vuelve a copiarla del estado " +
        "de cuenta del proveedor.",
    };
  }

  const bankName = bankNameForCode(bankCode);
  if (!bankName) {
    return {
      ok: false,
      code: "UNKNOWN_BANK",
      message:
        `El código de banco ${bankCode} no está en el catálogo de participantes ` +
        `de Banxico que conoce el sistema. Si el banco es real y reciente, hay ` +
        `que actualizar el catálogo en lib/banking/clabe.ts.`,
    };
  }

  return {
    ok: true,
    clabe,
    bankCode,
    bankName,
    plazaCode,
    accountNumber,
    checkDigit,
    last4: clabe.slice(-4),
  };
}
