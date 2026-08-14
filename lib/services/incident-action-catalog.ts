/**
 * Catálogo de acciones sugeridas por tipo de incidente.
 *
 * Sólo 8 de las 28 plantillas definen `remediationProtocol`, y
 * `incident-engine.ts` lo copia tal cual al crear el incidente: la mayoría de
 * los incidentes nace sin protocolo y, sin este catálogo, el resolver no puede
 * decir más que "resuélvelo manualmente".
 *
 * Esto NO reemplaza al protocolo: si el incidente trae uno, manda el protocolo.
 * El catálogo es el piso, no el techo.
 *
 * Módulo PURO: no importa `@/lib/db` ni llama a ningún modelo. El match es
 * determinista sobre el texto que el incidente ya trae (título, descripción y
 * stepId), para que la sugerencia sea explicable y reproducible.
 */

export type SuggestionUrgency = 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * A dónde lleva la acción. Sin esto la sugerencia es sólo texto: le dice al
 * gerente qué hacer pero lo deja buscando la pantalla.
 *
 * Todas las rutas están verificadas contra `app/dashboard/**`; si mueves una
 * página, actualiza aquí o el panel mandará a un 404.
 */
export interface SuggestionDestination {
  href: string;
  /** Texto del botón, en imperativo y corto. */
  cta: string;
}

export interface IncidentActionSuggestion {
  /** Slug del tipo detectado, para trazabilidad y para el rationale. */
  category: string;
  /** Qué hay que hacer, en imperativo. */
  label: string;
  /** Cómo se detectó, en lenguaje de operación. */
  detectedAs: string;
  urgency: SuggestionUrgency;
  destination?: SuggestionDestination;
}

interface CatalogEntry extends IncidentActionSuggestion {
  patterns: RegExp;
}

/**
 * Primer match gana, así que el orden importa: lo más específico arriba.
 *
 * - `documentacion` va primero porque "vencido" es ambiguo: un *certificado*
 *   vencido se resuelve en el expediente, no dando de baja producto. Sin este
 *   orden, "Certificado de fumigación vencido" recomendaba registrar merma.
 * - `caducidad` va antes que `temperatura` para que "Producto vencido en
 *   refrigerador" no se lea como una falla del equipo.
 */
const CATALOG: CatalogEntry[] = [
  {
    category: 'documentacion',
    destination: { href: '/dashboard/compliance/expediente', cta: 'Abrir expediente' },
    patterns: /document|expedient|certificad|vigenci|licenci|permiso/,
    label: 'Actualizar el documento y subir el comprobante',
    detectedAs: 'documentación vencida o faltante',
    urgency: 'MEDIUM',
  },
  {
    category: 'caducidad',
    destination: { href: '/dashboard/inventory/waste', cta: 'Registrar merma' },
    patterns: /vencid|caducad|caducidad|fecha de consumo|expirad/,
    label: 'Retirar el producto y registrar la merma',
    detectedAs: 'producto fuera de fecha de consumo',
    urgency: 'HIGH',
  },
  {
    category: 'plaga',
    destination: { href: '/dashboard/equipment/compliance', cta: 'Ver proveedores' },
    patterns: /plaga|cucarach|roedor|rata|insecto|fumigac/,
    label: 'Solicitar fumigación al proveedor de control de plagas',
    detectedAs: 'presencia de plagas',
    urgency: 'HIGH',
  },
  {
    category: 'gas',
    destination: { href: '/dashboard/equipment/compliance', cta: 'Ver proveedores' },
    patterns: /fuga de gas|fuga|gas lp|olor a gas/,
    label: 'Cerrar el paso de gas y solicitar inspección inmediata',
    detectedAs: 'riesgo por fuga de gas',
    urgency: 'HIGH',
  },
  {
    category: 'incendio',
    destination: { href: '/dashboard/equipment/compliance', cta: 'Ver proveedores' },
    patterns: /incendi|extintor|humo|conato/,
    label: 'Solicitar inspección del sistema contra incendios',
    detectedAs: 'riesgo de incendio o equipo contra incendios',
    urgency: 'HIGH',
  },
  {
    category: 'temperatura',
    destination: { href: '/dashboard/equipment/maintenance', cta: 'Ver mantenimiento' },
    patterns: /temperatur|refrigerad|congelad|camara fria|termostat|cadena de frio/,
    label: 'Revisar el equipo, ajustarlo y volver a tomar la temperatura',
    detectedAs: 'temperatura fuera de rango',
    urgency: 'HIGH',
  },
  {
    category: 'limpieza',
    destination: { href: '/dashboard/schedules', cta: 'Programar limpieza' },
    patterns: /limpiez|sanitiz|campana|desinfec|sucied|sucio/,
    label: 'Reprogramar la limpieza y adjuntar evidencia fotográfica',
    detectedAs: 'incumplimiento de limpieza o sanitización',
    urgency: 'MEDIUM',
  },
  {
    category: 'higiene_personal',
    patterns: /uniforme|cofia|guantes|cubrebocas|higiene personal|lavado de manos|barba/,
    label: 'Corregir con el colaborador y registrar la evidencia',
    detectedAs: 'incumplimiento de higiene personal',
    urgency: 'MEDIUM',
  },
  {
    category: 'mantenimiento',
    destination: { href: '/dashboard/equipment/maintenance', cta: 'Levantar orden' },
    patterns: /mantenimient|averi|descompuest|falla|no enfria|no funciona/,
    label: 'Levantar una orden de mantenimiento para el equipo',
    detectedAs: 'falla de equipo',
    urgency: 'MEDIUM',
  },
  {
    category: 'inventario',
    destination: { href: '/dashboard/inventory/stock-count', cta: 'Ir al conteo' },
    patterns: /inventari|faltante|merma|stock|conteo/,
    label: 'Verificar el conteo y registrar el ajuste de inventario',
    detectedAs: 'diferencia de inventario',
    urgency: 'MEDIUM',
  },
];

/** Minúsculas y sin acentos, para que "fumigación" haga match con /fumigac/. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

/**
 * Busca en el catálogo la acción que corresponde al incidente.
 *
 * Devuelve null cuando nada hace match: quien llama debe degradar a la
 * resolución manual en vez de inventarse una instrucción.
 */
export function findSuggestedAction(incident: {
  title?: string | null;
  description?: string | null;
  stepId?: string | null;
}): IncidentActionSuggestion | null {
  const haystack = normalize(
    [incident.title, incident.description, incident.stepId].filter(Boolean).join(' ')
  );

  if (!haystack.trim()) return null;

  for (const entry of CATALOG) {
    if (entry.patterns.test(haystack)) {
      return {
        category: entry.category,
        label: entry.label,
        detectedAs: entry.detectedAs,
        urgency: entry.urgency,
        // `higiene_personal` no tiene destino: se corrige con la persona, no en
        // una pantalla. Por eso el campo es opcional y el panel omite el CTA.
        destination: entry.destination,
      };
    }
  }

  return null;
}
