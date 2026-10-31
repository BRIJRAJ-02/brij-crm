// The relationship dialog's shape as a picture (the CRM flow pass, 31 October
// 2026): once both objects are chosen, how records link shows as the two
// objects' cards with the link between them, each card asking its own side's
// question in words; changing one card's answer changes the cardinality the
// dialog sends, and the column names follow it.
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { checkScreen, chooseNewAttribute, newWorkspace } from './people.ts';

test.describe('the relationship dialog’s preview', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The table flow runs at desktop width.');

  test('the two objects show as cards, each asking how many it holds of the other', async ({ page }) => {
    test.setTimeout(150_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `relpreview-${tag}`;
    await newWorkspace(page, `relpreview-${tag}@example.com`, slug);
    await page.getByRole('link', { name: 'Companies' }).first().click();
    await expect(page.getByRole('grid', { name: 'Companies' })).toBeVisible();

    await page.getByRole('button', { name: 'Add attribute' }).first().click();
    await chooseNewAttribute(page);
    const attribute = page.getByRole('dialog', { name: 'New attribute' });
    await attribute.getByLabel('Name', { exact: true }).fill('Investors');
    await attribute.getByRole('button', { name: /Type$/ }).click();
    await page.getByRole('option', { name: 'Relationship', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New relationship' });
    await expect(dialog).toBeVisible();
    // Nothing to draw until both objects are chosen.
    await expect(dialog.getByRole('group', { name: 'How records link' })).toHaveCount(0);
    await dialog
      .getByRole('button', { name: /Related object/ })
      .and(dialog.locator('[aria-haspopup="listbox"]'))
      .click();
    await page.getByRole('option', { name: 'People', exact: true }).click();

    const shape = dialog.getByRole('group', { name: 'How records link' });
    await expect(shape).toBeVisible();
    await expect(shape.getByRole('heading', { name: 'Companies' })).toBeVisible();
    await expect(shape.getByRole('heading', { name: 'People' })).toBeVisible();
    await expect(shape.getByRole('radiogroup', { name: /Each company has/ })).toBeVisible();
    await expect(shape.getByRole('radiogroup', { name: /Each person has/ })).toBeVisible();
    await checkScreen(page, 'relationship-preview');

    // Each card's answer, in words, shapes the relationship; the side names follow it until typed over.
    await shape
      .getByRole('radiogroup', { name: /Each company has/ })
      .getByRole('radio', { name: 'Many people' })
      .check({ force: true });
    await shape
      .getByRole('radiogroup', { name: /Each person has/ })
      .getByRole('radio', { name: 'Many companies' })
      .check({ force: true });
    await expect(dialog.getByLabel('Name on People')).toHaveValue('Companies');
    await dialog.getByRole('button', { name: 'Create relationship' }).click();
    await expect(dialog).toBeHidden();
  });
});
