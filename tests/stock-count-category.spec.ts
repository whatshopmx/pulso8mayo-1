import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { sql, createTestSkus, seedBatch } from './support/db';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './support/constants';

test('wizard, captura por lote, borrador y aprobación sin duplicar ajustes', async ({ page }) => {
  test.setTimeout(240_000);
  const tag = `E2E-Conteo-${Date.now()}`;
  const category = `${tag}-A`, otherCategory = `${tag}-B`;
  const templateId = randomUUID();
  const itemIds: string[] = [];
  let instanceId: string | undefined;
  try {
    const [user] = await sql`SELECT company_id, branch_id FROM users WHERE email = ${ADMIN_EMAIL}`;
    expect(user?.company_id).toBeTruthy();
    const [branch] = await sql`SELECT id FROM branches WHERE company_id = ${user.company_id} ORDER BY id LIMIT 1`;
    const branchId = user.branch_id || branch.id;
    itemIds.push(...await createTestSkus(user.company_id, 2, { category, unit: 'KG' }));
    itemIds.push(...await createTestSkus(user.company_id, 1, { category: otherCategory, unit: 'KG' }));
    const firstBatch = await seedBatch({ companyId: user.company_id, branchId, itemId: itemIds[0], quantity: 2.2, lotNumber: `${tag}-LOTE-A` });
    const secondBatch = await seedBatch({ companyId: user.company_id, branchId, itemId: itemIds[0], quantity: 3, lotNumber: `${tag}-LOTE-B` });
    await sql`INSERT INTO workflow_templates (id, company_id, name, steps, category, active) VALUES (${templateId}, ${user.company_id}, ${tag}, '[]'::jsonb, 'INVENTORY', true)`;
    await page.goto('/sign-in');
    if (page.url().includes('sign-in')) {
      await page.locator('#email').fill(ADMIN_EMAIL);
      await page.locator('#password').fill(ADMIN_PASSWORD);
      await page.getByRole('button', { name: /iniciar|sign in|entrar/i }).click();
      await page.waitForURL(/\/dashboard/);
    }
    await page.goto(`/dashboard/builder/editor/${templateId}`);
    await page.getByRole('button', { name: 'Conteo de inventario', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('searchbox', { name: 'Buscar categoría' }).fill(tag);
    await dialog.getByRole('checkbox', { name: new RegExp(category) }).check();
    await dialog.getByRole('checkbox', { name: new RegExp(otherCategory) }).check();
    await dialog.getByRole('button', { name: 'Revisar 2 categorías' }).click();
    await expect(dialog.getByText(`Conteo · ${category}`, { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Agregar 2 componentes' }).click();
    // The builder already saves after inactivity; wait for its persisted result.
    await expect.poll(async () => {
      const [template] = await sql`SELECT steps FROM workflow_templates WHERE id = ${templateId}`;
      return template.steps.length;
    }).toBe(2);
    const start = await page.request.post('/api/workflows/execute', { data: { templateId, branchId } });
    expect(start.ok(), await start.text()).toBeTruthy();
    instanceId = (await start.json()).id;
    await page.goto(`/dashboard/workflows/${instanceId}/execute`);
    const inputs = page.locator('[data-count-input]');
    await expect(inputs).toHaveCount(3);
    await expect(page.getByText('0%', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Siguiente Paso' })).toBeDisabled();
    const first = page.getByRole('spinbutton', { name: new RegExp(`${tag}-LOTE-A`) });
    const second = page.getByRole('spinbutton', { name: new RegExp(`${tag}-LOTE-B`) });
    await first.fill('2.5');
    const firstIndex = await first.evaluate(element => Array.from(document.querySelectorAll('[data-count-input]')).indexOf(element));
    await first.press('Enter');
    await expect(inputs.nth(firstIndex + 1)).toBeFocused();
    await expect.poll(async () => {
      const [step] = await sql`SELECT value FROM workflow_instance_steps WHERE instance_id = ${instanceId} AND step_order = 0`;
      const count = typeof step.value === 'string' ? JSON.parse(step.value) : step.value;
      return count?.rows.find((row: { batchId: string }) => row.batchId === firstBatch)?.countedQuantity;
    }).toBe(2.5);
    await page.reload();
    await expect(first).toHaveValue('2.5');
    await page.getByRole('checkbox', { name: 'Solo pendientes' }).check();
    await expect(inputs).toHaveCount(2);
    await page.getByRole('checkbox', { name: 'Solo pendientes' }).uncheck();
    await second.fill('2.7');
    await page.getByRole('spinbutton', { name: /lote sin lote/ }).fill('0');
    await page.getByRole('searchbox', { name: 'Buscar producto o lote' }).fill(`${tag}-LOTE-B`);
    await expect(inputs).toHaveCount(1);
    await page.getByRole('searchbox', { name: 'Buscar producto o lote' }).clear();
    await expect(page.getByRole('status').filter({ hasText: 'Borrador guardado' })).toBeVisible();
    await page.screenshot({ path: '.tmp/stock-count-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: '.tmp/stock-count-mobile.png', fullPage: true });
    await page.goto(`/dashboard/workflows/execute/${instanceId}`);
    await expect(first).toHaveValue('2.5');
    await expect(second).toHaveValue('2.7');
    await page.goto(`/dashboard/workflows/${instanceId}/execute`);
    await page.getByRole('button', { name: 'Siguiente Paso' }).click();
    await expect(inputs).toHaveCount(1);
    await page.getByRole('spinbutton').fill('0');
    await page.getByRole('button', { name: 'Guardar para revisión' }).click();
    await page.waitForURL(/\/results$/);
    const [result] = await sql`SELECT data FROM workflow_instances WHERE id = ${instanceId}`;
    expect(result.data.adjustmentsStatus).toBe('PENDING');
    expect(result.data.lotResults).toHaveLength(4);
    const quantities = async () => (await sql`SELECT current_quantity FROM inventory_batches WHERE id IN (${firstBatch}, ${secondBatch}) ORDER BY lot_number`).map(row => Number(row.current_quantity));
    expect(await quantities()).toEqual([2.2, 3]);
    await page.getByRole('button', { name: /Aprobar y aplicar 2 ajustes/ }).click();
    await expect.poll(quantities).toEqual([2.5, 2.7]);
    const again = await page.request.post(`/api/inventory/stock-count/${instanceId}`, { data: { action: 'applyAdjustments' } });
    expect(again.ok()).toBeTruthy();
    expect(await quantities()).toEqual([2.5, 2.7]);
    const [movements] = await sql`SELECT count(*)::int AS n FROM inventory_movements WHERE item_id = ${itemIds[0]} AND type = 'ADJUSTMENT'`;
    expect(movements.n).toBe(2);
    const [aggregate] = await sql`SELECT counted_quantity FROM stock_counts WHERE workflow_instance_id = ${instanceId} AND item_id = ${itemIds[0]}`;
    expect(Number(aggregate.counted_quantity)).toBe(5.2);
  } finally {
    if (instanceId) {
      await sql`DELETE FROM stock_counts WHERE workflow_instance_id = ${instanceId}`;
      await sql`DELETE FROM inventory_waste WHERE workflow_instance_id = ${instanceId}`;
      await sql`DELETE FROM workflow_instance_steps WHERE instance_id = ${instanceId}`;
      await sql`DELETE FROM workflow_instances WHERE id = ${instanceId}`;
    }
    if (itemIds.length) {
      await sql`DELETE FROM inventory_movements WHERE item_id = ANY(${itemIds})`;
      await sql`DELETE FROM inventory_batches WHERE item_id = ANY(${itemIds})`;
      await sql`DELETE FROM inventory_items WHERE id = ANY(${itemIds})`;
    }
    await sql`DELETE FROM workflow_templates WHERE id = ${templateId}`;
  }
});
