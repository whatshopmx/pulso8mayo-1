/**
 * Casos del resolver `resolveRecommendedAction` (T3).
 *
 * El resolver es puro: este script NO toca la base ni necesita env.
 * Run: npx tsx scripts/test-incident-recommendation.ts
 */

import {
  resolveRecommendedAction,
  type RecommendationInput,
  type RecommendedActionKind,
} from '../lib/services/incident-recommendation';

let failures = 0;

function expectKind(
  label: string,
  input: RecommendationInput,
  expected: RecommendedActionKind
) {
  let result;
  try {
    result = resolveRecommendedAction(input);
  } catch (err) {
    failures++;
    console.error(`❌ ${label}\n     lanzó: ${err}`);
    return;
  }

  if (result.kind !== expected) {
    failures++;
    console.error(`❌ ${label}\n     esperado ${expected}, recibido ${result.kind}`);
    return;
  }

  if (!result.label || !result.rationale) {
    failures++;
    console.error(`❌ ${label}\n     ${expected} sin label o sin rationale`);
    return;
  }

  console.log(`✅ ${label}`);
  console.log(`     ${result.kind} · ${result.urgency} · ${result.label}`);
  console.log(`     ↳ ${result.rationale}`);
}

const externalProtocol = {
  enabled: true,
  maxAttempts: 2,
  steps: [
    {
      type: 'external_service',
      complianceServiceType: 'FUMIGATION',
      instruction: 'Coordinar visita del proveedor de fumigación',
    },
  ],
};

const selfFixProtocol = {
  enabled: true,
  maxAttempts: 3,
  steps: [
    { type: 'self_fix', instruction: 'Ajustar el termostato a 4 °C' },
    { type: 'self_fix', instruction: 'Volver a tomar la temperatura' },
    { type: 'self_fix', instruction: 'Revisar el sello de la puerta' },
  ],
};

const escalationChain = [
  { level: 1, triggerCondition: 'timeout', notify: ['GERENTE'] },
  { level: 2, triggerCondition: 'remediation_failed', notify: ['ADMIN'] },
];

const baseIncident = {
  id: 'inc-1',
  branchId: 'branch-1',
  severity: 'HIGH',
};

console.log('--- Las 7 ramas de AD-2 ---\n');

// 1
expectKind(
  'Caso 1 · acción PENDING → CONFIRM_EXTERNAL',
  {
    incident: { ...baseIncident, status: 'AWAITING_EXTERNAL', remediationProtocol: externalProtocol },
    actions: [{ id: 'act-1', status: 'PENDING', serviceType: 'FUMIGATION' }],
  },
  'CONFIRM_EXTERNAL'
);

// 2
expectKind(
  'Caso 2 · acción CONFIRMED → AWAIT_SCHEDULED',
  {
    incident: { ...baseIncident, status: 'CONFIRMED', remediationProtocol: externalProtocol },
    actions: [
      {
        id: 'act-2',
        status: 'CONFIRMED',
        serviceType: 'FUMIGATION',
        scheduledDate: '2026-09-01T16:00:00.000Z',
      },
    ],
  },
  'AWAIT_SCHEDULED'
);

// 3
expectKind(
  'Caso 3 · paso externo sin proveedor activo → CONFIGURE_PROVIDER',
  {
    incident: { ...baseIncident, status: 'IN_REMEDIATION', remediationProtocol: externalProtocol },
    actions: [],
    activeProvider: null,
  },
  'CONFIGURE_PROVIDER'
);

// 4
expectKind(
  'Caso 4 · paso externo con proveedor activo → REQUEST_EXTERNAL',
  {
    incident: { ...baseIncident, status: 'IN_REMEDIATION', remediationProtocol: externalProtocol },
    actions: [],
    activeProvider: { id: 'cfg-1', serviceName: 'Fumigaciones del Norte', serviceType: 'FUMIGATION' },
  },
  'REQUEST_EXTERNAL'
);

// 5
expectKind(
  'Caso 5 · paso self-fix con intentos restantes → RUN_PROTOCOL_STEP',
  {
    incident: {
      ...baseIncident,
      status: 'IN_REMEDIATION',
      remediationProtocol: selfFixProtocol,
      metadata: { remediationCurrentStep: 1, remediationAttempts: 1, remediationMaxAttempts: 3 },
    },
    actions: [],
  },
  'RUN_PROTOCOL_STEP'
);

// 6a
expectKind(
  'Caso 6a · intentos agotados con cadena → ESCALATE',
  {
    incident: {
      ...baseIncident,
      status: 'IN_REMEDIATION',
      remediationProtocol: selfFixProtocol,
      escalationChain,
      metadata: { remediationCurrentStep: 0, remediationAttempts: 3, remediationMaxAttempts: 3 },
    },
    actions: [],
  },
  'ESCALATE'
);

// 6b — escalación manual: status ESCALATED aunque queden intentos
expectKind(
  'Caso 6b · status ESCALATED con intentos restantes → ESCALATE',
  {
    incident: {
      ...baseIncident,
      status: 'ESCALATED',
      remediationProtocol: selfFixProtocol,
      escalationChain,
      metadata: { remediationCurrentStep: 0, remediationAttempts: 0, remediationMaxAttempts: 3 },
    },
    actions: [],
  },
  'ESCALATE'
);

// 7
expectKind(
  'Caso 7 · intentos agotados sin cadena → RESOLVE_MANUAL',
  {
    incident: {
      ...baseIncident,
      status: 'IN_REMEDIATION',
      remediationProtocol: selfFixProtocol,
      escalationChain: [{ level: 1, triggerCondition: 'timeout' }],
      metadata: { remediationCurrentStep: 0, remediationAttempts: 3, remediationMaxAttempts: 3 },
    },
    actions: [],
  },
  'RESOLVE_MANUAL'
);

console.log('\n--- Formas degradadas de remediationProtocol (AD-8) ---\n');

// Sin título ni descripción reconocibles, el catálogo no aplica y se degrada.
const sinContexto = { ...baseIncident, title: 'Incidente 4821', description: null, stepId: null };

expectKind(
  'Degradado 1 · remediationProtocol null → RESOLVE_MANUAL',
  { incident: { ...sinContexto, status: 'DETECTED', remediationProtocol: null }, actions: [] },
  'RESOLVE_MANUAL'
);

expectKind(
  'Degradado 2 · remediationProtocol string → RESOLVE_MANUAL',
  {
    incident: {
      ...sinContexto,
      status: 'DETECTED',
      remediationProtocol:
        'Revisar el manometro, verificar presion y registrar lectura en bitacora',
    },
    actions: [],
  },
  'RESOLVE_MANUAL'
);

expectKind(
  'Degradado 3 · protocolo sin steps → RESOLVE_MANUAL',
  {
    incident: { ...sinContexto, status: 'DETECTED', remediationProtocol: { enabled: true } },
    actions: [],
  },
  'RESOLVE_MANUAL'
);

console.log('\n--- Catálogo por tipo de incidente (sin protocolo) ---\n');

const casosCatalogo: Array<[string, string, string]> = [
  ['Producto vencido en refrigerador', 'caducidad', 'Retirar el producto y registrar la merma'],
  ['Incumplimiento en limpieza de campana', 'limpieza', 'Reprogramar la limpieza y adjuntar evidencia fotográfica'],
  ['Temperatura de refrigerador elevada', 'temperatura', 'Revisar el equipo, ajustarlo y volver a tomar la temperatura'],
  ['Plaga de cucarachas en almacén Roma', 'plaga', 'Solicitar fumigación al proveedor de control de plagas'],
  ['Fuga de gas en cocina Condesa', 'gas', 'Cerrar el paso de gas y solicitar inspección inmediata'],
  ['Extintor con carga vencida', 'caducidad', 'Retirar el producto y registrar la merma'],
];

for (const [titulo, categoria, labelEsperado] of casosCatalogo) {
  const result = resolveRecommendedAction({
    incident: { ...baseIncident, title: titulo, status: 'DETECTED', remediationProtocol: null },
    actions: [],
  });

  if (result.kind !== 'SUGGESTED_FIX' || result.label !== labelEsperado) {
    failures++;
    console.error(`❌ "${titulo}" (${categoria})`);
    console.error(`     esperado SUGGESTED_FIX "${labelEsperado}"`);
    console.error(`     recibido ${result.kind} "${result.label}"`);
  } else {
    console.log(`✅ "${titulo}" → ${result.label}`);
  }
}

// Cada sugerencia con destino debe traer href + cta en el payload, y el href
// tiene que apuntar a una ruta real de app/dashboard (ver el catálogo).
const destinosEsperados: Array<[string, string]> = [
  ['Producto vencido en refrigerador', '/dashboard/inventory/waste'],
  ['Incumplimiento en limpieza de campana', '/dashboard/schedules'],
  ['Temperatura de refrigerador elevada', '/dashboard/equipment/maintenance'],
  ['Refrigerador descompuesto en cocina', '/dashboard/equipment/maintenance'],
  // "vencido" es ambiguo: un certificado se resuelve en el expediente, no
  // dando de baja producto. Fija el orden documentacion > caducidad.
  ['Certificado de fumigación vencido', '/dashboard/compliance/expediente'],
];

for (const [titulo, hrefEsperado] of destinosEsperados) {
  const r = resolveRecommendedAction({
    incident: { ...baseIncident, title: titulo, remediationProtocol: null },
    actions: [],
  });

  if (r.payload?.href !== hrefEsperado || !r.payload?.cta) {
    failures++;
    console.error(`❌ destino de "${titulo}"`);
    console.error(`     esperado ${hrefEsperado}, recibido ${r.payload?.href} / cta=${r.payload?.cta}`);
  } else {
    console.log(`✅ "${titulo}" → ${r.payload.cta} → ${r.payload.href}`);
  }
}

// Higiene personal se corrige con la persona: sugerencia sin destino ni CTA.
const higiene = resolveRecommendedAction({
  incident: {
    ...baseIncident,
    title: 'Colaborador sin cofia en cocina',
    remediationProtocol: null,
  },
  actions: [],
});
if (higiene.kind !== 'SUGGESTED_FIX' || higiene.payload?.href) {
  failures++;
  console.error(`❌ higiene personal no debe traer destino, recibido ${higiene.payload?.href}`);
} else {
  console.log(`✅ "Colaborador sin cofia" → sugerencia sin CTA (${higiene.label})`);
}

// El protocolo manda sobre el catálogo: si el incidente trae pasos, se usan.
expectKind(
  'Catálogo NO pisa al protocolo · título de plaga con protocolo self-fix',
  {
    incident: {
      ...baseIncident,
      title: 'Plaga de cucarachas en almacén',
      remediationProtocol: selfFixProtocol,
      metadata: { remediationCurrentStep: 0, remediationAttempts: 0 },
    },
    actions: [],
  },
  'RUN_PROTOCOL_STEP'
);

// Y una acción pendiente sigue ganando sobre todo lo demás.
expectKind(
  'Catálogo NO pisa a la acción pendiente',
  {
    incident: { ...baseIncident, title: 'Producto vencido en refrigerador', remediationProtocol: null },
    actions: [{ id: 'act-1', status: 'PENDING', serviceType: 'FUMIGATION' }],
  },
  'CONFIRM_EXTERNAL'
);

console.log('\n--- Bordes adicionales ---\n');

expectKind(
  'Borde · steps vacío → RESOLVE_MANUAL',
  {
    incident: { ...baseIncident, remediationProtocol: { enabled: true, steps: [] } },
    actions: [],
  },
  'RESOLVE_MANUAL'
);

expectKind(
  'Borde · enabled:false → RESOLVE_MANUAL',
  {
    incident: { ...baseIncident, remediationProtocol: { enabled: false, steps: selfFixProtocol.steps } },
    actions: [],
  },
  'RESOLVE_MANUAL'
);

expectKind(
  'Borde · currentStep fuera de rango → RESOLVE_MANUAL',
  {
    incident: {
      ...baseIncident,
      remediationProtocol: selfFixProtocol,
      metadata: { remediationCurrentStep: 9 },
    },
    actions: [],
  },
  'RESOLVE_MANUAL'
);

expectKind(
  'Borde · actions undefined no lanza → CONFIGURE_PROVIDER',
  { incident: { ...baseIncident, remediationProtocol: externalProtocol } },
  'CONFIGURE_PROVIDER'
);

expectKind(
  'Borde · PENDING gana sobre CONFIRMED (primer match)',
  {
    incident: { ...baseIncident, remediationProtocol: externalProtocol },
    actions: [
      { id: 'act-old', status: 'CONFIRMED', serviceType: 'FUMIGATION' },
      { id: 'act-new', status: 'PENDING', serviceType: 'FUMIGATION' },
    ],
  },
  'CONFIRM_EXTERNAL'
);

expectKind(
  'Borde · acciones COMPLETED se ignoran → RUN_PROTOCOL_STEP',
  {
    incident: {
      ...baseIncident,
      remediationProtocol: selfFixProtocol,
      metadata: { remediationCurrentStep: 0, remediationAttempts: 0 },
    },
    actions: [{ id: 'act-done', status: 'COMPLETED', serviceType: 'FUMIGATION' }],
  },
  'RUN_PROTOCOL_STEP'
);

// El módulo no debe arrastrar la capa de datos (AD-1).
const source = require('node:fs').readFileSync(
  require('node:path').join(__dirname, '../lib/services/incident-recommendation.ts'),
  'utf8'
);
if (/from\s+['"]@\/lib\/db/.test(source) || /from\s+['"].*\/db['"]/.test(source)) {
  failures++;
  console.error('\n❌ incident-recommendation.ts importa la capa de datos (viola AD-1)');
} else {
  console.log('\n✅ incident-recommendation.ts no importa @/lib/db (AD-1)');
}

if (failures > 0) {
  console.error(`\n❌ ${failures} caso(s) fallaron.`);
  process.exit(1);
}

console.log('\n✅ Todos los casos del resolver pasaron.');
