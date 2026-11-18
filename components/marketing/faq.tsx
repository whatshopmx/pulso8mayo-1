import { Plus } from "lucide-react"

const FAQ_ITEMS = [
  {
    question: "¿Necesito conectar mi punto de venta para empezar?",
    answer:
      "No. Puedes arrancar con workflows, inventario, compras y gastos. Cuando quieras usar los cortes de venta, Pulso permite cargarlos y mapear sus columnas sin cambiar de sistema.",
  },
  {
    question: "¿Puedo registrar gastos desde WhatsApp?",
    answer:
      "Hoy no. WhatsApp ejecuta tareas, registra asistencia y recibe evidencia fotográfica. El gasto se registra en el dashboard, donde se liga al presupuesto y a la autorización que corresponda.",
  },
  {
    question: "¿Se integra con mi ERP o con mi contabilidad?",
    answer:
      "Todavía no hay un conector bidireccional con ERP. Pulso genera pólizas, exportaciones y comprobantes CFDI; la integración con sistemas contables externos está en el roadmap y no se ofrece como capacidad actual.",
  },
  {
    question: "¿Pulso certifica NOM-251 y NOM-035?",
    answer:
      "No. Pulso documenta la operación, conserva la evidencia y genera reportes auditables. La certificación la emite la autoridad; lo que la plataforma hace es que llegar a la revisión no dependa de carpetas y memoria.",
  },
  {
    question: "¿Cómo se cobra?",
    answer:
      "Por sucursales incluidas, no por usuario. Foundation cubre hasta 5 sucursales, Growth hasta 15 y Executive hasta 50. El precio se confirma en la propuesta, según el tamaño y la configuración de tu operación.",
  },
  {
    question: "¿Dónde vive la evidencia y quién puede verla?",
    answer:
      "En almacenamiento privado, con lecturas firmadas y alcance por empresa y sucursal. Los roles definen qué puede ver y hacer cada persona; un gerente no ve la información de una sucursal que no le corresponde.",
  },
]

export function Faq() {
  return (
    <div className="mt-10 border-t border-[var(--l-line)]">
      {FAQ_ITEMS.map((item) => (
        <details key={item.question} className="group border-b border-[var(--l-line)]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 [&::-webkit-details-marker]:hidden">
            <span className="text-[1rem] font-medium text-[var(--l-ink)]">{item.question}</span>
            <Plus
              aria-hidden
              className="size-4 shrink-0 text-[var(--l-ink-faint)] transition-transform duration-200 group-open:rotate-45"
            />
          </summary>
          <p className="max-w-[62ch] pb-6 text-[0.9375rem] leading-relaxed text-[var(--l-ink-soft)]">
            {item.answer}
          </p>
        </details>
      ))}
    </div>
  )
}
