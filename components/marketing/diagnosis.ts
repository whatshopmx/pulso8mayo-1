const DIAGNOSIS_PHONE = "528128924435"

export function diagnosisHref(plan?: string) {
  const message = plan
    ? `Hola, quiero solicitar un diagnóstico guiado para mi operación. Me interesa conocer el plan ${plan}.`
    : "Hola, quiero solicitar un diagnóstico guiado para mi operación con Pulso."

  return `https://wa.me/${DIAGNOSIS_PHONE}?text=${encodeURIComponent(message)}`
}
