/**
 * Casos de `resolveBranchScope`: la versión fail-closed de `enforceBranchScope`.
 *
 * El caso que importa es el último de cada bloque: un rol acotado a sucursal
 * SIN `branchId` asignado. `enforceBranchScope` devuelve `null` ahí, y quien
 * consulta lo lee como "no filtres por sucursal" — o sea, le abre el grupo
 * entero. `resolveBranchScope` lo separa en `NONE` para que no se confunda.
 *
 *   npx tsx scripts/test-branch-scope.ts
 */

import {
    resolveBranchScope,
    enforceBranchScope,
    type BranchScope,
} from '../lib/branch-scope';
import type { Role } from '../lib/permissions';

let failures = 0;

function check(name: string, actual: BranchScope, expected: BranchScope) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) {
        console.log(`✅ ${name}`);
        console.log(`     ${JSON.stringify(actual)}`);
    } else {
        failures++;
        console.error(`❌ ${name}`);
        console.error(`     esperado: ${JSON.stringify(expected)}`);
        console.error(`     recibido: ${JSON.stringify(actual)}`);
    }
}

const BRANCH_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const BRANCH_B = 'bbbbbbbb-0000-0000-0000-000000000002';

console.log('--- Roles acotados a sucursal (GERENTE, SUPERVISOR) ---\n');

for (const role of ['GERENTE', 'SUPERVISOR'] as Role[]) {
    check(
        `${role} con sucursal propia → BRANCH(propia)`,
        resolveBranchScope(role, BRANCH_A, null),
        { kind: 'BRANCH', branchId: BRANCH_A }
    );

    check(
        `${role} pidiendo OTRA sucursal → BRANCH(propia), la petición se ignora`,
        resolveBranchScope(role, BRANCH_A, BRANCH_B),
        { kind: 'BRANCH', branchId: BRANCH_A }
    );

    // El caso que se estaba escapando.
    check(
        `${role} SIN sucursal asignada → NONE (no ALL)`,
        resolveBranchScope(role, null, null),
        { kind: 'NONE' }
    );

    check(
        `${role} sin sucursal pidiendo una ajena → NONE`,
        resolveBranchScope(role, undefined, BRANCH_B),
        { kind: 'NONE' }
    );
}

console.log('\n--- Roles no acotados (ADMIN, SUPER_ADMIN, READONLY) ---\n');

for (const role of ['SUPER_ADMIN', 'ADMIN', 'READONLY'] as Role[]) {
    check(
        `${role} sin petición → ALL`,
        resolveBranchScope(role, null, null),
        { kind: 'ALL' }
    );

    check(
        `${role} pidiendo una sucursal → BRANCH(la pedida)`,
        resolveBranchScope(role, null, BRANCH_B),
        { kind: 'BRANCH', branchId: BRANCH_B }
    );

    check(
        `${role} con sucursal propia pero sin pedir nada → ALL`,
        resolveBranchScope(role, BRANCH_A, null),
        { kind: 'ALL' }
    );
}

console.log('\n--- Paridad con enforceBranchScope (salvo el caso NONE) ---\n');

const parity: Array<[Role, string | null, string | null]> = [
    ['GERENTE', BRANCH_A, null],
    ['GERENTE', BRANCH_A, BRANCH_B],
    ['SUPERVISOR', BRANCH_A, BRANCH_B],
    ['ADMIN', null, BRANCH_B],
    ['ADMIN', null, null],
    ['SUPER_ADMIN', BRANCH_A, null],
];

for (const [role, own, requested] of parity) {
    const legacy = enforceBranchScope(role, own, requested);
    const scoped = resolveBranchScope(role, own, requested);
    const scopedAsLegacy = scoped.kind === 'BRANCH' ? scoped.branchId : null;

    if (legacy === scopedAsLegacy) {
        console.log(`✅ ${role} (propia=${own ?? '—'}, pedida=${requested ?? '—'}) coincide: ${legacy ?? 'null'}`);
    } else {
        failures++;
        console.error(`❌ ${role} (propia=${own ?? '—'}, pedida=${requested ?? '—'}): legacy=${legacy} vs nuevo=${scopedAsLegacy}`);
    }
}

// Y la divergencia deliberada: es la razón de existir del helper.
const legacyGap = enforceBranchScope('GERENTE', null, null);
const scopedGap = resolveBranchScope('GERENTE', null, null);
if (legacyGap === null && scopedGap.kind === 'NONE') {
    console.log('\n✅ Divergencia deliberada: GERENTE sin sucursal → enforce=null ("sin filtro") vs resolve=NONE (fail-closed)');
} else {
    failures++;
    console.error('\n❌ La divergencia esperada en GERENTE sin sucursal no se dio');
}

// ---------------------------------------------------------------------------
// Las decisiones que toman las rutas a partir del alcance.
//
// No llaman a las rutas (necesitarían sesión y BD): replican la traducción
// `BranchScope -> decisión` que cada una hace, que es donde estaba el bug. Si
// alguien cambia esa traducción en la ruta, este bloque queda desalineado y hay
// que actualizarlo a conciencia.
// ---------------------------------------------------------------------------

console.log('');
console.log('--- Decisión por ruta a partir del alcance ---');
console.log('');

type Decision = 'ESCRIBE_EMPRESA' | 'ESCRIBE_SUCURSAL' | 'RECHAZA' | 'EXPORTA_GRUPO' | 'EXPORTA_SUCURSAL' | 'VACIO' | 'LEE_GRUPO' | 'LEE_SUCURSAL';

function decisionEscritura(scope: BranchScope): Decision {
    // cash-flow/assumptions POST: `null` es el saldo A NIVEL EMPRESA, legítimo
    // para ADMIN. Por eso ALL y NONE no pueden colapsar.
    if (scope.kind === 'NONE') return 'RECHAZA';
    return scope.kind === 'BRANCH' ? 'ESCRIBE_SUCURSAL' : 'ESCRIBE_EMPRESA';
}

function decisionExportacion(scope: BranchScope): Decision {
    // reports/generate y reports/execute
    if (scope.kind === 'NONE') return 'RECHAZA';
    return scope.kind === 'BRANCH' ? 'EXPORTA_SUCURSAL' : 'EXPORTA_GRUPO';
}

function decisionLectura(scope: BranchScope): Decision {
    // cash-flow GET, expenses GET, inventory/waste GET
    if (scope.kind === 'NONE') return 'VACIO';
    return scope.kind === 'BRANCH' ? 'LEE_SUCURSAL' : 'LEE_GRUPO';
}

function checkDecision(name: string, actual: Decision, expected: Decision) {
    if (actual === expected) {
        console.log(`✅ ${name} → ${actual}`);
    } else {
        failures++;
        console.error(`❌ ${name}: esperado ${expected}, recibido ${actual}`);
    }
}

const gerenteSinSucursal = resolveBranchScope('GERENTE', null, null);
const gerenteConSucursal = resolveBranchScope('GERENTE', BRANCH_A, null);
const adminGrupo = resolveBranchScope('ADMIN', null, null);
const adminUnaSucursal = resolveBranchScope('ADMIN', null, BRANCH_B);

// El caso que no se puede romper: ADMIN sigue escribiendo el saldo de empresa.
checkDecision('assumptions · ADMIN sin pedir sucursal', decisionEscritura(adminGrupo), 'ESCRIBE_EMPRESA');
checkDecision('assumptions · ADMIN pidiendo sucursal', decisionEscritura(adminUnaSucursal), 'ESCRIBE_SUCURSAL');
checkDecision('assumptions · GERENTE con sucursal', decisionEscritura(gerenteConSucursal), 'ESCRIBE_SUCURSAL');
checkDecision('assumptions · GERENTE SIN sucursal', decisionEscritura(gerenteSinSucursal), 'RECHAZA');

checkDecision('reportes · ADMIN', decisionExportacion(adminGrupo), 'EXPORTA_GRUPO');
checkDecision('reportes · GERENTE con sucursal', decisionExportacion(gerenteConSucursal), 'EXPORTA_SUCURSAL');
checkDecision('reportes · GERENTE SIN sucursal', decisionExportacion(gerenteSinSucursal), 'RECHAZA');

checkDecision('lecturas · ADMIN', decisionLectura(adminGrupo), 'LEE_GRUPO');
checkDecision('lecturas · GERENTE con sucursal', decisionLectura(gerenteConSucursal), 'LEE_SUCURSAL');
checkDecision('lecturas · GERENTE SIN sucursal', decisionLectura(gerenteSinSucursal), 'VACIO');

// switchBranch: el guard que antes se saltaba entero con sucursal nula.
console.log('');
console.log('--- switchBranch ---');
console.log('');

function puedeCambiarA(role: Role, propia: string | null, pedida: string): boolean {
    const scope = resolveBranchScope(role, propia, pedida);
    if (scope.kind === 'NONE') return false;
    if (scope.kind === 'BRANCH' && scope.branchId !== pedida) return false;
    return true;
}

const casosSwitch: Array<[string, boolean]> = [
    ['ADMIN a cualquier sucursal', puedeCambiarA('ADMIN', null, BRANCH_B)],
    ['GERENTE a la suya', puedeCambiarA('GERENTE', BRANCH_A, BRANCH_A)],
    ['GERENTE a otra', !puedeCambiarA('GERENTE', BRANCH_A, BRANCH_B)],
    ['GERENTE SIN sucursal a cualquiera', !puedeCambiarA('GERENTE', null, BRANCH_B)],
];

for (const [nombre, ok] of casosSwitch) {
    if (ok) {
        console.log(`✅ ${nombre}`);
    } else {
        failures++;
        console.error(`❌ ${nombre}`);
    }
}

if (failures > 0) {
    console.error(`\n❌ ${failures} caso(s) fallaron.`);
    process.exit(1);
}

console.log('\n✅ Todos los casos de alcance por sucursal pasaron.');
