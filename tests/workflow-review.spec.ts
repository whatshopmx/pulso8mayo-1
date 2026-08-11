import { test, expect } from "@playwright/test";
import { BRANCH_POLANCO, COMPANY_ID, E2E_TAG, USER_SUPER_ADMIN } from "./support/constants";
import { cleanupReviewInstance, renameReviewTemplateStep, seedReviewInstance } from "./support/db";

/**
 * Revisión de workflows: bucle de decisión, bitácora y durabilidad del acta.
 *
 * Bucle de decisión (plan `tasks/plan-workflow-review-critique.md`, T8a):
 * rechazar sin motivo no se puede enviar; rechazo y aprobación aterrizan en el
 * historial con el veredicto en la fila señalada (`?revisada`) y persisten vía
 * la API de ejecuciones.
 *
 * Bitácora (plan `tasks/plan-workflow-review-bitacora.md`): cada paso muestra su
 * título real unido desde la definición — nunca "Step <id>" —, la respuesta
 * interpretada según el tipo, y la numeración canónica del flujo aunque el tab
 * filtre pasos del medio. Los pasos con hallazgo llegan expandidos; los limpios,
 * colapsados, y por ahí pasa el camino de teclado.
 *
 * Durabilidad: con la definición congelada en la instancia (migración 0050),
 * editar la plantilla no reescribe un acta ya ejecutada, y un paso dinámico que
 * nunca existió en la plantilla conserva su título.
 *
 * NOTA: las navegaciones usan `waitUntil: "domcontentloaded"` a propósito. Los
 * pasos con hallazgo se auto-expanden y con ellos sus miniaturas de evidencia,
 * que en los seeds apuntan a un dominio inexistente (`example.test`): esperar el
 * evento `load` sería esperar a que esas imágenes fallen por timeout de DNS.
 */

// Pasos con el 3 fallando a propósito y el resto verificado por IA: el tab
// "Requiere atención" debe decir "Paso 3" aunque sea la única fila filtrada.
// El paso 4 lleva evidencia *sin* hallazgo: es el que prueba el camino de
// teclado, porque llega colapsado (los pasos con hallazgo se auto-expanden).
function pasosDesalineados() {
  return [
    { stepId: "paso-1", passed: true, confidence: 0.97 },
    { stepId: "paso-2", passed: true, confidence: 0.94 },
    {
      stepId: "paso-3",
      passed: false,
      confidence: 0.61,
      reason: "La etiqueta no coincide con lo declarado en el pedido",
      evidenceUrl: "https://example.test/e2e/evidencia-paso-3.jpg",
      comment: "Temperatura fuera de rango en la cámara",
      value: "18.5",
    },
    {
      stepId: "paso-4",
      passed: true,
      confidence: 0.92,
      evidenceUrl: "https://example.test/e2e/evidencia-paso-4.jpg",
    },
    { stepId: "paso-5", passed: true, confidence: 0.90 },
  ];
}

test.describe("Revisión de workflows — bucle de decisión y superficie (T8)", () => {
  let seeded: { instanceId: string; workflowTemplateId: string };

  test.afterEach(async () => {
    if (seeded) await cleanupReviewInstance(seeded.instanceId, seeded.workflowTemplateId);
  });

  test("rechazo: exige motivo, aterriza en el historial y persiste el veredicto", async ({ page }) => {
    const razon = `${E2E_TAG} Sin condiciones de frío en la cámara`;
    seeded = await seedReviewInstance(COMPANY_ID, {
      branchId: BRANCH_POLANCO,
      assigneeId: USER_SUPER_ADMIN,
      score: 80,
      steps: [
        {
          stepId: "paso-1",
          passed: false,
          confidence: 0.58,
          reason: "Evidencia ilegible",
          evidenceUrl: "https://example.test/e2e/evidencia.jpg",
          comment: "No se distingue el lote",
        },
        { stepId: "paso-2", passed: true, confidence: 0.95 },
      ],
    });

    await page.goto(`/dashboard/workflows/review/${seeded.instanceId}`, { waitUntil: "domcontentloaded" });

    // Superficie sin ambigüedad: cabecera "Completado" + barra de decisión activa.
    await expect(page.getByText("Completado", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Aprobar", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Rechazar", exact: true })).toBeVisible();

    // Semántica de puntuación con tokens: 80 % → amber (text-warning-text).
    await expect(page.getByText("80%", { exact: true })).toHaveClass(/text-warning-text/);

    // Rechazar sin motivo: el botón del diálogo queda deshabilitado y no se envía.
    await page.getByRole("button", { name: "Rechazar", exact: true }).click();
    const dialogo = page.getByRole("dialog");
    await expect(dialogo).toBeVisible();
    await expect(page.getByRole("heading", { name: "Rechazar Workflow" })).toBeVisible();
    const confirmar = dialogo.getByRole("button", { name: "Rechazar", exact: true });
    await expect(confirmar).toBeDisabled();

    // Con motivo se habilita y se envía.
    await dialogo.getByPlaceholder("Agrega tu comentario aquí...").fill(razon);
    await expect(confirmar).toBeEnabled();
    await confirmar.click();

    // Aterriza en el historial con la fila señalada y el veredicto visible; el
    // enlace "Ver" de una fila revisada apunta a la vista de revisión. El
    // atributo es booleano (data-revisada="true"), por eso se busca por presencia.
    await page.waitForURL(/\/dashboard\/workflows\/history/, { timeout: 30_000 });
    const fila = page.locator("tr[data-revisada]");
    await expect(fila).toContainText("Rechazado");
    await expect(fila.getByRole("link")).toHaveAttribute(
      "href",
      `/dashboard/workflows/review/${seeded.instanceId}`
    );

    // Persistencia verificada desde la API, no solo del DOM.
    const res = await page.request.get(`/api/workflows/executions/${seeded.instanceId}`);
    expect(res.ok(), await res.text()).toBeTruthy();
    const ejecucion = await res.json();
    expect(ejecucion.reviewStatus).toBe("REJECTED");
    expect(ejecucion.reviewComment).toBe(razon);

    // Y al volver a la vista de revisión, cabecera y barra de decisión coinciden
    // en el veredicto — nunca "Completado" a la vez que "Rechazado". La fecha de
    // revisión vive en un span propio ("el 10 de agosto de 2026"), hermano del
    // span del veredicto, sin espacio entre ambos en el textContent.
    await page.goto(`/dashboard/workflows/review/${seeded.instanceId}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Rechazado", { exact: true })).toHaveCount(2);
    await expect(page.getByText(/^el \d{1,2} de/)).toBeVisible();
    await expect(page.getByText("Completado", { exact: true })).toHaveCount(0);
  });

  test("aprobación: historial muestra Aprobado y persiste el veredicto", async ({ page }) => {
    seeded = await seedReviewInstance(COMPANY_ID, {
      branchId: BRANCH_POLANCO,
      assigneeId: USER_SUPER_ADMIN,
      score: 95,
      steps: [
        { stepId: "paso-1", passed: true, confidence: 0.97 },
        { stepId: "paso-2", passed: true, confidence: 0.93 },
      ],
    });

    await page.goto(`/dashboard/workflows/review/${seeded.instanceId}`, { waitUntil: "domcontentloaded" });

    // 95 % → success (verde).
    await expect(page.getByText("95%", { exact: true })).toHaveClass(/text-success/);

    await page.getByRole("button", { name: "Aprobar", exact: true }).click();
    const dialogo = page.getByRole("dialog");
    await expect(dialogo).toBeVisible();
    // Aprobar no exige motivo: se puede confirmar de inmediato.
    const confirmar = dialogo.getByRole("button", { name: "Aprobar", exact: true });
    await expect(confirmar).toBeEnabled();
    await confirmar.click();

    await page.waitForURL(/\/dashboard\/workflows\/history/, { timeout: 30_000 });
    const fila = page.locator("tr[data-revisada]");
    await expect(fila).toContainText("Aprobado");

    const res = await page.request.get(`/api/workflows/executions/${seeded.instanceId}`);
    expect(res.ok(), await res.text()).toBeTruthy();
    const ejecucion = await res.json();
    expect(ejecucion.reviewStatus).toBe("APPROVED");

    // Cabecera y barra de decisión en acuerdo al volver a la vista. La fecha de
    // revisión es un span hermano del veredicto: "Aprobado" + "el 10 de agosto…".
    await page.goto(`/dashboard/workflows/review/${seeded.instanceId}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Aprobado", { exact: true })).toHaveCount(2);
    await expect(page.getByText(/^el \d{1,2} de/)).toBeVisible();
    await expect(page.getByText("Completado", { exact: true })).toHaveCount(0);
  });

  test("la bitácora numera los pasos por su posición real (Paso 3)", async ({ page }) => {
    seeded = await seedReviewInstance(COMPANY_ID, {
      branchId: BRANCH_POLANCO,
      assigneeId: USER_SUPER_ADMIN,
      score: 82,
      steps: pasosDesalineados(),
    });

    await page.goto(`/dashboard/workflows/review/${seeded.instanceId}`, { waitUntil: "domcontentloaded" });

    const numerosDePasos = async () =>
      page.getByRole("button", { name: /^Paso \d/ }).evaluateAll((els) =>
        els.map((el) => Number((el.textContent || "").match(/Paso (\d+)/)?.[1]))
      );
    const filasDePasos = page.getByRole("button", { name: /^Paso \d/ });

    // Todo: orden canónico 1–5, tomado de la plantilla y no del heap de Postgres.
    await page.getByRole("tab", { name: /Todo/ }).click();
    await expect(filasDePasos).toHaveCount(5);
    expect(await numerosDePasos()).toEqual([1, 2, 3, 4, 5]);

    // Requiere atención: solo el paso 3 (fallo + comentario), numerado con su
    // posición real — nunca renumerado a "Paso 1" por ser la única fila.
    await page.getByRole("tab", { name: /Requiere atención/ }).click();
    await expect(filasDePasos).toHaveCount(1);
    await expect(filasDePasos).toContainText("Paso 3");
  });

  test("el paso con hallazgo llega expandido y el limpio colapsado", async ({ page }) => {
    seeded = await seedReviewInstance(COMPANY_ID, {
      branchId: BRANCH_POLANCO,
      assigneeId: USER_SUPER_ADMIN,
      score: 82,
      steps: pasosDesalineados(),
    });

    await page.goto(`/dashboard/workflows/review/${seeded.instanceId}`, { waitUntil: "domcontentloaded" });

    // El paso 3 es la razón por la que el revisor abrió la página: no debería
    // haber que buscarlo ni abrirlo.
    await expect(page.getByRole("button", { name: /^Paso 3/ })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
    await expect(page.getByText("La etiqueta no coincide con lo declarado en el pedido")).toBeVisible();

    // Los pasos sin hallazgo no piden espacio.
    await expect(page.getByRole("button", { name: /^Paso 1/ })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
    await expect(page.getByRole("button", { name: /^Paso 4/ })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
  });

  test("teclado: Enter expande el paso y abre la evidencia con el contexto del paso", async ({ page }) => {
    seeded = await seedReviewInstance(COMPANY_ID, {
      branchId: BRANCH_POLANCO,
      assigneeId: USER_SUPER_ADMIN,
      score: 82,
      steps: pasosDesalineados(),
    });

    await page.goto(`/dashboard/workflows/review/${seeded.instanceId}`, { waitUntil: "domcontentloaded" });

    // Se prueba sobre el paso 4: tiene evidencia pero no hallazgo, así que llega
    // colapsado y el camino completo (expandir → ampliar) es observable.
    // Sin llamadas de mouse: foco + Enter por todo el camino.
    const fila = page.getByRole("button", { name: /^Paso 4/ });
    await expect(fila).toBeVisible();
    await expect(fila).toHaveAttribute("aria-expanded", "false");

    await fila.focus();
    await page.keyboard.press("Enter");
    await expect(fila).toHaveAttribute("aria-expanded", "true");

    // Enter en la miniatura abre el diálogo con el contexto del paso.
    const miniatura = page.getByRole("button", { name: /Ampliar evidencia 1 del paso 4/ });
    await expect(miniatura).toBeVisible();
    await miniatura.focus();
    await page.keyboard.press("Enter");
    const dialogo = page.getByRole("dialog");
    await expect(dialogo).toBeVisible();
    await expect(dialogo).toContainText("Paso 4:");
    await expect(dialogo).toContainText("Verificado por IA");
  });

  test("la bitácora muestra la pregunta, la respuesta tipada y el fuera de rango", async ({ page }) => {
    seeded = await seedReviewInstance(COMPANY_ID, {
      branchId: BRANCH_POLANCO,
      assigneeId: USER_SUPER_ADMIN,
      score: 75,
      steps: [
        {
          stepId: "temp-camara",
          passed: false,
          confidence: 0.55,
          reason: "Lectura fuera del rango permitido",
          comment: "La cámara venía abierta desde el turno anterior",
          type: "NUMBER",
          title: "Temperatura de la cámara fría",
          description: "Registra la lectura del termómetro interno",
          unit: "°C",
          validation: { min: 0, max: 4 },
          value: "18.5",
        },
        {
          stepId: "limpieza-ok",
          passed: true,
          confidence: 0.95,
          type: "YESNO",
          title: "¿El área quedó limpia?",
          value: "SI",
        },
      ],
    });

    await page.goto(`/dashboard/workflows/review/${seeded.instanceId}`, { waitUntil: "domcontentloaded" });

    // El título real de la plantilla, nunca "Step <id>".
    await expect(page.getByText("Temperatura de la cámara fría")).toBeVisible();
    await expect(page.getByText(/^Step /)).toHaveCount(0);

    // La pregunta y la respuesta se leen juntas: el paso trae hallazgo, así que
    // llega expandido.
    await expect(page.getByText("Se pidió", { exact: true })).toBeVisible();
    await expect(page.getByText("Registra la lectura del termómetro interno")).toBeVisible();
    await expect(page.getByText("18.5 °C")).toBeVisible();

    // Fuera de rango: se marca y se declara el rango esperado.
    await expect(page.getByText("por encima del máximo")).toBeVisible();
    await expect(page.getByText("Esperado: entre 0 y 4 °C")).toBeVisible();

    // Un YESNO se lee como Sí, no como JSON.
    await page.getByRole("button", { name: /^Paso 2/ }).click();
    await expect(page.getByText("Sí", { exact: true })).toBeVisible();
  });

  test("un paso sin definición en la plantilla se degrada, no se disfraza", async ({ page }) => {
    seeded = await seedReviewInstance(COMPANY_ID, {
      branchId: BRANCH_POLANCO,
      assigneeId: USER_SUPER_ADMIN,
      score: 90,
      steps: [
        { stepId: "paso-1", passed: true, confidence: 0.96, type: "TEXT", title: "Revisar bitácora" },
        {
          stepId: "count-sku-huerfano",
          passed: true,
          confidence: 0.9,
          comment: "Paso dinámico sin definición persistida",
          omitFromTemplate: true,
        },
      ],
    });

    await page.goto(`/dashboard/workflows/review/${seeded.instanceId}`, { waitUntil: "domcontentloaded" });

    // Ni "Step count-sku-huerfano" ni un título inventado: se dice lo que es.
    await expect(page.getByText(/^Step /)).toHaveCount(0);
    await expect(page.getByText("Paso sin definición en la plantilla").first()).toBeVisible();
    // Trae comentario ⇒ hallazgo ⇒ expandido, con el identificador a la vista.
    await expect(page.getByText("count-sku-huerfano")).toBeVisible();
  });

  test("editar la plantilla no reescribe una revisión ya ejecutada", async ({ page }) => {
    seeded = await seedReviewInstance(COMPANY_ID, {
      branchId: BRANCH_POLANCO,
      assigneeId: USER_SUPER_ADMIN,
      score: 88,
      freeze: true,
      steps: [
        {
          stepId: "paso-1",
          passed: true,
          confidence: 0.95,
          type: "TEXT",
          title: "Verificar sellos de las cámaras",
        },
      ],
    });

    await page.goto(`/dashboard/workflows/review/${seeded.instanceId}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Verificar sellos de las cámaras")).toBeVisible();

    // Alguien edita la plantilla después de la ejecución. El acta no cambia:
    // sigue diciendo lo que se pidió el día que se ejecutó.
    await renameReviewTemplateStep(
      seeded.workflowTemplateId,
      "paso-1",
      "TÍTULO EDITADO DESPUÉS"
    );

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText("Verificar sellos de las cámaras")).toBeVisible();
    await expect(page.getByText("TÍTULO EDITADO DESPUÉS")).toHaveCount(0);
  });

  test("un paso dinámico congelado muestra su título real aunque no esté en la plantilla", async ({ page }) => {
    seeded = await seedReviewInstance(COMPANY_ID, {
      branchId: BRANCH_POLANCO,
      assigneeId: USER_SUPER_ADMIN,
      score: 91,
      freeze: true,
      steps: [
        { stepId: "paso-1", passed: true, confidence: 0.96, type: "TEXT", title: "Abrir el conteo" },
        {
          // Así se ve un paso expandido desde `metadata.dynamicSource`: existe en
          // la instancia y nunca en la plantilla. Antes de congelarlo, su título
          // era irrecuperable.
          stepId: "count-jitomate-bola",
          passed: true,
          confidence: 0.93,
          type: "NUMBER",
          title: "Conteo de Jitomate Bola",
          unit: "kg",
          value: "12",
          omitFromTemplate: true,
        },
      ],
    });

    await page.goto(`/dashboard/workflows/review/${seeded.instanceId}`, { waitUntil: "domcontentloaded" });

    await expect(page.getByText("Conteo de Jitomate Bola")).toBeVisible();
    await expect(page.getByText("Paso sin definición en la plantilla")).toHaveCount(0);

    await page.getByRole("button", { name: /^Paso 2/ }).click();
    await expect(page.getByText("12 kg")).toBeVisible();
  });
});