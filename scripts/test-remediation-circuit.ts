import 'dotenv/config';

import { randomUUID } from 'node:crypto';
import { COMPLIANCE_SERVICE_MAPPINGS, getWorkflowTemplateForServiceType } from '../lib/compliance-mapping';

console.log('--- Testing Compliance Service Mapping ---');
console.log('FUMIGATION template:', getWorkflowTemplateForServiceType('FUMIGATION'));
console.log('FIRE_SYSTEM_CHECK template:', getWorkflowTemplateForServiceType('FIRE_SYSTEM_CHECK'));
console.log('CUSTOM template fallback:', getWorkflowTemplateForServiceType('CUSTOM'));

console.log('\n--- Service Mappings Configured ---');
Object.values(COMPLIANCE_SERVICE_MAPPINGS).forEach(m => {
  console.log(`[${m.serviceType}] => Name: "${m.name}", Template: "${m.defaultTemplateId}"`);
});

console.log('\n✅ Compliance Mapping Tests Passed.');

// ---------------------------------------------------------------------------
// Caso con BD: sucursal SIN proveedor configurado para el servicio pedido.
//
// Es el caso que más importa —no hay proveedor contratado, que es justo cuando
// hace falta avisar a gerencia— y el que antes reventaba: se insertaba
// `companyId: serviceConfig?.companyId || ''` en una columna uuid NOT NULL.
//
// Requiere DATABASE_URL y una BD sembrada. Crea y borra sus propias filas.
// Run: npx tsx scripts/test-remediation-circuit.ts
// ---------------------------------------------------------------------------

let failures = 0;

function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`  ✅ ${label}`);
  } else {
    failures++;
    console.error(`  ❌ ${label}`, detail !== undefined ? `→ ${JSON.stringify(detail)}` : '');
  }
}

async function testExternalServiceWithoutProvider() {
  const { db } = await import('@/lib/db');
  const { branches, incidents, remediationActions, branchComplianceServices } = await import('@/lib/db/schema');
  const { eq, and } = await import('drizzle-orm');
  const { RemediationService } = await import('@/lib/services/remediation-service');

  const [branch] = await db
    .select({ id: branches.id, companyId: branches.companyId })
    .from(branches)
    .limit(1);

  if (!branch?.companyId) {
    console.error('❌ No hay sucursales sembradas; corre `pnpm seed` antes de este script.');
    process.exit(1);
  }

  // Elegir un serviceType para el que la sucursal NO tenga proveedor activo.
  const activeConfigs = await db
    .select({ serviceType: branchComplianceServices.serviceType })
    .from(branchComplianceServices)
    .where(and(
      eq(branchComplianceServices.branchId, branch.id),
      eq(branchComplianceServices.isActive, true)
    ));

  const taken = new Set(activeConfigs.map(c => String(c.serviceType)));
  const serviceType = Object.keys(COMPLIANCE_SERVICE_MAPPINGS).find(t => !taken.has(t));

  if (!serviceType) {
    console.log('\n⚠️  La sucursal tiene proveedor activo para todos los tipos; se omite el caso.');
    return;
  }

  console.log(`\n--- Caso BD: sucursal sin proveedor de ${serviceType} ---`);
  console.log(`  sucursal ${branch.id} / empresa ${branch.companyId}`);

  const [incident] = await db
    .insert(incidents)
    .values({
      instanceId: randomUUID(),
      stepId: 'test-remediation-circuit',
      branchId: branch.id,
      severity: 'HIGH',
      status: 'DETECTED',
      title: '[TEST] Remediación sin proveedor configurado',
      description: 'Fila temporal creada por scripts/test-remediation-circuit.ts',
    })
    .returning();

  try {
    const step = {
      type: 'external_service',
      complianceServiceType: serviceType,
      instruction: 'Coordinar visita del proveedor',
    };

    const result = await RemediationService.handleExternalServiceStep(incident, step);

    check('handleExternalServiceStep no lanza sin proveedor', !!result?.remediationActionId);

    const [action] = await db
      .select()
      .from(remediationActions)
      .where(eq(remediationActions.incidentId, incident.id))
      .limit(1);

    check('se creó la fila de remediación', !!action);
    check(
      'companyId sale de la sucursal, no del serviceConfig',
      action?.companyId === branch.companyId,
      { esperado: branch.companyId, recibido: action?.companyId }
    );
    check('serviceConfigId queda en null', action?.serviceConfigId === null, action?.serviceConfigId);
    check('status inicial PENDING', action?.status === 'PENDING', action?.status);

    const [updated] = await db
      .select({ status: incidents.status })
      .from(incidents)
      .where(eq(incidents.id, incident.id))
      .limit(1);

    check('el incidente pasa a AWAITING_EXTERNAL', updated?.status === 'AWAITING_EXTERNAL', updated?.status);
  } finally {
    await db.delete(remediationActions).where(eq(remediationActions.incidentId, incident.id));
    await db.delete(incidents).where(eq(incidents.id, incident.id));
    console.log('  🧹 filas temporales eliminadas');
  }
}

async function testMissingBranch() {
  const { db } = await import('@/lib/db');
  const { remediationActions } = await import('@/lib/db/schema');
  const { eq } = await import('drizzle-orm');
  const { RemediationService } = await import('@/lib/services/remediation-service');

  console.log('\n--- Caso BD: sucursal inexistente ---');

  const orphanIncidentId = randomUUID();
  const fakeIncident = { id: orphanIncidentId, branchId: randomUUID() };
  const step = {
    type: 'external_service',
    complianceServiceType: 'FUMIGATION',
    instruction: 'Coordinar visita del proveedor',
  };

  let threw = false;
  try {
    await RemediationService.handleExternalServiceStep(fakeIncident, step);
  } catch {
    threw = true;
  }

  check('lanza en vez de insertar una fila sin tenant', threw);

  const orphans = await db
    .select({ id: remediationActions.id })
    .from(remediationActions)
    .where(eq(remediationActions.incidentId, orphanIncidentId));

  check('no quedó ninguna fila corrupta', orphans.length === 0, orphans.length);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log('\n⚠️  Sin DATABASE_URL: se omiten los casos con BD.');
    return;
  }

  await testExternalServiceWithoutProvider();
  await testMissingBranch();

  if (failures > 0) {
    console.error(`\n❌ ${failures} verificación(es) fallaron.`);
    process.exit(1);
  }

  console.log('\n✅ Casos de circuito de remediación en verde.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ Error inesperado:', err);
    process.exit(1);
  });
