import { test, expect } from "@playwright/test";
import { parseMermaSteps } from "../lib/services/merma-from-workflow";

/**
 * Auditoría O-10 — el extractor de merma reclama pasos que no son suyos.
 *
 * `parseMermaSteps` identifica la entidad por los últimos 36 caracteres del
 * `stepId` y da de alta la entrada en el mapa ANTES de mirar el prefijo. Como
 * todos los pasos dinámicos terminan en UUID —`prod-qty-{recipeId}` de
 * producción, `count-{itemId}` del conteo— una instancia de cualquier otro tipo
 * entra en el mapa como si fuera merma.
 *
 * No llega a escribir nada: sin motivo válido la fila se descarta. Pero el mapa
 * no queda vacío, así que la guarda `byItem.size === 0` no corta, y el extractor
 * sigue adelante para cada instancia de producción o conteo: busca la compañía,
 * consulta los ítems, consulta los costos de lote y deja un WARN por entidad.
 * Eso fue lo que destapó A11 al pasar a logs estructurados: dos
 * `"Motivo de merma desconocido"` por cada instancia de producción, con un
 * `itemId` que en realidad era un `recipeId`.
 *
 * Lo que se fija aquí es la regla, no el ruido: **sólo los pasos `merma-*`
 * describen merma.** El primer caso debe estar ROJO contra el código actual; el
 * segundo es la regresión que impide arreglarlo de más y dejar de reconocer los
 * pasos que sí son de merma.
 *
 * Es una función pura de los `stepId`: no necesita base, servidor ni Inngest.
 */

/** UUIDs fijos: un test sobre ids no debe depender de datos sembrados. */
const RECETA = "11111111-2222-4333-8444-555555555555";
const ITEM = "66666666-7777-4888-8999-aaaaaaaaaaaa";

test.describe("Auditoría O-10 · el extractor de merma sólo lee pasos de merma", () => {
  test("los pasos de producción y de conteo no entran al mapa de merma", () => {
    const byItem = parseMermaSteps([
      // Producción: el paso dinámico de porciones por receta.
      { stepId: `prod-qty-${RECETA}`, value: JSON.stringify("3") },
      // Conteo dinámico: la cantidad física por SKU.
      { stepId: `count-${ITEM}`, value: JSON.stringify("2.5") },
      // Paso estático de cierre: ni siquiera termina en UUID.
      { stepId: "prod-obs", value: JSON.stringify("sin novedad") },
    ]);

    expect(
      [...byItem.keys()],
      "el extractor de merma reclamó pasos de otro flujo"
    ).toEqual([]);
  });

  test("los pasos de merma de verdad se siguen leyendo enteros", () => {
    const byItem = parseMermaSteps([
      { stepId: `merma-qty-${ITEM}`, value: JSON.stringify("0.5") },
      { stepId: `merma-reason-${ITEM}`, value: JSON.stringify("caducidad") },
      {
        stepId: `merma-evidence-${ITEM}`,
        value: JSON.stringify("https://example.test/merma.jpg"),
      },
    ]);

    expect([...byItem.keys()]).toEqual([ITEM]);
    expect(byItem.get(ITEM)).toEqual({
      itemId: ITEM,
      quantity: 0.5,
      reasonKey: "caducidad",
      evidenceUrl: "https://example.test/merma.jpg",
    });
  });

  test("una instancia mixta se queda sólo con la parte de merma", () => {
    // El caso que hace falta para no arreglar O-10 de más: si un template
    // llegara a mezclar ambos flujos, la merma del SKU tiene que sobrevivir y
    // la receta tiene que quedarse fuera.
    const byItem = parseMermaSteps([
      { stepId: `prod-qty-${RECETA}`, value: JSON.stringify("1") },
      { stepId: `merma-qty-${ITEM}`, value: JSON.stringify("2") },
      { stepId: `merma-reason-${ITEM}`, value: JSON.stringify("caida") },
    ]);

    expect([...byItem.keys()]).toEqual([ITEM]);
    expect(byItem.get(ITEM)?.quantity).toBe(2);
    expect(byItem.get(ITEM)?.reasonKey).toBe("caida");
  });
});
