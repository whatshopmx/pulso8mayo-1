export interface LeaveReviewRequest {
  id: string;
  userId: string;
  userName?: string | null;
  branchId?: string | null;
  branchName?: string | null;
  leaveTypeName?: string | null;
  startDate: string;
  endDate: string;
  status: string;
}

/** The API is paginated: a partial page must never stand in for team coverage. */
export async function fetchAllLeaveRequests<T extends LeaveReviewRequest = LeaveReviewRequest>(
  filters: Record<string, string>, signal?: AbortSignal,
): Promise<T[]> {
  const requests: T[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const params = new URLSearchParams({ ...filters, limit: '100', page: String(page) });
    const response = await fetch(`/api/leave/requests?${params}`, { signal });
    if (!response.ok) throw new Error('No se pudieron consultar los permisos');
    const data = await response.json();
    if (!Array.isArray(data.requests)) throw new Error('Respuesta de permisos incompleta');
    requests.push(...data.requests);
    totalPages = data.pagination?.totalPages ?? 1;
    if (!Number.isInteger(totalPages) || totalPages < 0) throw new Error('Paginación inválida');
    page += 1;
  } while (page <= totalPages);
  return requests;
}

/** Civil dates, inclusive endpoints; absence overlap is not a staffing guarantee. */
export function overlappingRequests<T extends LeaveReviewRequest>(target: LeaveReviewRequest, requests: T[]): T[] {
  if (!target.branchId) return [];
  return requests.filter(request =>
    request.id !== target.id && request.userId !== target.userId &&
    request.branchId === target.branchId &&
    (request.status === 'APPROVED' || request.status === 'PENDING') &&
    request.startDate.slice(0, 10) <= target.endDate.slice(0, 10) &&
    request.endDate.slice(0, 10) >= target.startDate.slice(0, 10),
  );
}
