/**
 * Catálogo de políticas operativas (C15).
 *
 * Un solo lugar que dice, campo por campo, **qué pasa hoy cuando un operador
 * cambia este valor**. La auditoría H04 encontró que las siete dimensiones se
 * guardaban y se describían como si gobernaran la operación, sin que ningún
 * servicio las leyera. El arreglo no es escribir la intención —que ya estaba
 * escrita en la pantalla— sino separar lo que el código hace de lo que el
 * operador imagina, y decirlo sin ambigüedad.
 *
 * Tres clasificaciones, y son excluyentes:
 *
 * - `aplicada` — hay un consumidor que lee el valor y cambia una decisión. El
 *   caso dado/cuando/entonces es comprobable porque lo produce una función.
 * - `descriptiva` — el valor se guarda y se muestra, y ningún código lo lee
 *   para decidir. No es un error: es la definición de "documenta tu
 *   operación". Lo que no puede es prometer un efecto.
 * - `pendiente` — hay consumidor o atributo que lo podría leer y la decisión de
 *   qué debe pasar no está tomada. Se registra el bloqueo en vez de elegir una
 *   lectura que nadie autorizó.
 *
 * **Por qué vive aquí y no en el componente.** La sección de dimensiones
 * repetía en JSX el mismo texto de efecto que el catálogo debe verificar. Con el
 * catálogo fuera, la prueba de C15 puede recorrerlo, contar clasificaciones y
 * detectar referencias que requieren revisar la clasificación. La comprobación
 * estática ayuda a mantener el catálogo; no demuestra por sí sola el efecto ni
 * detecta todos los accesos dinámicos.
 *
 * Sin React ni Drizzle a propósito: lo importan el cliente y las pruebas.
 */

/**
 * `aplicada` y `descriptiva` son hechos sobre el código de hoy. `pendiente` es
 * un hecho sobre una decisión que falta, y por eso la clasificación por sí sola
 * no basta: la política que está pendiente dice *qué* decisión falta.
 */
export type ClasificacionPolitica = "aplicada" | "descriptiva" | "pendiente";

export interface CasoContrato {
  dado: string;
  cuando: string;
  entonces: string;
}

/** Consumidor real: archivo + símbolo. La prueba de C15 lo busca en el código. */
export interface ConsumidorDeclarado {
  /** Ruta relativa a la raíz del repo. */
  archivo: string;
  /** Símbolo exportado que recibe el valor. */
  simbolo: string;
  /** Qué decide, en una frase. */
  decide: string;
}

export interface ValorContrato {
  /** Valor del enum, o el estado del campo (`null`, `0`, `> 0`). */
  valor: string;
  /** Lo que el valor describe del negocio. */
  titulo: string;
  /**
   * Comportamiento comprobable. `null` significa **descriptivo**: el valor se
   * guarda y se muestra, y nada más. Es la respuesta honesta cuando el
   * consumidor no existe.
   */
  caso: CasoContrato | null;
}

export interface PoliticaOperativa {
  /** Columna en `tenant_operating_config` (o `companies` para cortesías). */
  campo: string;
  /** `id` del input que lo captura, para que la UI no adivine. */
  input: string;
  seccion: "dimension" | "umbral";
  grupo: string;
  etiqueta: string;
  /** Unidad en la que se captura y en la que se guarda. */
  unidad: string;
  /** Dónde vive el valor: grupo, sucursal o por documento. */
  alcance: string;
  /** Permiso que hace falta para cambiarlo. */
  permiso: string;
  clasificacion: ClasificacionPolitica;
  /** Presente sólo si `clasificacion === "aplicada"`. */
  consumidor: ConsumidorDeclarado | null;
  /** Todos los consumidores, cuando hay más de uno. */
  consumidores?: ConsumidorDeclarado[];
  /** Cuándo se lee el valor. */
  aplicacion: string;
  /** Qué queda fuera del valor. */
  excepciones: string;
  /** Qué significa el estado vacío, que no es un cero. */
  vacio: string;
  valores: ValorContrato[];
  /**
   * La decisión de negocio que falta. No bloquea las políticas ya aplicadas:
   * se escribe por dimensión para que C16–C23 la resuelvan una por una.
   */
  decisionPendiente?: string;
}

/**
 * Las siete dimensiones + los cinco umbrales monetarios de la pantalla.
 *
 * El orden es el de la pantalla: operador y alimentos, tesorería, gobernanza,
 * y después los umbrales que sí tienen regla. Cada entrada se verificó contra
 * el consumidor que la lee —o contra la ausencia de consumidor— no contra el
 * nombre del campo.
 */
export const CATALOGO_OPERATIVO: PoliticaOperativa[] = [
  // ── Operación y alimentos ──────────────────────────────────────────────
  {
    campo: "purchasingStructure",
    input: "purchasingStructure",
    seccion: "dimension",
    grupo: "Operación y Alimentos",
    etiqueta: "Estructura de Compras",
    unidad: "Enum de 3 valores",
    alcance: "Grupo",
    permiso: "settings/update",
    clasificacion: "descriptiva",
    consumidor: null,
    aplicacion:
      "Se lee al abrir la pantalla de configuración, y en ningún otro lugar. " +
      "No hay un recorrido de compras que la consulte.",
    excepciones:
      "El tope mensual de compras de emergencia (`emergencyPurchaseCapCents`) " +
      "sí bloquea, pero no depende de esta dimensión: aplica igual con cualquiera de los tres valores.",
    vacio: "No aplica: la columna es `notNull` con default `CENTRALIZADA`.",
    valores: [
      {
        valor: "CENTRALIZADA",
        titulo: "Centralizada",
        caso: null,
      },
      {
        valor: "POR_SUCURSAL",
        titulo: "Por Sucursal",
        caso: null,
      },
      {
        valor: "HIBRIDO",
        titulo: "Híbrido",
        caso: null,
      },
    ],
    decisionPendiente:
      "Falta definir quién solicita, aprueba y emite compras en cada modalidad, " +
      "qué categorías puede comprar una sucursal y cómo se autorizan las emergencias.",
  },
  {
    campo: "foodProduction",
    input: "foodProduction",
    seccion: "dimension",
    grupo: "Operación y Alimentos",
    etiqueta: "Producción de Alimentos",
    unidad: "Enum de 3 valores",
    alcance: "Grupo",
    permiso: "settings/update",
    clasificacion: "descriptiva",
    consumidor: null,
    aplicacion:
      "Se lee al abrir la pantalla de configuración. Ningún servicio de producción, " +
      "recetas o inventario lee la columna.",
    excepciones:
      "El conteo de inventario genera merma automática con su propio umbral " +
      "(`mermaVarianceThresholdPct`), que no depende de esta dimensión.",
    vacio: "No aplica: la columna es `notNull` con default `IN_SITU`.",
    valores: [
      { valor: "IN_SITU", titulo: "In Situ", caso: null },
      { valor: "COCINA_CENTRAL", titulo: "Comisariato Central", caso: null },
      { valor: "MIXTO", titulo: "Mixto / Ensamble", caso: null },
    ],
    decisionPendiente:
      "Falta definir qué cocina abastece a cada sucursal, quién autoriza la producción " +
      "y qué movimientos registran el envío y la recepción sin duplicar inventario.",
  },

  // ── Tesorería y dispersión de pagos ─────────────────────────────────────
  {
    campo: "treasuryModel",
    input: "treasuryModel",
    seccion: "dimension",
    grupo: "Tesorería y Dispersión de Pagos",
    etiqueta: "Modelo de Tesorería",
    unidad: "Enum de 3 valores",
    alcance: "Grupo",
    permiso: "settings/update",
    clasificacion: "descriptiva",
    consumidor: null,
    aplicacion:
      "Se lee al abrir la pantalla de configuración. `treasury-service` modela " +
      "cuentas y saldos por documento, sin mirar esta columna.",
    excepciones:
      "Las operaciones de cuentas bancarias no leen esta dimensión.",
    vacio: "No aplica: la columna es `notNull` con default `CUENTA_UNICA`.",
    valores: [
      { valor: "CUENTA_UNICA", titulo: "Cuenta Única", caso: null },
      { valor: "CUENTA_POR_SUCURSAL", titulo: "Por Sucursal", caso: null },
      { valor: "MIXTO", titulo: "Mixto", caso: null },
    ],
    decisionPendiente:
      "Falta definir las cuentas permitidas por sucursal y quién puede preparar, " +
      "aprobar y liquidar pagos en cada modalidad, incluidas las excepciones.",
  },
  {
    campo: "supplierPayment",
    input: "supplierPayment",
    seccion: "dimension",
    grupo: "Tesorería y Dispersión de Pagos",
    etiqueta: "Pago a Proveedores",
    unidad: "Enum de 3 valores",
    alcance: "Grupo",
    permiso: "settings/update",
    clasificacion: "descriptiva",
    consumidor: null,
    aplicacion:
      "Se lee al abrir la pantalla de configuración. El método de pago de un " +
      "proveedor (`suppliers.payment_method`) es otra columna y otro dominio: " +
      "no se deduce de esta.",
    excepciones: "La modalidad del grupo no modifica el método de pago capturado del proveedor.",
    vacio: "No aplica: la columna es `notNull` con default `CENTRALIZADO`.",
    valores: [
      { valor: "CENTRALIZADO", titulo: "Centralizado", caso: null },
      { valor: "POR_SUCURSAL", titulo: "Por Sucursal", caso: null },
      { valor: "HIBRIDO", titulo: "Híbrido", caso: null },
    ],
    decisionPendiente:
      "Falta definir quién programa y aprueba cada pago, cómo se reparten las facturas " +
      "entre corporativo y sucursal, y cómo se evitan pagos duplicados.",
  },
  {
    campo: "payrollDispersion",
    input: "payrollDispersion",
    seccion: "dimension",
    grupo: "Tesorería y Dispersión de Pagos",
    etiqueta: "Dispersión de Nómina",
    unidad: "Enum de 3 valores",
    alcance: "Grupo",
    permiso: "settings/update",
    clasificacion: "descriptiva",
    consumidor: null,
    aplicacion:
      "Se lee al abrir la pantalla de configuración. Ningún módulo de nómina " +
      "—exportación, timbrado o dispersión— lee la columna.",
    excepciones:
      "Elegir una modalidad no agrupa corridas, exportaciones o recibos ni activa pagos automáticos.",
    vacio: "No aplica: la columna es `notNull` con default `CONSOLIDADA`.",
    valores: [
      { valor: "CONSOLIDADA", titulo: "Consolidada", caso: null },
      { valor: "POR_RAZON_SOCIAL", titulo: "Por Razón Social", caso: null },
      { valor: "MIXTO", titulo: "Mixto", caso: null },
    ],
    decisionPendiente:
      "Falta definir si la modalidad sólo describe la operación o agrupa una exportación " +
      "de nómina, por qué entidad legal y con qué responsables de aprobación.",
  },

  // ── Gobernanza ─────────────────────────────────────────────────────────
  {
    campo: "managerAutonomy",
    input: "managerAutonomy",
    seccion: "dimension",
    grupo: "Gobernanza y Estructura del Grupo",
    etiqueta: "Autonomía del Gerente de Sucursal",
    unidad: "Enum de 3 valores",
    alcance: "Grupo",
    permiso: "settings/update",
    clasificacion: "pendiente",
    consumidor: null,
    aplicacion:
      "La escalera de aprobación de gastos existe y funciona, pero se construye " +
      "sólo con `managerAuthLimitCents` y `doubleApprovalThresholdCents` " +
      "(`rolExigidoPorMonto`): el nivel de autonomía no participa en ella.",
    excepciones:
      "Los tres niveles comparten hoy exactamente el mismo comportamiento. " +
      "Elegir `ALTA` no amplía lo que el gerente puede aprobar.",
    vacio: "No aplica: la columna es `notNull` con default `MEDIA`.",
    valores: [
      { valor: "ALTA", titulo: "Alta", caso: null },
      { valor: "MEDIA", titulo: "Media", caso: null },
      { valor: "BAJA", titulo: "Baja", caso: null },
    ],
    decisionPendiente:
      "Falta definir qué compras y gastos puede decidir el gerente en cada nivel " +
      "y cómo se combina con los límites monetarios. Hoy elegir Alta, Media o Baja " +
      "no cambia sus permisos de aprobación.",
  },
  {
    campo: "tenantType",
    input: "tenantType",
    seccion: "dimension",
    grupo: "Gobernanza y Estructura del Grupo",
    etiqueta: "Tipo de Estructura de Tenant",
    unidad: "Enum de 2 valores",
    alcance: "Grupo",
    permiso: "settings/update",
    clasificacion: "pendiente",
    consumidor: null,
    aplicacion:
      "La aislación de franquicias sí existe y sí funciona, pero se decide por " +
      "sucursal con `branches.ownershipType` (`lib/rbac/abac.ts`, " +
      "`lib/rbac/branch-visibility.ts`). Esta columna de grupo no participa.",
    excepciones:
      "Un grupo con `GRUPO_PROPIO` puede tener sucursales marcadas como `FRANCHISE` " +
      "y la aislación se sigue aplicando: manda el atributo de la sucursal, no el de la empresa.",
    vacio: "No aplica: la columna es `notNull` con default `GRUPO_PROPIO`.",
    valores: [
      { valor: "GRUPO_PROPIO", titulo: "Grupo Propio", caso: null },
      { valor: "MIXTO_FRANQUICIAS", titulo: "Mixto con Franquiciatarios", caso: null },
    ],
    decisionPendiente:
      "Falta definir si este modelo asigna la propiedad de las sucursales nuevas " +
      "o sólo describe al grupo. Hoy la visibilidad se decide por la propiedad " +
      "capturada en cada sucursal; esta selección no la cambia.",
  },

  // ── Umbrales monetarios ────────────────────────────────────────────────
  {
    campo: "managerAuthLimitCents",
    input: "managerAuthLimit",
    seccion: "umbral",
    grupo: "Autorización de gastos",
    etiqueta: "Límite de Autonomía de Gerente",
    unidad: "Centavos (MXN); la pantalla captura pesos",
    alcance: "Grupo",
    permiso: "settings/update",
    clasificacion: "aplicada",
    consumidor: {
      archivo: "lib/expenses/approval-policy.ts",
      simbolo: "rolExigidoPorMonto",
      decide:
        "El rol mínimo que puede resolver un gasto cuando la empresa no tiene una " +
        "regla de autorización que cubra el monto.",
    },
    consumidores: [
      {
        archivo: "lib/expenses/approval-policy.ts",
        simbolo: "rolExigidoPorMonto",
        decide: "Rol exigido al resolver y al listar pendientes.",
      },
      {
        archivo: "lib/services/expense-service.ts",
        simbolo: "resolverRolExigido",
        decide: "Llama a la escalera al crear el gasto.",
      },
    ],
    aplicacion:
      "En cada alta de gasto y en cada lectura de la bandeja de pendientes, con el " +
      "valor vigente: este umbral no tiene vigencia por periodo.",
    excepciones:
      "Una regla de `expense_authorization_rules` que cubra el monto manda sobre este " +
      "umbral, y sobre él está la segregación de funciones: siempre lo resuelve " +
      "alguien distinto de quien lo registró, salvo `SUPER_ADMIN` y `OWNER`.",
    vacio: "`null` significa **sin tope**: el gerente alcanza para cualquier monto que no llegue al umbral del dueño.",
    valores: [
      {
        valor: "null",
        titulo: "Sin tope",
        caso: {
          dado: "el grupo vació el campo",
          cuando: "se resuelve un gasto que no tiene regla explícita y está por debajo del umbral del dueño",
          entonces: "lo autoriza un `GERENTE`: es la lectura literal de «sin tope»",
        },
      },
      {
        valor: "0",
        titulo: "Cero",
        caso: {
          dado: "el grupo guardó cero",
          cuando: "se resuelve cualquier gasto",
          entonces: "el gerente no alcanza ninguno y el rol exigido es `ADMIN`, salvo que el monto llegue al umbral del dueño",
        },
      },
      {
        valor: "> 0",
        titulo: "Con tope",
        caso: {
          dado: "el grupo fijó un monto",
          cuando: "el gasto queda por debajo de ese monto",
          entonces: "lo autoriza un `GERENTE`; a partir del monto, el rol exigido sube",
        },
      },
    ],
  },
  {
    campo: "doubleApprovalThresholdCents",
    input: "doubleApprovalThreshold",
    seccion: "umbral",
    grupo: "Autorización de gastos",
    etiqueta: "Umbral de Autorización de Dirección General",
    unidad: "Centavos (MXN); la pantalla captura pesos",
    alcance: "Grupo",
    permiso: "settings/update",
    clasificacion: "aplicada",
    consumidor: {
      archivo: "lib/expenses/approval-policy.ts",
      simbolo: "rolExigidoPorMonto",
      decide: "El monto desde el que la autoridad sube al dueño del grupo.",
    },
    consumidores: [
      {
        archivo: "lib/expenses/approval-policy.ts",
        simbolo: "rolExigidoPorMonto",
        decide: "Rol exigido al resolver y al listar pendientes.",
      },
      {
        archivo: "lib/services/control-interno-service.ts",
        simbolo: "umbralesDeAutorizacion",
        decide:
          "Añade un umbral positivo a la detección de fraccionamiento, junto con " +
          "los montos de las reglas capturadas.",
      },
    ],
    aplicacion:
      "En cada resolución de gasto y en cada revisión de control interno, con el valor vigente.",
    excepciones:
      "**No es doble firma.** El sistema tiene un aprobador por gasto; este umbral " +
      "elige a quién le toca, que es lo que el producto puede cumplir hoy. " +
      "Las reglas de autorización capturadas mandan sobre él.",
    vacio: "`null` significa **sin tope**: ningún monto escala al dueño por esta vía.",
    valores: [
      {
        valor: "null",
        titulo: "Sin tope",
        caso: {
          dado: "el grupo vació el campo",
          cuando: "se resuelve un gasto de cualquier monto",
          entonces: "nadie escala al dueño por monto: el rol lo decide el otro umbral o la regla",
        },
      },
      {
        valor: "0",
        titulo: "Cero",
        caso: {
          dado: "el grupo guardó cero",
          cuando: "se resuelve cualquier gasto",
          entonces: "sin una regla explícita para el monto, todo gasto no negativo exige `OWNER`",
        },
      },
      {
        valor: "> 0",
        titulo: "Con umbral",
        caso: {
          dado: "el grupo fijó un monto",
          cuando: "el gasto llega a ese monto",
          entonces: "el rol exigido pasa a `OWNER` y deja de alcanzar un gerente o un administrador",
        },
      },
    ],
  },
  {
    campo: "emergencyPurchaseCapCents",
    input: "emergencyCap",
    seccion: "umbral",
    grupo: "Autorización de gastos",
    etiqueta: "Tope Mensual de Compras de Emergencia",
    unidad: "Centavos (MXN) por sucursal y mes; la pantalla captura pesos",
    alcance: "Grupo, atribuido por sucursal y mes",
    permiso: "settings/update",
    clasificacion: "aplicada",
    consumidor: {
      archivo: "lib/services/budget-service.ts",
      simbolo: "validateEmergencyCap",
      decide: "Si una compra de urgencia cabe en el acumulado mensual de la sucursal.",
    },
    consumidores: [
      {
        archivo: "lib/services/budget-service.ts",
        simbolo: "validateEmergencyCap",
        decide: "Evalúa el acumulado contra el tope.",
      },
      {
        archivo: "lib/services/purchase-order-service.ts",
        simbolo: "validateEmergencyCap",
        decide: "Rechaza con HTTP 400 la orden de tipo `EMERGENCIA` que excede.",
      },
      {
        archivo: "lib/services/service-order-service.ts",
        simbolo: "validateEmergencyCap",
        decide: "Rechaza con HTTP 400 la orden de urgencia `EMERGENCIA` que excede.",
      },
    ],
    aplicacion:
      "Al enviar una orden a aprobación, con el mes de creación del documento y el " +
      "acumulado de la sucursal.",
    excepciones:
      "Sólo aplica a documentos marcados `EMERGENCIA`. Una orden de tipo normal no lo consulta: " +
      "pasa por presupuesto y centro de costo. El saldo del tope no lo descuenta nada " +
      "por sí solo; lo que cuenta son los documentos en estados que comprometen. " +
      "El tope no sustituye la matriz de aprobación ni garantiza atomicidad entre envíos concurrentes.",
    vacio: "`null` significa **sin tope**: las compras de urgencia nunca se bloquean por acumulado.",
    valores: [
      {
        valor: "null",
        titulo: "Sin tope",
        caso: {
          dado: "el grupo vació el campo",
          cuando: "se envía una compra de urgencia",
          entonces: "el tope no la bloquea; los demás requisitos de envío y aprobación siguen aplicando",
        },
      },
      {
        valor: "0",
        titulo: "Cero",
        caso: {
          dado: "el grupo guardó cero",
          cuando: "se envía cualquier compra de urgencia",
          entonces: "un documento de monto positivo se rechaza si el acumulado más el documento excede cero",
        },
      },
      {
        valor: "> 0",
        titulo: "Con tope",
        caso: {
          dado: "el grupo fijó un monto",
          cuando: "el acumulado de la sucursal más el documento rebasa el tope",
          entonces: "se rechaza con HTTP 400 y el excedente en el mensaje; un total igual al tope se permite",
        },
      },
    ],
  },
  {
    campo: "courtesyWasteMonthlyCapCents",
    input: "courtesyWasteCap",
    seccion: "umbral",
    grupo: "Autorización de gastos",
    etiqueta: "Tope Mensual de Cortesías y Consumo de Personal",
    unidad: "Centavos (MXN) para el grupo y mes; la pantalla captura pesos",
    alcance: "Grupo, consolidado de todas las sucursales",
    permiso: "settings/update",
    clasificacion: "aplicada",
    consumidor: {
      archivo: "lib/inventory/waste-approval.ts",
      simbolo: "evaluateApproval",
      decide:
        "Si la merma de cortesías del mes rebasa el tope y por tanto exige un rol " +
        "superior para aprobarse.",
    },
    consumidores: [
      {
        archivo: "lib/inventory/waste-approval.ts",
        simbolo: "evaluateApproval",
        decide: "Compara el consumo del mes más la merma contra el tope y exige rol superior al rebasarlo.",
      },
      {
        archivo: "app/api/inventory/waste/[id]/approval/route.ts",
        simbolo: "courtesyWasteMonthlyCapCents",
        decide: "Lee el tope de `companies` y delega la decisión en `evaluateApproval`.",
      },
      {
        archivo: "app/dashboard/inventory/waste/page.tsx",
        simbolo: "courtesyWasteMonthlyCapCents",
        decide: "Muestra el consumo contra el tope en la pantalla de merma.",
      },
    ],
    aplicacion:
      "Al aprobar una merma y al leer el consumo mensual. Vive en `companies`, no en " +
      "la fila de configuración: es la única entrada de esta pantalla que no se " +
      "guarda en `tenant_operating_config`.",
    excepciones:
      "Sólo aplica a merma de cortesías y consumo de personal; exige GERENTE hasta el tope " +
      "y ADMIN al superarlo. Sin costo conocido (`thisLossCents === null`) no escala " +
      "por monto. Un total igual al tope no lo rebasa.",
    vacio: "`null` significa **sin tope**: ninguna merma de cortesías exige rol superior por monto.",
    valores: [
      {
        valor: "null",
        titulo: "Sin tope",
        caso: {
          dado: "el grupo vació el campo",
          cuando: "se aprueba merma de cortesías de cualquier monto",
          entonces: "no se exige rol superior por exceder el tope",
        },
      },
      {
        valor: "0",
        titulo: "Cero",
        caso: {
          dado: "el grupo guardó cero",
          cuando: "se aprueba una merma de cortesías con costo positivo conocido",
          entonces: "exige ADMIN o superior si el acumulado más su costo supera cero; sin costo conocido no escala",
        },
      },
      {
        valor: "> 0",
        titulo: "Con tope",
        caso: {
          dado: "el grupo fijó un monto",
          cuando: "el consumo acumulado del grupo más la merma rebasa el tope",
          entonces: "la aprobación exige rol superior mientras siga rebasado",
        },
      },
    ],
  },
  {
    campo: "pettyCashLimitCents",
    input: "pettyCashLimit",
    seccion: "umbral",
    grupo: "Autorización de gastos",
    etiqueta: "Fondo Fijo de Caja Chica por Sucursal",
    unidad: "Centavos (MXN); la pantalla captura pesos",
    alcance: "Grupo en la columna, pero el fondo real es por sucursal",
    permiso: "settings/update",
    clasificacion: "descriptiva",
    consumidor: null,
    aplicacion:
      "Se lee al abrir la pantalla de configuración. `petty-cash-service` abre, " +
      "repone y registra movimientos con los montos que el operador escribe en cada " +
      "movimiento, sin mirar esta columna.",
    excepciones:
      "El fondo abierto guarda su propio `fund_amount` y su propio " +
      "`low_threshold` por sucursal, que es lo que el servicio usa para el saldo y " +
      "la alerta de reposición.",
    vacio: "No es «sin tope» como en los otros umbrales: si se vacía, el formulario lo muestra vacío y el valor guardado es `null`, que ningún servicio interpreta.",
    valores: [
      { valor: "null", titulo: "Sin monto declarado; no altera fondos existentes", caso: null },
      { valor: "0", titulo: "Cero declarado; no cierra ni impide abrir fondos", caso: null },
      { valor: "> 0", titulo: "Monto declarado; no limita apertura, reposición ni gastos", caso: null },
    ],
    decisionPendiente:
      "Si el límite es el tope al abrir el fondo, el máximo por gasto o el monto que " +
      "exige aprobación del dueño. Hoy el fondo tiene tres montos distintos —" +
      "`fund_amount`, `low_threshold` y el umbral de gastos— y este no es ninguno. " +
      "También falta definir reposiciones, excepciones y tratamiento de fondos existentes.",
  },
];

/** Los cuatro parámetros fiscales/laborales/merma de C14, para cerrar la pantalla. */
export const PARAMETROS_CONSUMIDOS: ReadonlyArray<{
  campo: string;
  input: string;
  etiqueta: string;
  consumidor: string;
}> = [
  {
    campo: "vatRatePercent",
    input: "vatRate",
    etiqueta: "Tasa de IVA estimada",
    consumidor: "resolveSalesBase (lib/services/sales-base.ts)",
  },
  {
    campo: "laborBurdenFactorPercent",
    input: "laborBurden",
    etiqueta: "Carga patronal sobre nómina bruta",
    consumidor: "buildLaborBurden (lib/services/labor-burden.ts)",
  },
  {
    campo: "payrollStateTaxPercent",
    input: "stateTax",
    etiqueta: "Impuesto estatal sobre nóminas",
    consumidor: "buildLaborBurden (lib/services/labor-burden.ts)",
  },
  {
    campo: "mermaVarianceThresholdPct",
    input: "mermaThreshold",
    etiqueta: "Umbral de varianza para merma automática",
    consumidor: "excedeUmbralMerma (lib/services/stock-count-from-workflow.ts)",
  },
];

export function politicaPorCampo(campo: string): PoliticaOperativa | undefined {
  return CATALOGO_OPERATIVO.find((p) => p.campo === campo);
}

/** Busca por la clave del formulario, que puede diferir del id del input. */
export function politicaPorInput(input: string): PoliticaOperativa | undefined {
  return CATALOGO_OPERATIVO.find((p) => p.input === input);
}

export function clasificacionDe(input: string): ClasificacionPolitica {
  return politicaPorInput(input)?.clasificacion ?? "descriptiva";
}

/** Texto que ve el operador; una sola definición por clasificación. */
export const ETIQUETA_CLASIFICACION: Record<ClasificacionPolitica, string> = {
  aplicada: "Se aplica hoy",
  descriptiva: "Descriptiva",
  pendiente: "Pendiente de decisión",
};

/** Lo que la clasificación promete, en una línea, para la leyenda de la pantalla. */
export const EXPLICACION_CLASIFICACION: Record<ClasificacionPolitica, string> = {
  aplicada: "Un servicio lee este valor y cambia una decisión con él.",
  descriptiva:
    "Se guarda y describe cómo opera el grupo. Ningún servicio lo lee hoy para decidir nada.",
  pendiente:
    "Se guarda como descripción. Falta definir su efecto; hoy no cambia permisos ni restricciones.",
};

/** Conteos por clasificación, para la leyenda y para la prueba de C15. */
export function resumenDePoliticas(): Record<ClasificacionPolitica, number> {
  const resumen: Record<ClasificacionPolitica, number> = {
    aplicada: 0,
    descriptiva: 0,
    pendiente: 0,
  };
  for (const politica of CATALOGO_OPERATIVO) resumen[politica.clasificacion] += 1;
  return resumen;
}

/** Las políticas cuya definición depende de una decisión de negocio. */
export function politicasConDecisionPendiente(): PoliticaOperativa[] {
  return CATALOGO_OPERATIVO.filter((p) => Boolean(p.decisionPendiente));
}
