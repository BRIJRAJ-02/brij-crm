// API keys (parity #34): an owner makes a key in Settings › Developer, copies it once, and calls /api/v1 with it;
// a read key reads and is refused a write; Revoke stops the key at once, and Undo brings it back within its window.
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { newWorkspace } from './people.ts';

/** Makes a key through the dialog and answers its whole value, read off the one time it shows. */
async function makeKey(page: Page, name: string, access: 'Read' | 'Read and write'): Promise<string> {
  await page.getByRole('button', { name: 'Create key' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Create API key' });
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  await dialog.getByRole('radio', { name: access }).check();
  await dialog.getByRole('button', { name: 'Create key' }).click();
  const shown = page.getByRole('dialog', { name: 'Copy your key' });
  await expect(shown).toBeVisible();
  const token = (await shown.locator('code').first().textContent())?.trim() ?? '';
  expect(token).toMatch(/^crm_[A-Za-z0-9_-]{87}$/);
  await shown.getByRole('button', { name: 'Done' }).click();
  await expect(shown).toBeHidden();
  return token;
}

test.describe('API keys', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'Settings run at desktop width.');

  test('a key made once reads and writes records over /api/v1, and Revoke stops it with Undo', async ({ page }) => {
    test.setTimeout(180_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `apikeys-${tag}`;
    await newWorkspace(page, `apikeys-${tag}@example.com`, slug);
    await page.goto(`/w/${slug}/settings/developer`);
    await expect(page.getByRole('heading', { name: 'Developer' })).toBeVisible();
    await expect(page.getByText('No API keys yet')).toBeVisible();

    const writer = await makeKey(page, 'Sync', 'Read and write');
    const row = page.getByRole('row').filter({ hasText: 'Sync' });
    await expect(row).toContainText('Read and write');
    await expect(row).toContainText(`crm_…${writer.slice(-4)}`);
    await expect(row).toContainText('Never');

    const as = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });
    const objects = await page.request.get('/api/v1/objects', as(writer));
    expect(objects.status()).toBe(200);
    expect(((await objects.json()) as { objects: { apiSlug: string }[] }).objects.map((o) => o.apiSlug)).toContain(
      'people',
    );
    const made = await page.request.post('/api/v1/objects/people/records', { ...as(writer), data: {} });
    expect(made.status()).toBe(201);
    const { id } = (await made.json()) as { id: string };
    expect((await page.request.get(`/api/v1/objects/people/records/${id}`, as(writer))).status()).toBe(200);
    // No key, a made up one, and no reference page key needed.
    expect((await page.request.get('/api/v1/objects')).status()).toBe(401);
    expect((await page.request.get('/api/v1/objects', as(`${writer.slice(0, -1)}A`))).status()).toBe(401);
    expect((await page.request.get('/api/v1/openapi.json')).status()).toBe(200);

    // A read key reads, and is refused a write.
    const reader = await makeKey(page, 'Report', 'Read');
    expect((await page.request.get('/api/v1/objects/people/records?limit=5', as(reader))).status()).toBe(200);
    expect((await page.request.post('/api/v1/objects/people/records', { ...as(reader), data: {} })).status()).toBe(403);

    // Revoke: gone from the list and refused at once; Undo brings it back and it works again.
    await page.reload();
    await row.getByRole('button', { name: 'Revoke Sync' }).click();
    await expect(page.getByText('Sync revoked')).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'Sync' })).toHaveCount(0);
    expect((await page.request.get('/api/v1/objects', as(writer))).status()).toBe(401);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByText('Sync is back')).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'Sync' })).toHaveCount(1);
    expect((await page.request.get('/api/v1/objects', as(writer))).status()).toBe(200);

    // The key changes are in History, by name.
    await page.goto(`/w/${slug}/settings/history/changes`);
    await expect(page.getByText('made the API key Sync')).toBeVisible();
    await expect(page.getByText('revoked the API key Sync')).toBeVisible();
  });
});
