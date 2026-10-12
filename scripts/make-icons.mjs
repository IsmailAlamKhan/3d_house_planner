// Renders public/icons/icon.svg to the PNG sizes the web manifest and iOS need (uses Playwright's Chromium).
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

const svg = readFileSync('public/icons/icon.svg', 'utf8');
const jobs = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, false],
];
const browser = await chromium.launch();
for (const [file, size, maskable] of jobs) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  // A maskable icon keeps its artwork inside the central 80 % and fills the whole square.
  const inner = maskable
    ? `<div style="width:${size}px;height:${size}px;background:#0369a1;display:flex;align-items:center;justify-content:center"><div style="width:${size * 0.8}px;height:${size * 0.8}px">${svg}</div></div>`
    : `<div style="width:${size}px;height:${size}px">${svg}</div>`;
  await page.setContent(`<style>html,body{margin:0}svg{width:100%;height:100%}</style>${inner}`);
  writeFileSync(
    `public/icons/${file}`,
    await page.screenshot({ type: 'png', omitBackground: true }),
  );
  await page.close();
}
await browser.close();
console.log('icons written');
