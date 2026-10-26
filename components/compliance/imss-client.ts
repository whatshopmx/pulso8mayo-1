'use client';

import { useEffect, useState } from 'react';
import { IMSS_BLOCKED_REASON_LABELS } from '@/lib/services/compliance/imss-rules';

export interface ImssMovementRow {
    userId: string; name: string; branchId: string | null; branchName: string | null; nss: string | null;
    employeeNumber: string | null; status: string; imssStatus: string; fileId: string | null; overdue: boolean;
    blockedReasons: string[]; hireDate?: string | null; terminationDate?: string | null; terminationReason?: string | null;
    daysSinceHire?: number; daysSinceTermination?: number;
}
export interface ImssListSummary { ready: number; blocked: number; inFile: number; registered: number; overdue: number }
export interface ImssSummary {
    totalEmployees: number; requiredMovements: number; confirmedMovements: number; complianceRate: number | null;
    pendingAltas: number; pendingBajas: number; overdueAltas: number; overdueBajas: number;
}
export const imssQuery = (branchId?: string | null) => branchId && !['all', 'ALL'].includes(branchId) ? `?branchId=${encodeURIComponent(branchId)}` : '';
export const imssMoney = (value: number | null) => value === null ? '—' : new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(value);
export const imssDate = (value?: string | null) => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleDateString('es-MX', { timeZone: 'UTC' }) : '—';
export const imssReason = (reason: string) => ({ ...IMSS_BLOCKED_REASON_LABELS, MOVIMIENTO_EN_ARCHIVO: 'Movimiento en archivo para esta fecha o una posterior', MOVIMIENTO_CONFIRMADO: 'Movimiento ya confirmado para esta fecha o una posterior' } as Record<string, string>)[reason] || reason;
export const imssTerminationReason = (reason?: string | null) => reason ? ({ VOLUNTARY_RESIGNATION: 'Renuncia voluntaria', TERMINATION_WITH_CAUSE: 'Rescisión con causa justificada',
    TERMINATION_WITHOUT_CAUSE: 'Terminación sin causa', CONTRACT_EXPIRED: 'Vencimiento de contrato', RETIREMENT: 'Jubilación o retiro', DEATH: 'Fallecimiento', MUTUAL_AGREEMENT: 'Mutuo acuerdo', OTHER: 'Otro' } as Record<string, string>)[reason] || reason : 'Sin motivo capturado';

export async function imssErrorMessage(response: Response) {
    if (response.status === 401) return 'Tu sesión terminó. Vuelve a iniciar sesión.';
    if (response.status === 403) return 'No tienes permiso para esta operación o sucursal.';
    const data = await response.json().catch(() => null);
    return typeof data?.error === 'string' ? data.error : data?.error?.message || 'No se pudo completar la operación IMSS';
}
export async function imssJson<T>(url: string, options?: RequestInit): Promise<T> {
    const response = await fetch(url, { cache: 'no-store', ...options });
    if (!response.ok) throw new Error(await imssErrorMessage(response));
    try { return await response.json() as T; }
    catch { throw new Error('No se pudo leer la información. Actualiza la página.'); }
}
export function useImssResource<T>(url: string) {
    const [revision, setRevision] = useState(0);
    const key = `${url}#${revision}`;
    const [resource, setResource] = useState<{ key: string; data: T | null; error: string | null }>({ key: '', data: null, error: null });
    useEffect(() => {
        const controller = new AbortController();
        imssJson<T>(url, { signal: controller.signal }).then(data => { if (!controller.signal.aborted) setResource({ key, data, error: null }); })
            .catch(error => { if (!controller.signal.aborted) setResource({ key, data: null, error: error instanceof Error ? error.message : 'No se pudo cargar IMSS' }); });
        return () => controller.abort();
    }, [url, key]);
    return { data: resource.key === key ? resource.data : null, loading: resource.key !== key,
        error: resource.key === key ? resource.error : null, refresh: () => setRevision(value => value + 1) };
}

export async function downloadImss(response: Response) {
    if (!response.ok) throw new Error(await imssErrorMessage(response));
    const blob = await response.blob();
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') || '')?.[1] || 'IMSS.txt';
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(href);
}
export async function generateImssFile(body: object) {
    const response = await fetch('/api/imss/files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(await imssErrorMessage(response));
    const id = response.headers.get('X-File-Id');
    const saved = response.headers.get('X-Imss-Download-Available') === 'true';
    await downloadImss(saved && id ? await fetch(`/api/imss/files/${id}`, { cache: 'no-store' }) : response);
    return { id, saved, included: Number(response.headers.get('X-Imss-Included-Count') || 0), excluded: Number(response.headers.get('X-Imss-Excluded-Count') || 0) };
}
