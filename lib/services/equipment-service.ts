/**
 * Equipment Service
 * Manages equipment, warranties, maintenance history, and compliance services
 */

import { db } from '@/lib/db';
import {
  branchEquipments,
  equipmentCatalog,
  equipmentWarranties,
  equipmentMaintenanceHistory,
  equipmentMaintenanceSchedules,
  serviceProviders,
  branchComplianceServices,
  complianceServiceHistory,
  equipmentAlerts,
  equipmentStatusEnum,
  warrantyStatusEnum,
  maintenanceStatusEnum,
  complianceServiceTypeEnum,
} from '@/lib/db/schema/equipment';
import { eq, and, desc, asc, gte, lte, isNull, or, sql } from 'drizzle-orm';
import { branches } from '@/lib/db/schema';
import type { BranchScope } from '@/lib/branch-scope';
import { assertBranchOfCompany } from '@/lib/branch-scope';
import { assertScopeCoversBranch } from '@/lib/equipment/scope';
import { ApiError } from '@/lib/api/error';
import { v4 as uuidv4 } from 'uuid';

/** Una fila de inventario tal como sale de la base. */
export type EquipmentRow = typeof branchEquipments.$inferSelect;

/**
 * Fila de `equipment_maintenance_history`, para no repetir el `typeof`.
 * El PUT de `[id]/maintenance` la necesita fuera del servicio para tipar su guarda.
 */
export type MaintenanceRow = typeof equipmentMaintenanceHistory.$inferSelect;

// Types
export interface CreateEquipmentInput {
  companyId: string;
  branchId: string;
  catalogId?: string;
  name: string;
  equipmentCode: string;
  type: string;
  brand?: string;
  model?: string;
  serialNumber?: string;
  assetTag?: string;
  location?: string;
  area?: string;
  specifications?: Record<string, unknown>;
  purchaseDate?: Date;
  purchasePrice?: number;
  vendor?: string;
  vendorContact?: string;
  invoiceNumber?: string;
  status?: string;
  maintenanceFrequency?: string;
  nextMaintenanceDate?: Date;
  isCritical?: boolean;
  notes?: string;
}

export interface UpdateEquipmentInput {
  name?: string;
  equipmentCode?: string;
  brand?: string;
  model?: string;
  serialNumber?: string;
  assetTag?: string;
  location?: string;
  area?: string;
  specifications?: Record<string, unknown>;
  purchaseDate?: Date;
  purchasePrice?: number;
  vendor?: string;
  vendorContact?: string;
  invoiceNumber?: string;
  status?: string;
  statusReason?: string;
  maintenanceFrequency?: string;
  nextMaintenanceDate?: Date;
  lastMaintenanceDate?: Date;
  isCritical?: boolean;
  notes?: string;
}

export interface CreateWarrantyInput {
  equipmentId: string;
  companyId: string;
  warrantyNumber?: string;
  warrantyType?: string;
  provider: string;
  providerContact?: string;
  providerPhone?: string;
  providerEmail?: string;
  coverageDescription?: string;
  warrantyTerms?: string;
  startDate: Date;
  endDate: Date;
  maxClaims?: number;
  warrantyDocumentUrl?: string;
  purchaseReceiptUrl?: string;
  alertDaysBefore?: number;
}

export interface CreateMaintenanceInput {
  equipmentId: string;
  companyId: string;
  branchId: string;
  maintenanceType: string;
  scheduledDate: Date;
  description: string;
  providerType?: string;
  providerName?: string;
  providerContact?: string;
  technicianName?: string;
  technicianLicense?: string;
  workflowInstanceId?: string;
}

export interface CreateComplianceServiceInput {
  companyId: string;
  branchId: string;
  serviceType: string;
  serviceName: string;
  regulationReference?: string;
  isMandatory?: boolean;
  frequency: string;
  customDays?: number;
  providerId?: string;
  providerName?: string;
  providerContact?: string;
  nextServiceDate?: Date;
  serviceAreas?: string[];
  specialInstructions?: string;
  workflowTemplateId?: string;
}

/**
 * Filtros de inventario que acompañan al alcance.
 *
 * No sustituyen al alcance: se suman a él. `companyId` y sucursal los impone el
 * servidor y ningún filtro puede aflojarlos (`getEquipmentByScope`).
 */
export interface EquipmentListFilters {
  status?: string;
  type?: string;
  isCritical?: boolean;
}

export class EquipmentService {
  /**
   * Create a new equipment catalog entry
   */
  async createEquipmentCatalog(data: {
    companyId: string;
    name: string;
    type: string;
    brand?: string;
    model?: string;
    specifications?: Record<string, unknown>;
    defaultMaintenanceFrequency?: string;
    defaultMaintenanceTasks?: unknown[];
    manualUrl?: string;
    technicalSpecsUrl?: string;
    createdBy: string;
  }) {
    const [catalog] = await db
      .insert(equipmentCatalog)
      .values({
        ...data,
      } as any)
      .returning();
    return catalog;
  }

  /**
   * Create a new branch equipment
   * Auto-creates/updates catalog entry and links via catalogId
   */
  async createEquipment(data: CreateEquipmentInput, createdBy: string) {
    let catalogId = data.catalogId;

    if (!catalogId) {
      const existingCatalog = await db
        .select({ id: equipmentCatalog.id })
        .from(equipmentCatalog)
        .where(and(
          eq(equipmentCatalog.companyId, data.companyId),
          eq(equipmentCatalog.name, data.name),
          eq(equipmentCatalog.type, data.type as any),
        ))
        .limit(1);

      if (existingCatalog.length > 0) {
        catalogId = existingCatalog[0].id;
      } else {
        const [catalogEntry] = await db
          .insert(equipmentCatalog)
          .values({
            companyId: data.companyId,
            name: data.name,
            type: data.type as any,
            brand: data.brand || null,
            model: data.model || null,
            specifications: data.specifications || {},
            defaultMaintenanceFrequency: data.maintenanceFrequency || null,
            defaultMaintenanceTasks: [],
            createdBy,
          } as any)
          .returning();
        catalogId = catalogEntry.id;
      }
    }

    const [equipment] = await db
      .insert(branchEquipments)
      .values({
        ...data,
        catalogId,
        createdBy,
      } as any)
      .returning();

    // Create initial maintenance record if nextMaintenanceDate is provided
    if (data.nextMaintenanceDate) {
      await db.insert(equipmentMaintenanceHistory).values({
        id: uuidv4(),
        equipmentId: equipment.id,
        companyId: data.companyId,
        branchId: data.branchId,
        maintenanceType: 'PREVENTIVE',
        status: 'SCHEDULED',
        scheduledDate: data.nextMaintenanceDate,
        description: `Mantenimiento preventivo programado - Frecuencia: ${data.maintenanceFrequency || 'Mensual'}`,
        providerType: 'INTERNAL',
        createdBy,
      });
    }

    // Create alert if warranty is expiring soon
    await this.checkAndCreateWarrantyAlert(equipment.id, data.companyId, data.branchId);

    return equipment;
  }

  /**
   * Get equipment by ID
   */
  /**
   * Un equipo de esta empresa, o `undefined`.
   *
   * `companyId` va dentro del `WHERE` y no es adorno: la consulta anterior
   * buscaba sólo por `id`, así que el `equipmentId` de otra empresa —o de otra
   * sucursal— era alcanzable con tener el id en la mano. La llave foránea no lo
   * impide: la fila existe, sólo que no es tuya.
   */
  async getEquipmentById(equipmentId: string, companyId: string) {
    const [equipment] = await db
      .select()
      .from(branchEquipments)
      .where(and(
        eq(branchEquipments.id, equipmentId),
        eq(branchEquipments.companyId, companyId)
      ))
      .limit(1);
    return equipment;
  }

  /**
   * El equipo que este alcance puede alcanzar: el expediente, no el listado.
   *
   * Filtrar la sucursal en el listado no protegía las rutas por ID. Quien tenía
   * el `equipmentId` entraba igual a un equipo de otra sucursal —e incluso de
   * otra empresa—, porque los servicios por ID consultaban sólo por `id`.
   * Listar es distinto de alcanzar, y esta guarda cubre lo segundo.
   *
   * Los dos rechazos son deliberadamente distintos, y siguen el patrón de
   * `expense-service.ts:52`:
   *
   * - **404** (`ApiError.notFound`): el id no existe *en esta empresa*. También
   *   cubre el id de otra empresa y el id mal escrito, con el mismo mensaje: si
   *   difirieran, quien prueba ids averiguaría qué equipos tienen las demás.
   * - **403** (`assertScopeCoversBranch`): el equipo es de la empresa pero está
   *   fuera del alcance del usuario —otra sucursal, o un rol acotado sin
   *   sucursal asignada—. Aquí la empresa ya está dentro de la frontera del
   *   usuario y callar la causa sólo deja al gerente sin saber a quién pedirle
   *   el cambio.
   */
  async getEquipmentInScope(input: {
    equipmentId: string;
    companyId: string;
    scope: BranchScope;
  }): Promise<EquipmentRow> {
    const equipment = await this.getEquipmentById(input.equipmentId, input.companyId);

    if (!equipment) {
      throw ApiError.notFound(
        "El equipo especificado no fue encontrado. Puede que se haya dado de baja o que ya no exista."
      );
    }

    assertScopeCoversBranch(input.scope, equipment.branchId);

    return equipment;
  }

  /**
   * Get equipment list for an authorized scope.
   *
   * `companyId` sale de la sesión y va dentro del `WHERE`, no de adorno: la
   * versión anterior filtraba sólo por sucursal, así que un `branchId` de otra
   * empresa devolvía su inventario. La sucursal ajena existe —sólo que no es
   * tuya— y la llave foránea no lo detecta.
   *
   * `NONE` devuelve vacío en vez de caer en "sin filtro": es la convención de
   * las listas del repo para un rol de sucursal sin sucursal asignada
   * (`app/api/expenses/route.ts:78`). El vacío no se rotula aquí; distinguirlo
   * de "no hay equipos" es trabajo de la pantalla (T10/T30).
   */
  async getEquipmentByScope(input: {
    companyId: string;
    scope: BranchScope;
    filters?: EquipmentListFilters;
  }) {
    if (input.scope.kind === "NONE") {
      return [];
    }

    const conditions = [eq(branchEquipments.companyId, input.companyId)];

    if (input.scope.kind === "BRANCH") {
      conditions.push(eq(branchEquipments.branchId, input.scope.branchId));
    }

    const filters = input.filters;
    if (filters?.status) {
      conditions.push(eq(branchEquipments.status, filters.status as any));
    }
    if (filters?.type) {
      conditions.push(eq(branchEquipments.type, filters.type as any));
    }
    if (filters?.isCritical !== undefined) {
      conditions.push(eq(branchEquipments.isCritical, filters.isCritical));
    }

    return db
      .select()
      .from(branchEquipments)
      .where(and(...conditions))
      .orderBy(asc(branchEquipments.equipmentCode));
  }

  /**
   * El expediente del equipo: garantías, historial y programación.
   *
   * Recibe la fila ya cargada por `getEquipmentInScope` en vez del `id`. Antes
   * volvía a consultar el equipo por `id` —sin empresa ni sucursal— y esa
   * consulta duplicada era justo el agujero que T03 cierra: una segunda lectura
   * que no pasaba por el alcance. Como el `id` es único, cargar de nuevo sólo
   * agregaba una consulta y un camino sin guarda.
   */
  async getEquipmentWithDetails(equipment: EquipmentRow) {
    // Get active warranties
    const warranties = await db
      .select()
      .from(equipmentWarranties)
      .where(and(
        eq(equipmentWarranties.equipmentId, equipment.id),
        eq(equipmentWarranties.companyId, equipment.companyId),
        eq(equipmentWarranties.status, 'ACTIVE')
      ));

    // Get recent maintenance history
    const maintenance = await db
      .select()
      .from(equipmentMaintenanceHistory)
      .where(and(
        eq(equipmentMaintenanceHistory.equipmentId, equipment.id),
        eq(equipmentMaintenanceHistory.companyId, equipment.companyId)
      ))
      .orderBy(desc(equipmentMaintenanceHistory.scheduledDate))
      .limit(10);

    // Get upcoming scheduled maintenance
    const scheduledMaintenance = await db
      .select()
      .from(equipmentMaintenanceSchedules)
      .where(and(
        eq(equipmentMaintenanceSchedules.equipmentId, equipment.id),
        eq(equipmentMaintenanceSchedules.companyId, equipment.companyId),
        eq(equipmentMaintenanceSchedules.isActive, true)
      ));

    return {
      ...equipment,
      warranties,
      maintenanceHistory: maintenance,
      scheduledMaintenance,
    };
  }

  /**
   * Update equipment
   *
   * `companyId` va en el `WHERE` además de la guarda previa: si alguien llama a
   * este método sin pasar por `getEquipmentInScope`, la escritura sigue sin
   * poder tocar la fila de otra empresa.
   */
  async updateEquipment(
    equipmentId: string,
    companyId: string,
    data: UpdateEquipmentInput,
    updatedBy: string
  ) {
    const [updated] = await db
      .update(branchEquipments)
      .set({
        ...data,
        updatedBy,
        updatedAt: new Date(),
      } as any)
      .where(and(
        eq(branchEquipments.id, equipmentId),
        eq(branchEquipments.companyId, companyId)
      ))
      .returning();
    return updated;
  }

  /**
   * Delete equipment (soft delete by setting status to DISPOSED)
   *
   * Mismo par `(id, companyId)` que la actualización: dar de baja un equipo
   * ajeno era la versión destructiva del mismo agujero.
   */
  async deleteEquipment(equipmentId: string, companyId: string, updatedBy: string) {
    const [updated] = await db
      .update(branchEquipments)
      .set({
        status: 'DISPOSED',
        updatedBy,
        updatedAt: new Date(),
      })
      .where(and(
        eq(branchEquipments.id, equipmentId),
        eq(branchEquipments.companyId, companyId)
      ))
      .returning();
    return updated;
  }

  /**
   * Create equipment warranty
   */
  async createWarranty(data: CreateWarrantyInput, createdBy: string) {
    const [warranty] = await db
      .insert(equipmentWarranties)
      .values({
        id: uuidv4(),
        ...data,
        createdBy,
      })
      .returning();

    return warranty;
  }

  /**
   * Garantías de un equipo, de esta empresa.
   *
   * La empresa va en el `WHERE` además de la guarda del equipo: son dos capas
   * para el mismo hueco. La guarda decide si el usuario alcanza el equipo; esta
   * condición garantiza que, aunque un llamador nuevo se olvide de la guarda, no
   * exista una consulta de garantías capaz de cruzar empresas.
   */
  async getWarrantiesByEquipment(equipmentId: string, companyId: string) {
    return db
      .select()
      .from(equipmentWarranties)
      .where(and(
        eq(equipmentWarranties.equipmentId, equipmentId),
        eq(equipmentWarranties.companyId, companyId)
      ))
      .orderBy(desc(equipmentWarranties.endDate));
  }

  /**
   * Update warranty status
   */
  async updateWarrantyStatus(warrantyId: string, status: string, updatedBy: string) {
    const [updated] = await db
      .update(equipmentWarranties)
      .set({
        status: status as any,
        updatedBy,
        updatedAt: new Date(),
      })
      .where(eq(equipmentWarranties.id, warrantyId))
      .returning();
    return updated;
  }

  /**
   * Create maintenance record
   */
  async createMaintenance(data: CreateMaintenanceInput, createdBy: string) {
    const maintenanceData: Record<string, unknown> = {
      ...data,
      createdBy,
    };
    const [maintenance] = await db
      .insert(equipmentMaintenanceHistory)
      .values(maintenanceData as any)
      .returning();
    return maintenance;
  }

  /**
   * El registro de mantenimiento que este alcance puede cerrar.
   *
   * El `PUT` de `[id]/maintenance` cerraba por el `maintenanceId` que llegaba en
   * el **cuerpo**, sin mirar de quién era. Con ese id en la mano se completaba
   * mantenimiento de otra empresa —y el cierre arrastraba, además, la fecha de
   * último mantenimiento del equipo ajeno—. Es el mismo agujero que
   * `getEquipmentInScope` cierra para el equipo, un nivel más abajo.
   *
   * El `equipmentId` de la ruta va en el `WHERE` a propósito: ata el registro al
   * equipo del URL, así que no se puede cerrar el mantenimiento de un equipo
   * pasando el id de otro. Los rechazos son los mismos que en el expediente —
   * 404 para "no existe en esta empresa", 403 para "fuera de tu sucursal"—.
   */
  async getMaintenanceInScope(input: {
    maintenanceId: string;
    equipmentId: string;
    companyId: string;
    scope: BranchScope;
  }): Promise<MaintenanceRow> {
    const [maintenance] = await db
      .select()
      .from(equipmentMaintenanceHistory)
      .where(and(
        eq(equipmentMaintenanceHistory.id, input.maintenanceId),
        eq(equipmentMaintenanceHistory.equipmentId, input.equipmentId),
        eq(equipmentMaintenanceHistory.companyId, input.companyId)
      ))
      .limit(1);

    if (!maintenance) {
      throw ApiError.notFound("El registro de mantenimiento especificado no fue encontrado.");
    }

    assertScopeCoversBranch(input.scope, maintenance.branchId);

    return maintenance;
  }

  /**
   * Complete maintenance record
   *
   * `companyId` entra en los dos `WHERE`: al registro de mantenimiento y al
   * equipo cuya fecha de último mantenimiento se actualiza. Sin el segundo, un
   * cierre legítimo podía escribir sobre el equipo de otra empresa si el
   * registro apuntaba a uno ajeno —el `equipmentId` que trae la fila se usaba
   * como única condición—.
   */
  async completeMaintenance(
    maintenanceId: string,
    companyId: string,
    data: {
      workPerformed: string;
      tasksCompleted?: unknown[];
      partsUsed?: unknown[];
      partsCost?: number;
      laborCost?: number;
      totalCost?: number;
      findings?: string;
      recommendations?: string;
      nextMaintenanceDate?: Date;
      beforePhotos?: string[];
      afterPhotos?: string[];
      documents?: string[];
      signatureUrl?: string;
      approvedBy?: string;
    },
    updatedBy: string
  ) {
    const [updated] = await db
      .update(equipmentMaintenanceHistory)
      .set({
        ...data,
        status: 'COMPLETED',
        completedDate: new Date(),
        updatedBy,
        updatedAt: new Date(),
      })
      .where(and(
        eq(equipmentMaintenanceHistory.id, maintenanceId),
        eq(equipmentMaintenanceHistory.companyId, companyId)
      ))
      .returning();

    // Update equipment last maintenance date
    if (updated) {
      await db
        .update(branchEquipments)
        .set({
          lastMaintenanceDate: updated.completedDate,
          nextMaintenanceDate: data.nextMaintenanceDate,
          updatedAt: new Date(),
        })
        .where(and(
          eq(branchEquipments.id, updated.equipmentId),
          eq(branchEquipments.companyId, companyId)
        ));
    }

    return updated;
  }

  /**
   * Get maintenance history
   */
  async getMaintenanceHistory(equipmentId: string, companyId: string, limit?: number) {
    let query = db
      .select()
      .from(equipmentMaintenanceHistory)
      .where(and(
        eq(equipmentMaintenanceHistory.equipmentId, equipmentId),
        eq(equipmentMaintenanceHistory.companyId, companyId)
      ))
      .orderBy(desc(equipmentMaintenanceHistory.scheduledDate));

    if (limit) {
      query = query.limit(limit) as any;
    }

    return query;
  }

  /**
   * Get upcoming maintenance for branch
   */
  async getUpcomingMaintenance(branchId: string, days: number = 30) {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + days);

    return db
      .select({
        maintenance: equipmentMaintenanceHistory,
        equipment: branchEquipments,
      })
      .from(equipmentMaintenanceHistory)
      .innerJoin(
        branchEquipments,
        eq(equipmentMaintenanceHistory.equipmentId, branchEquipments.id)
      )
      .where(and(
        eq(equipmentMaintenanceHistory.branchId, branchId),
        eq(equipmentMaintenanceHistory.status, 'SCHEDULED'),
        lte(equipmentMaintenanceHistory.scheduledDate, futureDate)
      ))
      .orderBy(asc(equipmentMaintenanceHistory.scheduledDate));
  }

  /**
   * Create compliance service configuration
   *
   * Los servicios periódicos viven en una sucursal y pueden contratar a un
   * proveedor. Hasta T04 ninguno de los dos se comprobaba: el `branchId` y el
   * `providerId` del cuerpo se insertaban tal cual, y la llave foránea no
   * impide la fila cruzada —la sucursal y el proveedor de otra empresa
   * existen, sólo que no son tuyos—.
   */
  async createComplianceService(data: CreateComplianceServiceInput, createdBy: string) {
    await assertBranchOfCompany(data.companyId, data.branchId);

    if (data.providerId) {
      const [provider] = await db
        .select({ id: serviceProviders.id })
        .from(serviceProviders)
        .where(and(
          eq(serviceProviders.id, data.providerId),
          eq(serviceProviders.companyId, data.companyId)
        ))
        .limit(1);
      if (!provider) {
        throw ApiError.badRequest("El proveedor de servicio indicado no pertenece a la empresa");
      }
    }

    const serviceData: Record<string, unknown> = {
      ...data,
      providerId: data.providerId || null,
      workflowTemplateId: data.workflowTemplateId || null,
      createdBy,
    };
    const [service] = await db
      .insert(branchComplianceServices)
      .values(serviceData as any)
      .returning();
    return service;
  }

  /**
   * Get compliance services by branch or company
   */
  async getComplianceServicesByBranch(branchId?: string, companyId?: string) {
    const conditions = [eq(branchComplianceServices.isActive, true)];

    if (companyId) {
      conditions.push(eq(branchComplianceServices.companyId, companyId));
    }

    if (branchId && branchId !== "ALL") {
      conditions.push(eq(branchComplianceServices.branchId, branchId));
    }

    return db
      .select({
        service: branchComplianceServices,
        provider: serviceProviders,
        branch: branches,
      })
      .from(branchComplianceServices)
      .leftJoin(
        serviceProviders,
        eq(branchComplianceServices.providerId, serviceProviders.id)
      )
      .leftJoin(
        branches,
        eq(branchComplianceServices.branchId, branches.id)
      )
      .where(and(...conditions))
      .orderBy(asc(branchComplianceServices.nextServiceDate));
  }

  /**
   * Record compliance service execution
   */
  async recordComplianceService(
    serviceConfigId: string,
    data: {
      companyId: string;
      branchId: string;
      serviceType: string;
      serviceName: string;
      scheduledDate: Date;
      completedDate?: Date;
      providerId?: string;
      providerName?: string;
      technicianName?: string;
      technicianLicense?: string;
      description?: string;
      workPerformed?: string;
      areasServiced?: string[];
      result?: string;
      findings?: string;
      recommendations?: string;
      followUpRequired?: boolean;
      followUpDate?: Date;
      cost?: number;
      invoiceNumber?: string;
      certificateUrl?: string;
      reportUrl?: string;
      photos?: string[];
      documents?: string[];
      signatureUrl?: string;
      complianceStatus?: string;
      nextDueDate?: Date;
      workflowInstanceId?: string;
      approvedBy?: string;
    },
    createdBy: string
  ) {
    const historyData: Record<string, unknown> = {
      serviceConfigId,
      ...data,
      createdBy,
    };
    const [record] = await db
      .insert(complianceServiceHistory)
      .values(historyData as any)
      .returning();

    // Update service config last/next dates
    await db
      .update(branchComplianceServices)
      .set({
        lastServiceDate: data.completedDate || new Date(),
        nextServiceDate: data.nextDueDate,
        updatedAt: new Date(),
      })
      .where(eq(branchComplianceServices.id, serviceConfigId));

    return record;
  }

  /**
   * Get compliance service history
   */
  async getComplianceServiceHistory(branchId: string, serviceConfigId?: string) {
    const conditions = [eq(complianceServiceHistory.branchId, branchId)];

    if (serviceConfigId) {
      conditions.push(eq(complianceServiceHistory.serviceConfigId, serviceConfigId));
    }

    return db
      .select()
      .from(complianceServiceHistory)
      .where(and(...conditions))
      .orderBy(desc(complianceServiceHistory.scheduledDate));
  }

  /**
   * Create equipment alert
   */
  async createAlert(data: {
    companyId: string;
    branchId: string;
    equipmentId?: string;
    serviceConfigId?: string;
    alertType: string;
    severity: string;
    title: string;
    description?: string;
    dueDate?: Date;
  }) {
    const [alert] = await db
      .insert(equipmentAlerts)
      .values({
        id: uuidv4(),
        ...data,
      })
      .returning();
    return alert;
  }

  /**
   * Get active alerts
   */
  async getActiveAlerts(branchId: string) {
    return db
      .select({
        alert: equipmentAlerts,
        equipment: branchEquipments,
        service: branchComplianceServices,
      })
      .from(equipmentAlerts)
      .leftJoin(
        branchEquipments,
        eq(equipmentAlerts.equipmentId, branchEquipments.id)
      )
      .leftJoin(
        branchComplianceServices,
        eq(equipmentAlerts.serviceConfigId, branchComplianceServices.id)
      )
      .where(and(
        eq(equipmentAlerts.branchId, branchId),
        eq(equipmentAlerts.status, 'ACTIVE')
      ))
      .orderBy(desc(equipmentAlerts.severity), asc(equipmentAlerts.dueDate));
  }

  /**
   * Acknowledge alert
   */
  async acknowledgeAlert(alertId: string, userId: string) {
    const [updated] = await db
      .update(equipmentAlerts)
      .set({
        status: 'ACKNOWLEDGED',
        acknowledgedBy: userId,
        acknowledgedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(equipmentAlerts.id, alertId))
      .returning();
    return updated;
  }

  /**
   * Resolve alert
   */
  async resolveAlert(alertId: string, userId: string, notes?: string) {
    const [updated] = await db
      .update(equipmentAlerts)
      .set({
        status: 'RESOLVED',
        resolvedBy: userId,
        resolvedAt: new Date(),
        resolutionNotes: notes,
        updatedAt: new Date(),
      })
      .where(eq(equipmentAlerts.id, alertId))
      .returning();
    return updated;
  }

  /**
   * Check and create warranty expiration alerts
   */
  private async checkAndCreateWarrantyAlert(equipmentId: string, companyId: string, branchId: string) {
    const warranties = await db
      .select()
      .from(equipmentWarranties)
      .where(and(
        eq(equipmentWarranties.equipmentId, equipmentId),
        eq(equipmentWarranties.status, 'ACTIVE')
      ));

    const now = new Date();
    for (const warranty of warranties) {
      const alertThreshold = new Date(warranty.endDate);
      alertThreshold.setDate(alertThreshold.getDate() - (warranty.alertDaysBefore || 30));

      if (now >= alertThreshold && now < warranty.endDate) {
        // Check if alert already exists
        const existingAlerts = await db
          .select()
          .from(equipmentAlerts)
          .where(and(
            eq(equipmentAlerts.equipmentId, equipmentId),
            eq(equipmentAlerts.alertType, 'WARRANTY_EXPIRING'),
            eq(equipmentAlerts.status, 'ACTIVE')
          ));

        if (existingAlerts.length === 0) {
          await this.createAlert({
            companyId,
            branchId,
            equipmentId,
            alertType: 'WARRANTY_EXPIRING',
            severity: 'HIGH',
            title: 'Garantía por vencer',
            description: `La garantía con ${warranty.provider} vence el ${warranty.endDate.toLocaleDateString()}`,
            dueDate: warranty.endDate,
          });
        }
      }
    }
  }

  /**
   * Get equipment statistics for dashboard
   */
  async getEquipmentStats(branchId?: string | null, companyId?: string | null) {
    const conditions = [];
    if (branchId && branchId !== 'ALL' && branchId !== 'all') {
      conditions.push(eq(branchEquipments.branchId, branchId));
    } else if (companyId) {
      conditions.push(eq(branchEquipments.companyId, companyId));
    }

    const equipment = await db
      .select()
      .from(branchEquipments)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    const stats = {
      total: equipment.length,
      active: equipment.filter(e => e.status === 'ACTIVE').length,
      underMaintenance: equipment.filter(e => e.status === 'UNDER_MAINTENANCE').length,
      outOfOrder: equipment.filter(e => e.status === 'OUT_OF_ORDER').length,
      critical: equipment.filter(e => e.isCritical).length,
      byType: {} as Record<string, number>,
    };

    // Count by type
    for (const item of equipment) {
      stats.byType[item.type] = (stats.byType[item.type] || 0) + 1;
    }

    return stats;
  }

  /**
   * Get overdue maintenance
   */
  async getOverdueMaintenance(branchId: string) {
    const now = new Date();

    return db
      .select({
        maintenance: equipmentMaintenanceHistory,
        equipment: branchEquipments,
      })
      .from(equipmentMaintenanceHistory)
      .innerJoin(
        branchEquipments,
        eq(equipmentMaintenanceHistory.equipmentId, branchEquipments.id)
      )
      .where(and(
        eq(equipmentMaintenanceHistory.branchId, branchId),
        eq(equipmentMaintenanceHistory.status, 'SCHEDULED'),
        lte(equipmentMaintenanceHistory.scheduledDate, now)
      ))
      .orderBy(asc(equipmentMaintenanceHistory.scheduledDate));
  }

  /**
   * Get equipment requiring maintenance soon
   */
  async getEquipmentRequiringMaintenance(branchId: string, days: number = 7) {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + days);

    return db
      .select()
      .from(branchEquipments)
      .where(and(
        eq(branchEquipments.branchId, branchId),
        eq(branchEquipments.status, 'ACTIVE'),
        or(
          isNull(branchEquipments.nextMaintenanceDate),
          lte(branchEquipments.nextMaintenanceDate, futureDate)
        )
      ))
      .orderBy(asc(branchEquipments.nextMaintenanceDate));
  }
}

// Export singleton instance
export const equipmentService = new EquipmentService();
