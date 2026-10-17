/**
 * Tipos canónicos de excepción — una sola fuente de verdad.
 *
 * Se derivan de los enums del schema (`lib/db/schema/exceptions.ts`) con
 * `import type`, de modo que los módulos puros (lifecycle, SLA) tipan contra el
 * schema sin arrastrar Drizzle al bundle en runtime.
 */
import type {
  exceptionDomainEnum,
  exceptionSeverityEnum,
  qsrRiskCategoryEnum,
  exceptionStatusEnum,
} from "@/lib/db/schema/exceptions";

export type ExceptionDomain = (typeof exceptionDomainEnum.enumValues)[number];
export type ExceptionSeverity = (typeof exceptionSeverityEnum.enumValues)[number];
export type QsrRiskCategory = (typeof qsrRiskCategoryEnum.enumValues)[number];
export type ExceptionStatus = (typeof exceptionStatusEnum.enumValues)[number];

/** Metadata de la acción sugerida que viaja en `exceptions.action_meta`. */
export interface ExceptionActionMeta {
  type?: string;
  label?: string;
  url?: string;
  whatsappSuggestedMessage?: string;
}
