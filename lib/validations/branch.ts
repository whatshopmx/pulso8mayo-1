import { z } from "zod";
import { isRegistroPatronal } from '@/lib/services/compliance/imss-registro';

const imssRegistroPatronalSchema = z.string().trim().toUpperCase()
  .refine(value => value === '' || isRegistroPatronal(value), 'Registro patronal: 11 caracteres, primero letra o número y después 10 dígitos')
  .transform(value => value || null).nullable().optional();

// Schema for operating hours configuration
export const operatingHoursSchema = z.object({
  monday: z.object({
    open: z.string().regex(/^\d{2}:\d{2}$/, "Formato de hora inválido (HH:MM)").optional(),
    close: z.string().regex(/^\d{2}:\d{2}$/, "Formato de hora inválido (HH:MM)").optional(),
    isOpen: z.boolean().optional()
  }).optional(),
  tuesday: z.object({
    open: z.string().regex(/^\d{2}:\d{2}$/, "Formato de hora inválido (HH:MM)").optional(),
    close: z.string().regex(/^\d{2}:\d{2}$/, "Formato de hora inválido (HH:MM)").optional(),
    isOpen: z.boolean().optional()
  }).optional(),
  wednesday: z.object({
    open: z.string().regex(/^\d{2}:\d{2}$/, "Formato de hora inválido (HH:MM)").optional(),
    close: z.string().regex(/^\d{2}:\d{2}$/, "Formato de hora inválido (HH:MM)").optional(),
    isOpen: z.boolean().optional()
  }).optional(),
  thursday: z.object({
    open: z.string().regex(/^\d{2}:\d{2}$/, "Formato de hora inválido (HH:MM)").optional(),
    close: z.string().regex(/^\d{2}:\d{2}$/, "Formato de hora inválido (HH:MM)").optional(),
    isOpen: z.boolean().optional()
  }).optional(),
  friday: z.object({
    open: z.string().regex(/^\d{2}:\d{2}$/, "Formato de hora inválido (HH:MM)").optional(),
    close: z.string().regex(/^\d{2}:\d{2}$/, "Formato de hora inválido (HH:MM)").optional(),
    isOpen: z.boolean().optional()
  }).optional(),
  saturday: z.object({
    open: z.string().regex(/^\d{2}:\d{2}$/, "Formato de hora inválido (HH:MM)").optional(),
    close: z.string().regex(/^\d{2}:\d{2}$/, "Formato de hora inválido (HH:MM)").optional(),
    isOpen: z.boolean().optional()
  }).optional(),
  sunday: z.object({
    open: z.string().regex(/^\d{2}:\d{2}$/, "Formato de hora inválido (HH:MM)").optional(),
    close: z.string().regex(/^\d{2}:\d{2}$/, "Formato de hora inválido (HH:MM)").optional(),
    isOpen: z.boolean().optional()
  }).optional()
});

export const locationSchema = z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180)
});

/**
 * C22 — la propiedad de la sucursal.
 *
 * `ownershipType` y `franchiseeUserId` existían en el esquema desde antes y
 * **nada podía escribirlos**: ni este contrato, ni el servicio, ni la API, ni
 * una pantalla. Toda sucursal era `OWNED` para siempre y `franchiseeUserId`
 * siempre `null`, así que el aislamiento de franquicias (`lib/rbac/`) no tenía
 * nada que decidir en producción. Capturarlos es el primer criterio de
 * aceptación de C22: antes de separar una red hay que poder distinguir sus
 * partes.
 *
 * La regla de `FRANCHISE` no es decorativa: `branchVisibilityFilter` sólo
 * muestra una sucursal franquiciada al usuario cuyo id es su
 * `franchiseeUserId`. Una franquicia sin responsable sería invisible para su
 * propio franquiciatario, así que el contrato la rechaza en lugar de guardar
 * algo que no se puede ver.
 */
const ownershipTypeSchema = z.enum(["OWNED", "FRANCHISE"], {
  error: "Elige si la sucursal es propia o franquicia.",
});

const ownershipFields = {
  ownershipType: ownershipTypeSchema.optional(),
  franchiseeUserId: z.string().uuid("El franquiciatario responsable debe ser un usuario.").nullable().optional(),
} as const;

type OwnershipShape = {
  ownershipType?: "OWNED" | "FRANCHISE" | undefined;
  franchiseeUserId?: string | null | undefined;
};

/**
 * Una sucursal franquiciada sin responsable no es una sucursal: es una unidad
 * que su propio franquiciatario no podría ver. Se rechaza nombrando el campo,
 * no con un error genérico.
 */
function exigeFranquiciatarioSiAplica(value: OwnershipShape, ctx: z.RefinementCtx): void {
  if (value.ownershipType !== "FRANCHISE") return;
  if (value.franchiseeUserId) return;
  ctx.addIssue({
    code: "custom",
    path: ["franchiseeUserId"],
    message: "Elige quién responde por la sucursal: sin franquiciatario no se puede ver.",
  });
}

export const createBranchSchema = z
  .object({
    name: z.string().min(2, "El nombre de la sucursal es requerido"),
    code: z.string().optional(),
    imssRegistroPatronal: imssRegistroPatronalSchema,
    address: z.string().optional(),
    timezone: z.string().default("America/Mexico_City"),
    companyId: z.string().uuid().optional(),
    operatingHours: operatingHoursSchema.optional(),
    location: locationSchema.optional(),
    managerId: z.string().nullable().optional(),
    ...ownershipFields,
  })
  .superRefine(exigeFranquiciatarioSiAplica);

export const updateBranchSchema = z
  .object({
    name: z.string().min(2).optional(),
    code: z.string().optional(),
    imssRegistroPatronal: imssRegistroPatronalSchema,
    address: z.string().optional(),
    timezone: z.string().optional(),
    active: z.boolean().optional(),
    operatingHours: operatingHoursSchema.optional(),
    location: locationSchema.optional(),
    managerId: z.string().nullable().optional(),
    ...ownershipFields,
  })
  .superRefine(exigeFranquiciatarioSiAplica);

export type CreateBranchInput = z.infer<typeof createBranchSchema>;
export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;
export type OperatingHoursInput = z.infer<typeof operatingHoursSchema>;
export type LocationInput = z.infer<typeof locationSchema>;
