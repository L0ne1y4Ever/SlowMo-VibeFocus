import { test } from '@playwright/test';
import crypto from 'node:crypto';

function sha(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

test('inspect live particle motion', async ({ page }) => {
  const consoleMessages = [];
  page.on('console', (msg) => {
    consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    consoleMessages.push(`[pageerror] ${err.message}`);
  });

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  const liveA = await page.locator('canvas').evaluate((canvas) => canvas.toDataURL());
  await page.waitForTimeout(1200);
  const liveB = await page.locator('canvas').evaluate((canvas) => canvas.toDataURL());

  await page.keyboard.press('5');
  await page.waitForTimeout(500);
  const debugA = await page.locator('canvas').evaluate((canvas) => canvas.toDataURL());
  await page.waitForTimeout(1200);
  const debugB = await page.locator('canvas').evaluate((canvas) => canvas.toDataURL());

  console.log(JSON.stringify({
    liveSame: sha(liveA) === sha(liveB),
    debugSame: sha(debugA) === sha(debugB),
    liveHashA: sha(liveA),
    liveHashB: sha(liveB),
    debugHashA: sha(debugA),
    debugHashB: sha(debugB),
    consoleMessages,
  }, null, 2));
});
