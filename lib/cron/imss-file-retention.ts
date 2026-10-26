import { and, isNotNull, lte } from 'drizzle-orm';
import { db } from '@/lib/db';
import { imssFiles } from '@/lib/db/schema';
import { isR2Configured } from '@/lib/storage/r2-client';
import { ImssMovementService } from '@/lib/services/compliance/imss-movement-service';

/** Escaneo administrativo acotado, sin PII. Cada borrado se vuelve a aislar por empresa. */
export async function runImssFileRetention() {
    if (!isR2Configured()) return { deleted: 0, storageUnavailable: true };
    const now = new Date();
    const expired = await db.select({ id: imssFiles.id, companyId: imssFiles.companyId }).from(imssFiles).where(and(
        lte(imssFiles.createdAt, new Date(now.getTime() - 365 * 86400000)), isNotNull(imssFiles.storageKey),
    )).orderBy(imssFiles.createdAt).limit(100);
    const byCompany = new Map<string, string[]>();
    for (const file of expired) byCompany.set(file.companyId, [...(byCompany.get(file.companyId) || []), file.id]);
    let deleted = 0;
    for (const [companyId, ids] of byCompany) deleted += await ImssMovementService.purgeExpiredFiles(companyId, now, ids);
    return { deleted, storageUnavailable: false };
}
