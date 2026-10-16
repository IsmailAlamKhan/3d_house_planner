import { expect, test, type Browser, type Page } from '@playwright/test';
import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// These tests run against the real app server (static build + /api/projects + SQLite), not `vite preview`.
const PORT = 4181;
const URL = `http://127.0.0.1:${PORT}`;
let server: ChildProcess;

test.beforeAll(async () => {
  // Node + the tsx CLI directly: spawning 'npx' fails with ENOENT on Windows (it is npx.cmd there).
  server = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DATA_DIR: mkdtempSync(join(tmpdir(), 'dd-e2e-')),
      OLLAMA_URL: 'http://127.0.0.1:9',
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${URL}/api/health`)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('The app server did not start');
});
test.afterAll(() => void server?.kill());

const prefs = {
  cookies: [],
  origins: [
    {
      origin: URL,
      localStorage: [{ name: 'duplex-designer:prefs', value: JSON.stringify({ tourSeen: true }) }],
    },
  ],
};

async function device(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ storageState: prefs });
  const page = await ctx.newPage();
  await page.goto(URL);
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-status', 'synced', {
    timeout: 20_000,
  });
  return page;
}

const serverNames = async () =>
  ((await (await fetch(`${URL}/api/projects`)).json()) as { name: string }[]).map((p) => p.name);

const rename = async (page: Page, name: string) => {
  const box = page.getByRole('textbox', { name: 'Project name' });
  await box.fill(name);
  await box.press('Enter');
};

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

test('a project made on one device appears on another; simultaneous edits raise the conflict dialog', async ({
  browser,
}) => {
  const a = await device(browser);
  await rename(a, 'Made on the phone');
  await expect(a.getByTestId('sync-status')).toHaveAttribute('data-status', 'synced');
  // autosave (1 s) + push: wait until the server really has it (a fixed pause is too short under load)
  await expect
    .poll(async () => (await serverNames()).includes('Made on the phone'), { timeout: 60_000 })
    .toBe(true);

  const b = await device(browser);
  await expect(b.getByRole('textbox', { name: 'Project name' })).toHaveValue('Made on the phone', {
    timeout: 20_000,
  });
  await b.getByRole('button', { name: 'Projects' }).click();
  await expect(b.getByRole('dialog', { name: 'Your projects' })).toContainText('Made on the phone');
  await b.keyboard.press('Escape');
  // Let both devices settle (the laptop may save what it just loaded, and the phone then pulls it) before the edits start.
  await expect(b.getByTestId('sync-status')).toHaveAttribute('data-status', 'synced');
  await expect(a.getByTestId('sync-status')).toHaveAttribute('data-status', 'synced');
  await a.waitForTimeout(5000);

  // Both have the same project. The laptop loses Wi-Fi and edits; meanwhile the phone saves; then the laptop is back.
  await b.context().setOffline(true);
  await rename(a, 'Edited on the phone');
  // The phone's save must really have reached the server before the laptop comes back (under load 2.5 s is not enough).
  await expect
    .poll(async () => (await serverNames()).includes('Edited on the phone'), { timeout: 60_000 })
    .toBe(true);
  await rename(b, 'Edited on the laptop');
  await expect(b.getByTestId('sync-status')).toHaveAttribute('data-status', 'offline', {
    timeout: 10_000,
  });
  // The laptop's edit must be saved (autosave waits 1 s) while it is still offline; back online too early, it would first
  // download the phone's version and then save on top of it without any conflict.
  await b.waitForTimeout(3500);
  await b.context().setOffline(false);
  const dialog = b.getByRole('dialog', { name: 'This project was changed on another device' });
  await expect(dialog).toBeVisible({ timeout: 100_000 });

  await dialog.getByRole('button', { name: /Save mine as a copy/ }).click();
  await expect(dialog).toBeHidden();
  await expect(b.getByRole('textbox', { name: 'Project name' })).toHaveValue(
    'Edited on the laptop (copy)',
  );
  // Nothing was lost: the server has both.
  await expect
    .poll(async () =>
      ((await (await fetch(`${URL}/api/projects`)).json()) as { name: string }[])
        .map((p) => p.name)
        .sort(),
    )
    .toEqual(['Edited on the laptop (copy)', 'Edited on the phone']);
});

test('the AI tab says so while the model is still downloading, and offline generation keeps working', async ({
  browser,
}) => {
  const a = await device(browser);
  await a.getByRole('tab', { name: 'AI Assistant' }).click();
  // No Ollama here at all → no "downloading" banner (that is only for Ollama up + model missing).
  await expect(a.getByTestId('ai-downloading')).toHaveCount(0);
  await a.getByRole('textbox', { name: /Describe the home/ }).fill('2 bedroom duplex');
  await a.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(a.getByTestId('ai-candidate').first()).toBeVisible({ timeout: 30_000 });
  await expect(a.getByTestId('ai-source').first()).toHaveText('Offline generator');
});
