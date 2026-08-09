import "dotenv/config";
import { db } from "@/lib/db";
import { workflowTemplates } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * Reescribe las condiciones de logicRules y branches ya guardadas en
 * workflow_templates.
 *
 * Las plantillas se sembraron desde templates/*.json, así que corregir los JSON
 * no arregla las filas existentes ni las copias que los usuarios crearon desde
 * el builder. Este script aplica el mismo mapeo sobre la base, por coincidencia
 * exacta de la condición, y es idempotente.
 *
 *   npx tsx scripts/fix-logic-rule-conditions.ts           # simulación
 *   npx tsx scripts/fix-logic-rule-conditions.ts --apply   # escribe
 */

/** Condición vieja → condición nueva. Coincidencia exacta, sin regex. */
const CONDITION_MAP: Record<string, string> = {
    // Pasos de foto cuya verificación por IA ya hace la comprobación
    "expiry_date < today || company_mismatch": "ai_verification_failed",
    "expiry_date < today": "ai_verification_failed",
    "cameraNotWorking": "ai_verification_failed",
    "extinguisherExpired": "ai_verification_failed",
    "ai_verification_detected_equipment_on": "ai_verification_failed",
    "expiredProductsDetected": "ai_verification_failed",
    "foodTemperature < 60": "ai_verification_failed",
    "documento_faltante": "ai_verification_failed",

    // Nombre del campo: el alias es el slug del título del paso
    "tipo_incidente == 'Intoxicación alimentaria'": "tipo_de_incidente == 'Intoxicación alimentaria'",
    "tipo_incidente == 'Alergia alimentaria'": "tipo_de_incidente == 'Alergia alimentaria'",
    "tipo_incidente == 'Accidente'": "tipo_de_incidente == 'Accidente'",

    // IN es SQL, no JavaScript
    "gerente_notificado == false && severidad IN ['Alta', 'Crítica']":
        "gerente_notificado == false && (severidad == 'Alta' || severidad == 'Crítica')",

    // Respuestas de sí/no: el valor se normaliza a booleano
    "value == 'no'": "value == false",
    "value == 'Sí' || value == true || value == 'true'": "value == true",
    "value == 'yes' || value == 'si'": "value == true",
    "no": "value == false",
    "yes": "value == true",
};

/**
 * Etiquetas de opción usadas como condición de branch: se convierten en una
 * igualdad explícita contra el valor del paso.
 */
function branchLabelToExpression(condition: string, options: unknown): string | null {
    if (!Array.isArray(options)) return null;

    const labels = options
        .map(o => (typeof o === "string" ? o : (o as { value?: string; label?: string })?.value ?? (o as { label?: string })?.label))
        .filter((o): o is string => typeof o === "string");

    if (!labels.includes(condition)) return null;
    return `value == '${condition.replace(/'/g, "\\'")}'`;
}

interface EditableStep {
    id: string;
    options?: unknown;
    config?: { options?: unknown };
    logicRules?: Array<{ condition: string }>;
    branches?: Array<{ condition: string }>;
}

interface Rewrite {
    templateId: string;
    kind: "regla" | "branch";
    stepId: string;
    from: string;
    to: string;
}

async function main() {
    const apply = process.argv.includes("--apply");

    const templates = await db
        .select({ id: workflowTemplates.id, name: workflowTemplates.name, steps: workflowTemplates.steps })
        .from(workflowTemplates);

    const rewrites: Rewrite[] = [];
    let touchedTemplates = 0;

    for (const template of templates) {
        const steps = (template.steps ?? []) as EditableStep[];
        if (!Array.isArray(steps) || steps.length === 0) continue;

        let changed = false;

        for (const step of steps) {
            for (const rule of (step.logicRules ?? [])) {
                const next = CONDITION_MAP[rule.condition];
                if (next && next !== rule.condition) {
                    rewrites.push({ templateId: template.id, kind: "regla", stepId: step.id, from: rule.condition, to: next });
                    rule.condition = next;
                    changed = true;
                }
            }

            for (const branch of (step.branches ?? [])) {
                const mapped = CONDITION_MAP[branch.condition]
                    ?? branchLabelToExpression(branch.condition, step.options ?? step.config?.options);
                if (mapped && mapped !== branch.condition) {
                    rewrites.push({ templateId: template.id, kind: "branch", stepId: step.id, from: branch.condition, to: mapped });
                    branch.condition = mapped;
                    changed = true;
                }
            }
        }

        if (changed) {
            touchedTemplates++;
            if (apply) {
                await db
                    .update(workflowTemplates)
                    .set({ steps: steps as unknown as typeof workflowTemplates.$inferInsert["steps"] })
                    .where(eq(workflowTemplates.id, template.id));
            }
        }
    }

    for (const r of rewrites) {
        console.log(`${r.templateId} · ${r.stepId} · ${r.kind}`);
        console.log(`    - ${r.from}`);
        console.log(`    + ${r.to}`);
    }

    console.log(
        `\n${rewrites.length} condiciones en ${touchedTemplates} plantillas` +
        (apply ? " — ESCRITAS" : " — simulación, nada escrito (usa --apply)")
    );

    process.exit(0);
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
