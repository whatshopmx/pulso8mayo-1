/**
 * IMSS Parser Service
 * Generates SUA and IDSE format files for Mexican Social Security (IMSS)
 * 
 * SUA = Sistema Único de Autodeterminación (Salary update reports)
 * IDSE = IMSS Desde Su Empresa (Employee movements: alta, baja, modificación)
 */

/**
 * Calculate SDI (Salario Diario Integrado)
 * SDI = Salario Diario × Factor de Integración
 * Factor primer año ≈ 1.0493 (aguinaldo 15 días + prima vacacional 25% de 12 días).
 */
export function calculateSDI(dailySalary: number, yearsOfService: number = 0): number {
  // Vacation days per Mexican LFT
  const vacationDays = getVacationDays(yearsOfService);
  const vacationPremium = vacationDays * 0.25; // 25% prima vacacional
  const aguinaldo = 15; // Minimum 15 days per year

  const integrationFactor = 1 + (aguinaldo + vacationPremium) / 365;
  return Math.round(dailySalary * integrationFactor * 100) / 100;
}

function getVacationDays(yearsOfService: number): number {
  if (yearsOfService <= 0) return 12;
  if (yearsOfService === 1) return 12;
  if (yearsOfService === 2) return 14;
  if (yearsOfService === 3) return 16;
  if (yearsOfService === 4) return 18;
  if (yearsOfService === 5) return 20;
  if (yearsOfService <= 10) return 22;
  if (yearsOfService <= 15) return 24;
  if (yearsOfService <= 20) return 26;
  if (yearsOfService <= 25) return 28;
  if (yearsOfService <= 30) return 30;
  if (yearsOfService <= 35) return 32;
  return 34;
}

/**
 * Format a string to fixed width with right padding
 */
function padRight(str: string, length: number): string {
  return (str || '').substring(0, length).padEnd(length, ' ');
}

/**
 * Format date from ISO to DDMMAAAA
 */
function formatDateIMSS(dateStr: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) throw new Error('Fecha IMSS inválida');
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== dateStr) throw new Error('Fecha IMSS inválida');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getUTCFullYear());
  return `${dd}${mm}${yyyy}`;
}

export interface ImssFileMovement {
  userId: string;
  nss: string;
  curp: string;
  rfc: string;
  name: string;
  hireDate: string;
  effectiveDate: string;
  baseSalaryCents: number;
  sdiCents: number;
  movementType: 'ALTA' | 'BAJA' | 'MOD_SALARIO';
}

interface BuildOptions {
  registroPatronal: string;
  fechaMovimiento: string;
  layoutVersion?: string;
}

const MOVEMENT_CODES = { ALTA: '08', BAJA: '02', MOD_SALARIO: '07' } as const;

function validateMovements(movements: ImssFileMovement[], options: BuildOptions) {
  if (!movements.length) throw new Error('El archivo no puede estar vacío');
  if (!/^[A-Z0-9]\d{10}$/.test(options.registroPatronal)) throw new Error('Registro patronal inválido');
  formatDateIMSS(options.fechaMovimiento);
  for (const row of movements) {
    if (!Number.isSafeInteger(row.sdiCents) || row.sdiCents <= 0 || row.sdiCents > 9999999) throw new Error('SDI inválido para el layout IMSS');
    if (!Number.isSafeInteger(row.baseSalaryCents) || row.baseSalaryCents <= 0) throw new Error('Salario base inválido');
    if (!validateNSS(row.nss) || !validateCURP(row.curp) || !validateRFC(row.rfc)) throw new Error('Identidad IMSS incompleta');
    if (!MOVEMENT_CODES[row.movementType]) throw new Error('Tipo de movimiento inválido');
    formatDateIMSS(row.effectiveDate);
    formatDateIMSS(row.hireDate);
  }
}

function employeeName(row: ImssFileMovement) {
  const parts = row.name.trim().toUpperCase().split(/\s+/);
  return [parts[0] || '', parts[1] || '', parts.slice(2).join(' ') || parts[0] || ''];
}

function renderIdse(movements: ImssFileMovement[], options: BuildOptions) {
  validateMovements(movements, options);
  const lines = [`HD|${options.registroPatronal}|${String(movements.length).padStart(5, '0')}|${formatDateIMSS(options.fechaMovimiento)}|PULSO_SISTEMA`];
  for (const row of movements) {
    const names = employeeName(row);
    lines.push(['DT', row.nss, row.curp.toUpperCase(), padRight(row.rfc.toUpperCase(), 13),
      ...names.map(name => padRight(name, 27)), row.sdiCents.toString().padStart(7, '0'), MOVEMENT_CODES[row.movementType],
      formatDateIMSS(row.effectiveDate), '1', '1', row.movementType === 'BAJA' ? formatDateIMSS(row.effectiveDate) : '00000000'].join('|'));
  }
  lines.push(`TR|${String(movements.length).padStart(5, '0')}`);
  return lines.join('\r\n');
}

function renderSua(movements: ImssFileMovement[], options: BuildOptions) {
  validateMovements(movements, options);
  if (movements.some(row => row.movementType !== 'MOD_SALARIO')) throw new Error('SUA solo admite modificación salarial');
  return movements.map(row => [row.nss, row.sdiCents.toString().padStart(7, '0'), formatDateIMSS(row.effectiveDate), options.registroPatronal,
    ...employeeName(row).map(name => padRight(name, 27)), '01', '01', formatDateIMSS(row.hireDate)].join('')).join('\r\n');
}

async function fileResult(content: string, lineCount: number, layoutVersion: string) {
  // Web Crypto evita importar node:crypto en las pantallas que usan validadores.
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  const sha256 = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  return { content, sha256, lineCount, layoutVersion };
}

/** Archivos de trabajo: layout todavía no validado contra el portal IMSS. */
export async function buildIdseFile(movements: ImssFileMovement[], options: BuildOptions) {
  if (options.layoutVersion && options.layoutVersion !== 'IDSE_2025_v1') throw new Error('La versión IDSE no está soportada');
  return fileResult(renderIdse(movements, options), movements.length, 'IDSE_2025_v1');
}

export async function buildSuaFile(movements: ImssFileMovement[], options: BuildOptions) {
  if (options.layoutVersion && options.layoutVersion !== 'SUA_AFIL_v1') throw new Error('La versión SUA no está soportada');
  return fileResult(renderSua(movements, options), movements.length, 'SUA_AFIL_v1');
}

/**
 * Validate NSS format (11 digits)
 */
export function validateNSS(nss: string): boolean {
  return /^\d{11}$/.test(nss);
}

/**
 * Validate CURP format (18 alphanumeric characters)
 */
export function validateCURP(curp: string): boolean {
  return /^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/.test(curp.toUpperCase());
}

/**
 * Validate RFC format (12-13 characters)
 */
export function validateRFC(rfc: string): boolean {
  return /^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/.test(rfc.toUpperCase());
}
