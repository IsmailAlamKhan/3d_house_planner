import { expect, test } from '@playwright/test';

test('app loads with a 3D canvas', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('scene-canvas').locator('canvas')).toBeVisible();
  await expect(page.getByTestId('plan-canvas')).toBeVisible();
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.getByTestId('plan-canvas')).toHaveCount(0);
});

test('levels panel: add a level, then undo with the keyboard', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Levels' }).click();
  await page.getByRole('button', { name: 'Add level' }).click();
  await expect(page.getByText('Level 3')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByText('Level 3')).toHaveCount(0);
});
