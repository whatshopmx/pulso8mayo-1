/**
 * C14.3 — el instante que define qué parámetro estaba vigente en un periodo.
 *
 * Un periodo se calcula con los parámetros que estaban vigentes **al cerrarse**.
 * Es la misma convención que usa `financial-period-service` para congelar el
 * P&L, y evita el caso peor: que un cambio de junio altere los números de
 * marzo.
 *
 * El corte es el último instante del día final en UTC, porque los días de
 * negocio (`business_date`) son texto en UTC y comparar contra el inicio del
 * día dejaría fuera los cambios hechos durante ese mismo día.
 */
export function cierreDelPeriodo(endDay: string): Date {
  return new Date(`${endDay.slice(0, 10)}T23:59:59.999Z`);
}