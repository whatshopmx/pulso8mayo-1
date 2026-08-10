import { test, expect } from "@playwright/test";
import { BRANCH_POLANCO, COMPANY_ID, E2E_TAG, USER_SUPER_ADMIN } from "./support/constants";
import { cleanupReviewInstance, seedReviewInstance } from "./support/db";

/**
 * Fase 3 — Revisión de workflows (plan `tasks/plan-workflow-review-critique.md`).
 *
 * T8a (bucle de decisión): rechazar sin motivo no se puede enviar; rechazo y
 * aprobación aterrizan en el historial con el veredicto en la fila señalada
 * (`?revisada`) y persisten vía la API de ejecuciones.
 *
 * T8b (numeración + teclado): con el paso 3 de 5 fallando a propósito, los tabs
 * filtrados ("Por Revisar", "Verificados por IA", "Con Evidencia") muestran la
 * posición real del paso — nunca la renumera del índice filtrado — y el camino
 * de teclado (Enter/Space) llega a expandir el paso y abrir la evidencia con el
 * contexto del paso ("Paso 3: …") sin una sola llamada de mouse.
 */

// Pasos con el 3 fallando a propósito y el resto verificado por IA: el tab
// "Por Revisar" debe decir "Paso 3" aunque sea la única fila filtrada.
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
    { stepId: "paso-4", passed: true, confidence: 0.92 },
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

    await page.goto(`/dashboard/workflows/review/${seeded.instanceId}`);

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
    await page.goto(`/dashboard/workflows/review/${seeded.instanceId}`);
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

    await page.goto(`/dashboard/workflows/review/${seeded.instanceId}`);

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
    await page.goto(`/dashboard/workflows/review/${seeded.instanceId}`);
    await expect(page.getByText("Aprobado", { exact: true })).toHaveCount(2);
    await expect(page.getByText(/^el \d{1,2} de/)).toBeVisible();
    await expect(page.getByText("Completado", { exact: true })).toHaveCount(0);
  });

  test("los tabs filtrados numeran los pasos por su posición real (Paso 3)", async ({ page }) => {
    seeded = await seedReviewInstance(COMPANY_ID, {
      branchId: BRANCH_POLANCO,
      assigneeId: USER_SUPER_ADMIN,
      score: 82,
      steps: pasosDesalineados(),
    });

    await page.goto(`/dashboard/workflows/review/${seeded.instanceId}`);

    const numerosDePasos = async () =>
      page.getByRole("button", { name: /^Paso \d/ }).evaluateAll((els) =>
        els.map((el) => Number((el.textContent || "").match(/Paso (\d+)/)?.[1]))
      );
    const filasDePasos = page.getByRole("button", { name: /^Paso \d/ });

    // Todos: orden canónico 1–5.
    await page.getByRole("tab", { name: /Todos/ }).click();
    await expect(filasDePasos).toHaveCount(5);
    expect(await numerosDePasos()).toEqual([1, 2, 3, 4, 5]);

    // Por Revisar: solo el paso 3 (fallo + comentario), numerado con su posición real.
    await page.getByRole("tab", { name: /Por Revisar/ }).click();
    await expect(filasDePasos).toHaveCount(1);
    await expect(filasDePasos).toContainText("Paso 3");

    // Verificados por IA: 1, 2, 4, 5 — nunca renumera a 1–4.
    await page.getByRole("tab", { name: /Verificados por IA/ }).click();
    await expect(filasDePasos).toHaveCount(4);
    expect(await numerosDePasos()).toEqual([1, 2, 4, 5]);

    // Con Evidencia: una sola fila, el paso 3.
    await page.getByRole("tab", { name: /Con Evidencia/ }).click();
    await expect(filasDePasos).toHaveCount(1);
    await expect(filasDePasos).toContainText("Paso 3");
  });

  test("teclado: Enter expande el paso y abre la evidencia con el contexto del paso", async ({ page }) => {
    seeded = await seedReviewInstance(COMPANY_ID, {
      branchId: BRANCH_POLANCO,
      assigneeId: USER_SUPER_ADMIN,
      score: 82,
      steps: pasosDesalineados(),
    });

    await page.goto(`/dashboard/workflows/review/${seeded.instanceId}`);

    // Sin llamadas de mouse: foco + Enter/Space por todo el camino.
    const tab = page.getByRole("tab", { name: /Por Revisar/ });
    await tab.focus();
    await page.keyboard.press("Enter");

    const fila = page.getByRole("button", { name: /^Paso 3/ });
    await expect(fila).toBeVisible();
    await expect(fila).toHaveAttribute("aria-expanded", "false");

    // Enter en la fila expande el detalle del paso.
    await fila.focus();
    await page.keyboard.press("Enter");
    await expect(fila).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText("Valor Registrado:", { exact: true })).toBeVisible();

    // Enter en la miniatura abre el diálogo con el contexto del paso.
    const miniatura = page.getByRole("button", { name: /Ampliar evidencia 1 del paso 3/ });
    await miniatura.focus();
    await page.keyboard.press("Enter");
    const dialogo = page.getByRole("dialog");
    await expect(dialogo).toBeVisible();
    await expect(dialogo).toContainText("Paso 3:");
    await expect(dialogo).toContainText("Requiere revisión");
  });
});