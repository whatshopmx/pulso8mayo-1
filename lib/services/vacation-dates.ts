/** Vacation ranges are civil days. Legacy timestamp columns encode those
 * days as UTC fields; they are not instants to convert to a branch timezone. */
export function vacationCivilDay(value: Date | string): string {
  const day = value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
  const date = new Date(`${day}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(date.getTime())
    || date.toISOString().slice(0, 10) !== day) throw new RangeError('Fecha civil de vacaciones inválida');
  return day;
}

export function vacationDate(day: string): Date {
  return new Date(`${vacationCivilDay(day)}T00:00:00.000Z`);
}

export function serializeVacationDates<T extends { startDate: Date; endDate: Date }>(request: T) {
  return { ...request, startDate: vacationCivilDay(request.startDate), endDate: vacationCivilDay(request.endDate) };
}
