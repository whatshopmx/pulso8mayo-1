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

expectKind(
  'Degradado 1 · remediationProtocol null → RESOLVE_MANUAL',
  { incident: { ...baseIncident, status: 'DETECTED', remediationProtocol: null }, actions: [] },
  'RESOLVE_MANUAL'
);

expectKind(
  'Degradado 2 · remediationProtocol string → RESOLVE_MANUAL',
  {
    incident: {
      ...baseIncident,
      status: 'DETECTED',
      remediationProtocol:
        'Revisar manómetro, verificar presión y registrar lectura en bitácora',
    },
    actions: [],
  },
  'RESOLVE_MANUAL'
);

expectKind(
  'Degradado 3 · protocolo sin steps → RESOLVE_MANUAL',
  {
    incident: { ...baseIncident, status: 'DETECTED', remediationProtocol: { enabled: true } },
    actions: [],
  },
  'RESOLVE_MANUAL'
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
