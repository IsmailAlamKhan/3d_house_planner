import { expect, test } from '@playwright/test';

test('app loads with a 3D canvas', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('scene-canvas').locator('canvas')).toBeVisible();
  await expect(page.getByTestId('plan-canvas')).toBeVisible();
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.getByTestId('plan-canvas')).toHaveCount(0);
});
