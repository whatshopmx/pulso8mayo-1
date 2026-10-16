/**
 * B2 — lógica pura de la pantalla de conteo inline.
 *
 * El componente de la pantalla captura cantidades antes de crear la instancia.
 * Estas funciones no tocan React ni la red: sólo preparan el cuerpo que viaja
 * al servidor y traducen el error de un conteo activo a su id.
 */

/** Sólo viaja la captura de las categorías donde el usuario escribió algo. */
export function buildInitialValues(values: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [category, value] of Object.entries(values)) {
    if (typeof value === 'string' && value.trim() !== '') result[category] = value;
  }
  return result;
}

/**
 * El servidor reporta el conteo ya activo como "... ID: <uuid>" al crear por
 * HTTP, igual que la server action. Se extrae para poder llevar al usuario a
 * ese conteo en vez de dejar la pantalla en error.
 */
export function parseActiveCountId(message: string | undefined | null): string | null {
  if (!message) return null;
  const match = message.match(/ID:\s*([a-f0-9-]{36})/i);
  return match ? match[1] : null;
}
